import { access, open, readdir, rm } from 'fs/promises'
import type { FileHandle } from 'fs/promises'
import { IMAGE_EXTENSION, SHIPPED_EXTENSION } from '@shared/characterFiles'
import { imageTypeOf } from '@shared/imageBytes'

/**
 * Which extension a character image is actually on disk under. The shipped cast is WebP and
 * everything the app renders is PNG, so a reader names the PNG and takes whichever is there.
 */

/** The extensions an image may be under; a writer always makes the first. */
const IMAGE_EXTENSIONS = [IMAGE_EXTENSION, SHIPPED_EXTENSION] as const

/** How much of a file the sniffer reads: the longest signature plus its RIFF form tag. */
const SNIFF_BYTES = 12

/** The same path under each of the other extensions, the one named first. */
function twinsOf(path: string): string[] {
  const dot = path.lastIndexOf('.')
  // A dot in a folder name is not this file's extension.
  if (dot <= Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))) return [path]

  const stem = path.slice(0, dot)
  const named = path.slice(dot).toLowerCase()
  const others = IMAGE_EXTENSIONS.filter((extension) => extension !== named)
  return [path, ...others.map((extension) => `${stem}${extension}`)]
}

/** The file holding the image `path` names, whatever extension it is under, or `null`. */
export async function findImage(path: string): Promise<string | null> {
  for (const candidate of twinsOf(path)) {
    try {
      await access(candidate)
      return candidate
    } catch {
      continue
    }
  }
  return null
}

/** As {@link findImage}, falling back to the path as named so a failed read says that name. */
export async function imagePath(path: string): Promise<string> {
  return (await findImage(path)) ?? path
}

/** Drops the other-extension twins of a file just written, so one stem is one image. */
export async function dropImageTwins(path: string): Promise<void> {
  for (const twin of twinsOf(path).slice(1)) {
    await rm(twin, { force: true }).catch(() => {})
  }
}

/** What an image file's first bytes say it is, or `null` for one that cannot be read. */
export async function sniffImageFile(path: string): Promise<ReturnType<typeof imageTypeOf>> {
  let handle: FileHandle
  try {
    handle = await open(path, 'r')
  } catch {
    return null
  }

  try {
    const head = Buffer.alloc(SNIFF_BYTES)
    const { bytesRead } = await handle.read(head, 0, SNIFF_BYTES, 0)
    return imageTypeOf(head.subarray(0, bytesRead))
  } catch {
    return null
  } finally {
    await handle.close().catch(() => {})
  }
}

/** True for a name this vocabulary would read as an image. */
function isImageName(name: string): boolean {
  return IMAGE_EXTENSIONS.some((extension) => name.toLowerCase().endsWith(extension))
}

/** The stem of an image file name, whichever extension it carries. */
function imageStemOf(name: string): string {
  return name.slice(0, name.lastIndexOf('.'))
}

/** The stems of the images in `dir`, or none where it does not exist. */
export async function imageStemsIn(dir: string): Promise<Set<string>> {
  return new Set((await imageNamesIn(dir)).map(imageStemOf))
}

/** The image file names in `dir`, or none where it does not exist. */
export async function imageNamesIn(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir)).filter(isImageName)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
}
