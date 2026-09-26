import { build } from 'esbuild'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/**
 * Lets a plain node script import one of this repo's TypeScript modules with no build step of
 * its own: esbuild bundles the given entry to ESM in memory, `@shared/*` resolved the way
 * `tsconfig.web.json` and `electron.vite.config.ts` map it, and the result is imported from a
 * temp file. Only for a module that is actually pure — one that reaches into a Zustand store,
 * React or the DOM fails at the bundle or the import, not quietly.
 */

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const SHARED_DIR = join(REPO_ROOT, 'src', 'shared')

/** Resolves one `@shared/...` specifier to the file it names, the way esbuild would try it. */
function resolveShared(rest) {
  const base = join(SHARED_DIR, rest)
  for (const candidate of [base, `${base}.ts`, join(base, 'index.ts')]) {
    if (existsSync(candidate)) return candidate
  }
  throw new Error(`ts.mjs: cannot resolve @shared/${rest}`)
}

/** Routes every `@shared/*` import at the alias every build config gives it. */
const sharedAliasPlugin = {
  name: 'shared-alias',
  setup(pluginBuild) {
    pluginBuild.onResolve({ filter: /^@shared\// }, (args) => ({
      path: resolveShared(args.path.slice('@shared/'.length))
    }))
  }
}

/**
 * Bundles `relPath` (repo-root-relative, e.g. `src/shared/saveRules.ts`) to ESM and imports it.
 * Answers the module's namespace object; throws whatever esbuild or the import throws.
 */
export async function loadTs(relPath) {
  const entry = join(REPO_ROOT, relPath)
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    plugins: [sharedAliasPlugin]
  })

  const [out] = result.outputFiles
  const dir = await mkdtemp(join(tmpdir(), 'vu-ts-'))
  const file = join(dir, 'module.mjs')
  await writeFile(file, out.contents)
  try {
    return await import(pathToFileURL(file).href)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
