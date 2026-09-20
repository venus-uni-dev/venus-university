import { copyFile, mkdir, readdir, rename, rm } from 'fs/promises'
import type { Dirent } from 'fs'
import { dirname, join, sep } from 'path'
import { path7za } from '7zip-bin'
import { add, extractFull, list } from 'node-7z'
import { appError, messageOf } from '@shared/errors'
import { randomId } from '@shared/uuid'
import { checkZipListing, MAX_ZIP_BYTES, MAX_ZIP_ENTRIES, type ZipEntry } from '@shared/zipRules'
import { getTempPath } from '../paths'
import { sniffImageFile } from './imageFiles'

/**
 * The bundled 7-Zip. Packaged, `7zip-bin` is read out of the asar, whose paths `spawn` cannot
 * run, while electron-builder has unpacked the executable beside it.
 */
const BIN_7ZA = path7za.replace(`app.asar${sep}`, `app.asar.unpacked${sep}`)

/** Progress emitted while an archive extracts. */
export interface ExtractProgress {
  percent: number
}

/** Extracts a `.7z` archive with the bundled 7-Zip, reporting its progress. */
export async function extract7z(
  archivePath: string,
  destDir: string,
  onProgress?: (progress: ExtractProgress) => void
): Promise<void> {
  await mkdir(destDir, { recursive: true })

  await new Promise<void>((resolve, reject) => {
    const stream = extractFull(archivePath, destDir, {
      $bin: BIN_7ZA,
      $progress: Boolean(onProgress),
      overwrite: 'a'
    })

    stream.on('progress', (progress) => {
      onProgress?.({ percent: progress.percent })
    })
    stream.on('end', () => resolve())
    stream.on('error', (err: Error) => {
      reject(
        appError('EXTRACT_7Z_FAILED', `Could not extract ${archivePath}.`, messageOf(err))
      )
    })
  })
}

/** Zips `sourceDir`'s *contents* into `archivePath` with bundled 7-Zip. */
export async function createZip(sourceDir: string, archivePath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const stream = add(archivePath, join(sourceDir, '*'), {
      $bin: BIN_7ZA,
      $raw: ['-tzip']
    })

    stream.on('end', () => resolve())
    stream.on('error', (err: Error) => {
      reject(appError('ZIP_CREATE_FAILED', `Could not write ${archivePath}.`, messageOf(err)))
    })
  })
}

/** Reads an archive's whole listing with bundled 7-Zip, unpacking nothing. */
export async function listZip(archivePath: string): Promise<ZipEntry[]> {
  return new Promise<ZipEntry[]>((resolve, reject) => {
    const entries: ZipEntry[] = []
    const stream = list(archivePath, { $bin: BIN_7ZA, techInfo: true })

    stream.on('data', (data) => {
      const info = (data as { techInfo?: Map<string, string> }).techInfo
      const size = Number(info?.get('Size'))
      entries.push({
        path: data.file,
        size: Number.isFinite(size) && size > 0 ? size : 0,
        attributes: (info?.get('Attributes') ?? '').trim()
      })
    })
    stream.on('end', () => resolve(entries))
    stream.on('error', (err: Error) => {
      reject(appError('ZIP_LIST_FAILED', 'Could not read that archive.', messageOf(err)))
    })
  })
}

/**
 * Unpacks a `.zip` with bundled 7-Zip, but only once its whole listing has been accepted, and
 * answers with that listing.
 */
export async function extractZip(
  archivePath: string,
  destDir: string,
  limits: { maxEntries: number; maxTotalBytes: number } = {
    maxEntries: MAX_ZIP_ENTRIES,
    maxTotalBytes: MAX_ZIP_BYTES
  }
): Promise<ZipEntry[]> {
  const entries = await listZip(archivePath)
  const reason = checkZipListing(entries, limits)
  if (reason !== null) {
    throw appError('ZIP_REFUSED', 'That archive holds something it may not.', reason)
  }

  await mkdir(destDir, { recursive: true })

  await new Promise<void>((resolve, reject) => {
    // A Mac-made zip would otherwise land a second root entry and break the wrapper check.
    const stream = extractFull(archivePath, destDir, {
      $bin: BIN_7ZA,
      overwrite: 'a',
      $raw: ['-xr!__MACOSX']
    })

    stream.on('end', () => resolve())
    stream.on('error', (err: Error) => {
      reject(appError('EXTRACT_ZIP_FAILED', `Could not extract ${archivePath}.`, messageOf(err)))
    })
  })

  return entries
}

/**
 * Flattens `{parentDir}/{wrapperName}` into `parentDir`; no-ops if already
 * flattened, so reruns do not fail.
 */
export async function stripWrapperDir(parentDir: string, wrapperName: string): Promise<void> {
  const wrapperPath = join(parentDir, wrapperName)

  let entries: string[]
  try {
    entries = await readdir(wrapperPath)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return
    throw appError(
      'STRIP_WRAPPER_FAILED',
      `Could not read the extracted folder ${wrapperPath}.`,
      messageOf(err)
    )
  }

  try {
    for (const entry of entries) {
      const target = join(parentDir, entry)
      await rm(target, { recursive: true, force: true })
      await rename(join(wrapperPath, entry), target)
    }
    await rm(wrapperPath, { recursive: true, force: true })
  } catch (err) {
    throw appError('STRIP_WRAPPER_FAILED', `Could not flatten ${wrapperPath}.`, messageOf(err))
  }
}

/** A scratch folder under `/data/tmp`, on the same volume as the data it will be moved into. */
export function scratchDir(prefix: string): string {
  return join(getTempPath(), `${prefix}-${randomId()}`)
}

/** Best-effort cleanup: a failed run must not leave its scratch behind. */
export async function discard(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true }).catch(() => {})
}

/** Every file under `dir` as a forward-slash relative path. */
export async function relPathsUnder(dir: string, prefix = ''): Promise<string[]> {
  const entries: Dirent[] = await readdir(join(dir, prefix), { withFileTypes: true })
  const paths: string[] = []
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) paths.push(...(await relPathsUnder(dir, rel)))
    else if (entry.isFile()) paths.push(rel)
  }
  return paths
}

/** Copies one file into a folder that may not exist yet. */
export async function copyInto(from: string, to: string): Promise<void> {
  await mkdir(dirname(to), { recursive: true })
  await copyFile(from, to)
}

/**
 * Refuses the whole archive unless every entry is content `classify` keeps or safely drops; a
 * dropped entry is deleted here, before the extracted folder is moved into place.
 */
export async function checkExtractedContent(
  dir: string,
  classify: (rel: string) => string,
  noun: string
): Promise<void> {
  for (const rel of await relPathsUnder(dir)) {
    const role = classify(rel)
    if (role === 'reject') {
      throw appError('IMPORT_BAD_CONTENT', `That ${noun} holds a file that is not one of ours.`, rel)
    }
    if (role === 'skip') {
      await rm(join(dir, rel), { force: true })
      continue
    }
    if (role === 'image' && !(await sniffImageFile(join(dir, rel)))) {
      throw appError('IMPORT_BAD_CONTENT', `That ${noun} holds a file that is not one of ours.`, rel)
    }
  }
}

/** Renames an extracted GitHub `{repo}-{sha}` folder to ComfyUI's node dir. */
export async function renameExtractedDir(
  parentDir: string,
  fromName: string,
  toName: string
): Promise<void> {
  if (fromName === toName) return
  const fromPath = join(parentDir, fromName)
  const toPath = join(parentDir, toName)

  try {
    await rm(toPath, { recursive: true, force: true })
    await rename(fromPath, toPath)
  } catch (err) {
    throw appError(
      'RENAME_EXTRACTED_FAILED',
      `Could not rename ${fromPath} to ${toPath}.`,
      messageOf(err)
    )
  }
}
