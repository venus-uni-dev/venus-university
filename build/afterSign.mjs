import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readdir, rename, stat, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'

/**
 * electron-builder's `afterSign` hook, which runs once the exe carries its icon and
 * version strings: walks the packed app folder and writes `resources/build-manifest.json`,
 * the file list both sides of an update plan from.
 */

export const MANIFEST_REL = 'resources/build-manifest.json'

/** Every file under `dir`, as `/`-joined paths relative to it, the manifest itself excluded. */
async function walk(dir) {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue
    const rel = relative(dir, join(entry.parentPath, entry.name)).replace(/\\/g, '/')
    if (rel === MANIFEST_REL) continue
    out.push(rel)
  }
  out.sort()
  return out
}

/** A file's streamed SHA256, lowercase hex. */
function sha256Of(path) {
  return new Promise((ok, fail) => {
    const hash = createHash('sha256')
    const stream = createReadStream(path)
    stream.on('error', fail)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => ok(hash.digest('hex')))
  })
}

/** The size and hash of every file under `dir`, sorted by path, the manifest itself excluded. */
export async function stampTree(dir) {
  const files = []
  for (const rel of await walk(dir)) {
    const path = join(dir, rel)
    const size = (await stat(path)).size
    const sha256 = await sha256Of(path)
    files.push({ rel, size, sha256 })
  }
  return files
}

/** Stamps the packed folder and writes the manifest beside the app's resources. */
export default async function afterSign(context) {
  const { appOutDir } = context
  const version = context.packager.appInfo.version

  const manifest = { schemaVersion: 1, version, files: await stampTree(appOutDir) }
  const target = join(appOutDir, MANIFEST_REL)
  const tmp = `${target}.tmp`
  await writeFile(tmp, JSON.stringify(manifest, null, 2))
  await rename(tmp, target)
}
