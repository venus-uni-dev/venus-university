import { mkdir, rename, rm, stat } from 'fs/promises'
import { dirname, join } from 'path'
import {
  COMFY_ARCHIVE_WRAPPER_DIR,
  COMFY_RUNTIME,
  PINNED_MODELS,
  PINNED_NODES,
  modelForComponentId,
  nodeZipUrl,
  nodeZipWrapperDir,
  runtimeAssetUrl,
  type PinnedModel,
  type PinnedNode,
  type PinnedRuntime
} from '@shared/setupManifest'
import type {
  InstallProgress,
  InstallResult,
  SetupComponent,
  SetupStatus
} from '@shared/types'
import {
  getComfyCustomNodePath,
  getComfyCustomNodesPath,
  getComfyModelDirPath,
  getComfyModelFilePath,
  getComfyPythonPath,
  getComfyUiPath,
  getTempPath
} from '../paths'
import { extract7z, extractZip, renameExtractedDir, stripWrapperDir } from './archiveService'
import { stop as stopComfy } from './comfyService'
import { downloadFile, hashFile } from './downloadService'
import { findMissingModules, hasRequirements, pipInstallRequirements } from './pythonService'
import { withRetry } from '@shared/retry'
import { appError, toAppError } from '@shared/errors'

/** Progress reporter passed down into each component's install routine. */
type Report = (step: string, percent?: number, bytes?: { done: number; total?: number }) => void

/** Resolves to true when `path` exists and is a directory. */
async function dirExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

/** Returns the file's size in bytes, or null when it doesn't exist / isn't a file. */
async function fileSize(path: string): Promise<number | null> {
  try {
    const info = await stat(path)
    return info.isFile() ? info.size : null
  } catch {
    return null
  }
}

/** Verifies the extracted ComfyUI portable build and its embedded python. */
async function checkComfyRuntime(): Promise<SetupComponent> {
  const base: Omit<SetupComponent, 'state' | 'detail'> = {
    id: 'comfyRuntime',
    label: 'ComfyUI portable runtime',
    group: 'comfyui'
  }

  console.log('[verify] checking ComfyUI portable runtime at', getComfyUiPath())

  if (!(await dirExists(getComfyUiPath()))) {
    console.log('[verify] comfyRuntime: missing (folder not found)')
    return { ...base, state: 'missing', detail: 'ComfyUI is not installed.' }
  }
  if ((await fileSize(getComfyPythonPath())) === null) {
    console.log('[verify] comfyRuntime: invalid (python_embeded/python.exe missing)')
    return {
      ...base,
      state: 'invalid',
      detail: 'The ComfyUI folder exists but python_embeded/python.exe is missing.'
    }
  }
  console.log('[verify] comfyRuntime: ok')
  return { ...base, state: 'ok' }
}

/**
 * Verifies each required custom node: its folder has to be there, and the import names its
 * dependencies provide have to resolve — a pack whose pip run failed loads into nothing.
 */
async function checkCustomNodes(): Promise<SetupComponent[]> {
  console.log(`[verify] checking ${PINNED_NODES.length} ComfyUI custom nodes`)
  const present = await Promise.all(
    PINNED_NODES.map((node) => dirExists(getComfyCustomNodePath(node.dirName)))
  )

  // One probe answers for every node that is on disk; each row then reads its own names off it.
  const wanted = [...new Set(PINNED_NODES.filter((_, i) => present[i]).flatMap((n) => n.modules))]
  let missing = new Set<string>()
  let probeError: string | null = null
  if (wanted.length > 0 && (await fileSize(getComfyPythonPath())) !== null) {
    try {
      missing = new Set(await findMissingModules(wanted))
      console.log(
        `[verify] node dependencies: ${wanted.length} names checked, ` +
          `${missing.size === 0 ? 'none missing' : `missing ${[...missing].join(', ')}`}`
      )
    } catch (err) {
      probeError = toAppError(err).message
      console.log(`[verify] node dependencies: probe failed — ${probeError}`)
    }
  }

  return PINNED_NODES.map((node, i): SetupComponent => {
    const base: Omit<SetupComponent, 'state' | 'detail'> = {
      id: `node:${node.id}`,
      label: node.label,
      group: 'comfyui'
    }
    if (!present[i]) {
      console.log(`[verify] node:${node.id} (${node.dirName}): missing`)
      return { ...base, state: 'missing', detail: 'Custom node is not installed.' }
    }
    if (probeError !== null) {
      console.log(`[verify] node:${node.id} (${node.dirName}): invalid (probe failed)`)
      return { ...base, state: 'invalid', detail: probeError }
    }
    const absent = node.modules.filter((name) => missing.has(name))
    if (absent.length > 0) {
      console.log(`[verify] node:${node.id} (${node.dirName}): invalid (${absent.join(', ')})`)
      return {
        ...base,
        state: 'invalid',
        detail:
          `Python dependencies are missing (${absent.join(', ')}). ` +
          'Install missing puts them back.'
      }
    }
    console.log(`[verify] node:${node.id} (${node.dirName}): ok`)
    return { ...base, state: 'ok' }
  })
}

/**
 * Verifies one model file by exact byte size; full SHA256 runs only immediately
 * after download.
 */
async function checkModelFile(
  id: string,
  label: string,
  destDir: string,
  destFile: string,
  expectedBytes: number
): Promise<SetupComponent> {
  const base: Omit<SetupComponent, 'state' | 'detail'> = {
    id: `model:${id}`,
    label,
    group: 'comfyui'
  }

  console.log(`[verify] checking model:${id} at ${destDir}/${destFile}`)
  const size = await fileSize(getComfyModelFilePath(destDir, destFile))
  if (size === null) {
    console.log(`[verify] model:${id}: missing`)
    return { ...base, state: 'missing', detail: 'Model file is not downloaded.' }
  }
  if (size !== expectedBytes) {
    console.log(`[verify] model:${id}: invalid (${size} bytes, expected ${expectedBytes})`)
    return {
      ...base,
      state: 'invalid',
      detail: `Expected ${expectedBytes} bytes but found ${size}. Delete the file and re-download.`
    }
  }
  console.log(`[verify] model:${id}: ok`)
  return { ...base, state: 'ok' }
}

/** Verifies every pinned model, detectors and upscaler included. */
async function checkModels(): Promise<SetupComponent[]> {
  return Promise.all(
    PINNED_MODELS.map((model) =>
      checkModelFile(model.id, model.label, model.destDir, model.destFile, model.bytes)
    )
  )
}

/** Runs startup verification with independent rows for each component. */
export async function getSetupStatus(): Promise<SetupStatus> {
  console.log('[verify] starting setup verification')
  const [comfyRuntime, nodes, models] = await Promise.all([
    checkComfyRuntime(),
    checkCustomNodes(),
    checkModels()
  ])

  const components: SetupComponent[] = [comfyRuntime, ...nodes, ...models]

  const allOk = (group: SetupComponent['group']): boolean =>
    components.filter((c) => c.group === group).every((c) => c.state === 'ok')

  const status: SetupStatus = {
    components,
    comfyReady: allOk('comfyui')
  }
  console.log(
    `[verify] done — comfyReady=${status.comfyReady} ` +
      `(${components.filter((c) => c.state === 'ok').length}/${components.length} components ok)`
  )
  return status
}

/** Downloads the pinned release asset into scratch space and extracts it. */
async function installRuntimeArchive(
  runtime: PinnedRuntime,
  destDir: string,
  wrapperDir: string | null,
  report: Report
): Promise<void> {
  const tempDir = getTempPath()
  await mkdir(tempDir, { recursive: true })
  const archivePath = join(tempDir, runtime.assetName)
  const downloading = `Downloading ${runtime.assetName} (${runtime.tag})`

  report(downloading, 0)
  await downloadFile({
    url: runtimeAssetUrl(runtime),
    destPath: archivePath,
    expectedBytes: runtime.bytes,
    expectedSha256: runtime.sha256,
    onProgress: ({ percent, bytesDone, bytesTotal }) =>
      report(downloading, percent, { done: bytesDone, total: bytesTotal })
  })

  report('Extracting')
  await extract7z(archivePath, destDir, ({ percent }) => report('Extracting', percent))

  if (wrapperDir) {
    report('Finalizing layout')
    await stripWrapperDir(destDir, wrapperDir)
  }

  await rm(archivePath, { force: true })
}

/**
 * Downloads and extracts one custom node, then installs its Python deps and proves they
 * import. `depsOnly` repairs a folder that is already on disk, so nothing is re-downloaded.
 */
async function installCustomNode(
  node: PinnedNode,
  report: Report,
  depsOnly: boolean
): Promise<void> {
  if (!depsOnly) {
    const tempDir = getTempPath()
    await mkdir(tempDir, { recursive: true })
    const archivePath = join(tempDir, `${node.id}.zip`)

    report('Downloading', 0)
    await downloadFile({
      url: nodeZipUrl(node),
      destPath: archivePath,
      expectedBytes: node.bytes,
      expectedSha256: node.sha256,
      onProgress: ({ percent, bytesDone, bytesTotal }) =>
        report('Downloading', percent, { done: bytesDone, total: bytesTotal })
    })

    report('Extracting')
    const customNodesDir = getComfyCustomNodesPath()
    await extractZip(archivePath, customNodesDir)
    await renameExtractedDir(customNodesDir, nodeZipWrapperDir(node), node.dirName)
    await rm(archivePath, { force: true })
  }

  const nodeDir = getComfyCustomNodePath(node.dirName)
  if (await hasRequirements(nodeDir)) {
    report('Installing dependencies')
    await pipInstallRequirements(nodeDir, (line) => report(`pip: ${line}`))
  }

  report('Checking dependencies')
  const missing = await findMissingModules(node.modules)
  if (missing.length > 0) {
    throw appError(
      'NODE_DEPS_MISSING',
      `The node's Python dependencies did not install.`,
      `Missing: ${missing.join(', ')}.`
    )
  }
}

/** Downloads one pinned model and verifies its full SHA256 (the post-download hash tier). */
async function installModel(model: PinnedModel, report: Report): Promise<void> {
  report('Downloading', 0)
  await downloadFile({
    url: model.url,
    destPath: getComfyModelFilePath(model.destDir, model.destFile),
    expectedBytes: model.bytes,
    expectedSha256: model.sha256,
    onProgress: ({ percent, bytesDone, bytesTotal }) =>
      report('Downloading', percent, { done: bytesDone, total: bytesTotal })
  })
}

/** Looks a component id up in the manifest, refusing one that names no model. */
function modelOrThrow(componentId: string): PinnedModel {
  const model = modelForComponentId(componentId)
  if (!model) {
    throw appError('MODEL_UNKNOWN', 'That is not one of the pinned models.', componentId)
  }
  return model
}

/**
 * The folder a hand-downloaded model belongs in, created if absent: the portable build
 * ships without the `ultralytics` subfolders.
 */
export async function getModelFolder(componentId: string): Promise<string> {
  const model = modelOrThrow(componentId)
  const dir = getComfyModelDirPath(model.destDir)
  await mkdir(dir, { recursive: true })
  return dir
}

/**
 * The on-demand verification tier: hashes a model file the player put there by hand
 * and, on a match, adopts it.
 */
export async function verifyModel(componentId: string, report: Report): Promise<SetupStatus> {
  const model = modelOrThrow(componentId)
  const destPath = getComfyModelFilePath(model.destDir, model.destFile)
  const sourcePath = getComfyModelFilePath(model.destDir, model.sourceFile)

  const found =
    (await fileSize(destPath)) !== null
      ? destPath
      : (await fileSize(sourcePath)) !== null
        ? sourcePath
        : null

  if (found === null) {
    throw appError(
      'MODEL_FILE_MISSING',
      `Nothing to check yet — put ${model.sourceFile} in the models folder first.`,
      `Looked for ${model.destFile} and ${model.sourceFile} in ${dirname(destPath)}.`
    )
  }

  report('Verifying', 0)
  const { bytes, sha256 } = await hashFile(found, ({ percent, bytesDone, bytesTotal }) =>
    report('Verifying', percent, { done: bytesDone, total: bytesTotal })
  )

  if (bytes !== model.bytes || sha256.toLowerCase() !== model.sha256.toLowerCase()) {
    throw appError(
      'MODEL_HASH_MISMATCH',
      'That file is not the pinned version of this model.',
      `Expected ${model.bytes} bytes / SHA256 ${model.sha256.toLowerCase()}, found ` +
        `${bytes} bytes / ${sha256}. Download it again from the link on this row.`
    )
  }

  // Renamed only after the hash matches; the startup check is size-only.
  if (found !== destPath) {
    report('Renaming')
    await rm(destPath, { force: true })
    await rename(sourcePath, destPath)
  }

  return getSetupStatus()
}

/**
 * Installs missing or damaged setup components idempotently, isolating per-item
 * failures and returning refreshed status plus errors.
 */
export async function runInstall(
  jobId: string,
  emit: (progress: InstallProgress) => void
): Promise<InstallResult> {
  const errors: InstallResult['errors'] = []
  const status = await getSetupStatus()
  const stateOf = (id: string): SetupComponent['state'] | undefined =>
    status.components.find((c) => c.id === id)?.state

  /** Runs one component's install, isolating its failure from the rest. */
  const runStep = async (
    componentId: string,
    work: (report: Report) => Promise<void>
  ): Promise<void> => {
    if (stateOf(componentId) === 'ok') return

    const report: Report = (step, percent, bytes) =>
      emit({
        jobId,
        componentId,
        step,
        percent,
        bytesDone: bytes?.done,
        bytesTotal: bytes?.total
      })

    try {
      await withRetry(() => work(report), {
        onRetry: (attempt, waitMs) =>
          report(`Attempt ${attempt} failed — retrying in ${Math.round(waitMs / 1000)}s`)
      })
      emit({ jobId, componentId, step: 'Installed', percent: 100, done: true })
    } catch (err) {
      const error = toAppError(err, 'INSTALL_FAILED')
      errors.push({ componentId, error })
      emit({ jobId, componentId, step: 'Failed', done: true, error })
    }
  }

  // 1. ComfyUI portable runtime; the nodes and models install into its tree.
  await runStep('comfyRuntime', (report) =>
    installRuntimeArchive(COMFY_RUNTIME, getComfyUiPath(), COMFY_ARCHIVE_WRAPPER_DIR, report)
  )

  const comfyInstalled = (await fileSize(getComfyPythonPath())) !== null

  if (comfyInstalled) {
    // 2. Custom nodes. A server that is already up skipped whatever is being repaired here,
    //    so it is stopped first and the success path boots a fresh one.
    if (PINNED_NODES.some((node) => stateOf(`node:${node.id}`) !== 'ok')) stopComfy()
    for (const node of PINNED_NODES) {
      await runStep(`node:${node.id}`, (report) =>
        installCustomNode(node, report, stateOf(`node:${node.id}`) === 'invalid')
      )
    }

    // 3. Models, in manifest order — the small files first.
    for (const model of PINNED_MODELS) {
      await runStep(`model:${model.id}`, (report) => installModel(model, report))
    }
  } else {
    // Every dependent row that is not already ok is reported as skipped.
    const blocked = appError(
      'COMFY_RUNTIME_REQUIRED',
      'Skipped because the ComfyUI runtime is not installed.'
    )
    for (const id of [
      ...PINNED_NODES.map((n) => `node:${n.id}`),
      ...PINNED_MODELS.map((m) => `model:${m.id}`)
    ]) {
      if (stateOf(id) === 'ok') continue
      errors.push({ componentId: id, error: blocked })
      emit({ jobId, componentId: id, step: 'Skipped', done: true, error: blocked })
    }
  }

  await rm(getTempPath(), { recursive: true, force: true })

  return { status: await getSetupStatus(), errors }
}
