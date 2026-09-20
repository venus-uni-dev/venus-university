import { spawn } from 'child_process'
import { access, mkdir, readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { appError, messageOf, tailOf } from '@shared/errors'
import { PINNED_PIP, PYPI_INDEX_URL } from '@shared/setupManifest'
import { getComfyPythonPath, getTempPath } from '../paths'

/** Resolves true when the custom node ships a `requirements.txt`. */
export async function hasRequirements(nodeDir: string): Promise<boolean> {
  try {
    await access(join(nodeDir, 'requirements.txt'))
    return true
  } catch {
    return false
  }
}

/**
 * Splits a `requirements.txt` into the specifiers pip is given and the lines dropped:
 * anything naming an option, a VCS or URL source, or a local path.
 */
function selectIndexRequirements(text: string): { install: string[]; skipped: string[] } {
  const install: string[] = []
  const skipped: string[] = []

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const isPath = /^[.\\/]/.test(line) || /^[A-Za-z]:/.test(line)
    const isRemote = line.includes('git+') || line.includes('://') || line.includes(' @ ')
    if (line.startsWith('-') || isRemote || isPath) {
      skipped.push(line)
      continue
    }
    install.push(line)
  }

  return { install, skipped }
}

/** A pip name or version pip may be handed: no marker, no extra, no URL, no local version. */
const PLAIN_PIP_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

/** The constraints file pip resolves against: one exact pin per line, names sorted. */
export function buildConstraints(pins: Readonly<Record<string, string>>): string {
  return Object.keys(pins)
    .sort()
    .map((name) => {
      const version = pins[name]
      if (!PLAIN_PIP_TOKEN.test(name) || !PLAIN_PIP_TOKEN.test(version)) {
        throw appError(
          'PIP_CONSTRAINTS_INVALID',
          'A pinned dependency is not a plain name and version.',
          `${name}==${version}`
        )
      }
      return `${name}==${version}\n`
    })
    .join('')
}

/**
 * Installs a custom node's Python deps into ComfyUI's embedded interpreter. A player has
 * neither git nor a build chain, so only requirements the package index carries are installed —
 * a VCS, URL or path one is dropped rather than failing the whole run.
 */
export async function pipInstallRequirements(
  nodeDir: string,
  onStep?: (step: string) => void
): Promise<void> {
  const python = getComfyPythonPath()
  const requirements = join(nodeDir, 'requirements.txt')
  const { install, skipped } = selectIndexRequirements(await readFile(requirements, 'utf-8'))

  for (const line of skipped) {
    console.log(`[setup] skipping requirement not on the index: ${line}`)
    onStep?.(`skipping ${line.slice(0, 100)}`)
  }
  if (install.length === 0) return

  const constraints = buildConstraints(PINNED_PIP)
  const constraintsPath = join(getTempPath(), 'pip-constraints.txt')
  try {
    await mkdir(getTempPath(), { recursive: true })
    await writeFile(constraintsPath, constraints, 'utf-8')
  } catch (err) {
    throw appError(
      'PIP_CONSTRAINTS_FAILED',
      'Could not write the list of pinned dependency versions.',
      messageOf(err)
    )
  }

  const args = [
    '-m',
    'pip',
    'install',
    ...install,
    '-c',
    constraintsPath,
    '--index-url',
    PYPI_INDEX_URL,
    // No user site-packages on the embedded interpreter; the version nag is noise.
    '--no-warn-script-location',
    '--disable-pip-version-check'
  ]

  await new Promise<void>((resolve, reject) => {
    const child = spawn(python, args, { windowsHide: true })
    const tail: string[] = []

    const capture = (chunk: Buffer): void => {
      const text = chunk.toString()
      for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim()
        if (!trimmed) continue
        tail.push(trimmed)
        // Only the last 40 lines are kept, for the failure detail.
        if (tail.length > 40) tail.shift()
        onStep?.(trimmed.slice(0, 120))
      }
    }

    child.stdout.on('data', capture)
    child.stderr.on('data', capture)

    child.on('error', (err) => {
      reject(
        appError(
          'PIP_SPAWN_FAILED',
          `Could not run the embedded Python at ${python}.`,
          err.message
        )
      )
    })

    child.on('close', (code) => {
      if (code === 0) {
        resolve()
        return
      }
      reject(
        appError(
          'PIP_INSTALL_FAILED',
          `Installing dependencies failed (pip exited with code ${code}).`,
          tail.join('\n')
        )
      )
    })
  })
}

/** The one-liner that asks the interpreter which of its arguments it cannot import. */
const PROBE_SCRIPT =
  'import importlib.util, json, sys; ' +
  'print(json.dumps([m for m in sys.argv[1:] if importlib.util.find_spec(m) is None]))'

/**
 * The names among `modules` the embedded interpreter cannot resolve — what proves a node's
 * dependencies are really there rather than assuming its folder says so.
 */
export async function findMissingModules(modules: readonly string[]): Promise<string[]> {
  if (modules.length === 0) return []
  const python = getComfyPythonPath()

  return new Promise<string[]>((resolve, reject) => {
    const child = spawn(python, ['-s', '-c', PROBE_SCRIPT, ...modules], { windowsHide: true })
    let out = ''
    let err = ''

    child.stdout.on('data', (chunk: Buffer) => {
      out = `${out}${chunk.toString()}`
    })
    child.stderr.on('data', (chunk: Buffer) => {
      err = `${err}${chunk.toString()}`
    })

    /** The one rejection this probe has, whatever went wrong. */
    const fail = (detail: string): void => {
      reject(
        appError(
          'PYTHON_PROBE_FAILED',
          `Could not check the embedded Python's packages.`,
          tailOf(detail.trim(), 2000)
        )
      )
    }

    child.on('error', (spawnErr) => {
      fail(`${python}: ${spawnErr.message}`)
    })

    child.on('close', (code) => {
      if (code !== 0) {
        fail(`${python} exited with code ${String(code)}.\n${err}`)
        return
      }
      try {
        const parsed: unknown = JSON.parse(out)
        if (!Array.isArray(parsed) || parsed.some((name) => typeof name !== 'string')) {
          throw new Error('the probe did not print a list of names')
        }
        resolve(parsed as string[])
      } catch {
        fail(`${python} printed ${out}\n${err}`)
      }
    })
  })
}
