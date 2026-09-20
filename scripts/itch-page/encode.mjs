// The picture pipeline's encoding half: turns the masters and frames `stage.mjs` leaves on disk
// into what the store page is uploaded with. Never touches the app, so a size is retried freely.
//
//   node scripts/itch-page/encode.mjs                 # the stills and the GIFs
//   node scripts/itch-page/encode.mjs stills
//   node scripts/itch-page/encode.mjs gifs arcade

import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import sharp from 'sharp'

const HERE = dirname(fileURLToPath(import.meta.url))
export const ROOT = join(HERE, '..', '..')

/** Where the pipeline writes. The masters are gitignored; the stills and the GIFs are not. */
export const OUT_DIR = join(ROOT, 'build', 'itch-page')
export const STILLS_DIR = join(OUT_DIR, 'shots')
export const MASTERS_DIR = join(STILLS_DIR, 'masters')
export const GIFS_DIR = join(OUT_DIR, 'gifs')
export const FRAMES_DIR = join(GIFS_DIR, 'frames')

/** itch caps every image at 3 MB. The ladder aims under this, so the cap is never in question. */
const BUDGET_BYTES = Math.round(2.7 * 1024 * 1024)

/** The sidebar's own slot, and the description column at twice its 873 CSS pixels. */
const SIDEBAR = { width: 1920, height: 1080 }
const DESCRIPTION = { width: 1746, height: 982 }

/** Which of the two sizes each still is written at. */
export const STILLS = {
  lab: SIDEBAR,
  greenhouse: SIDEBAR,
  themePark: SIDEBAR,
  storm: SIDEBAR,
  weightRoom: SIDEBAR,
  friends: DESCRIPTION,
  'map-night': DESCRIPTION,
  characters: DESCRIPTION
}

/**
 * The two GIFs and the pace each is resampled to. A `crop` names the window of the 1746×982 frame
 * the GIF keeps: the phone fills its picture, so the texts read at the column's width.
 */
export const GIFS = {
  arcade: { fps: 10 },
  texts: { fps: 8, crop: { left: 180, top: 0, width: 1410, height: 900 } }
}

/** A GIF plays in the description column, so it is drawn at that column's own width. */
const GIF_WIDTH = 873
const GIF_HEIGHT = 491

/** The last page is held this long, so the loop reads as a beat rather than a stutter. */
const LAST_PAGE_MS = 700

const kb = (bytes) => `${(bytes / 1024).toFixed(0)} KB`

// ─── stills ──────────────────────────────────────────────────────────────────────────────────

/** The `#root` rect the capture recorded, in the master's own pixels; absent, the whole frame. */
function cropOf(name) {
  const path = join(MASTERS_DIR, `${name}.json`)
  if (!existsSync(path)) return null
  return JSON.parse(readFileSync(path, 'utf8')).crop ?? null
}

/** One master, cropped to the window the app drew in and resampled to its page size. */
export async function encodeStill(name) {
  const master = join(MASTERS_DIR, `${name}.png`)
  if (!existsSync(master)) return null
  const size = STILLS[name] ?? DESCRIPTION
  const crop = cropOf(name)

  mkdirSync(STILLS_DIR, { recursive: true })
  const out = join(STILLS_DIR, `${name}.jpg`)
  let image = sharp(master)
  if (crop) image = image.extract(crop)
  const info = await image
    .resize(size.width, size.height, { kernel: 'lanczos3', fit: 'cover' })
    .jpeg({ quality: 86, chromaSubsampling: '4:4:4', mozjpeg: true })
    .toFile(out)
  return { name, out, width: info.width, height: info.height, bytes: statSync(out).size }
}

/** Every master on disk, in the order the page lists them. */
export async function encodeStills(only = null) {
  const names = Object.keys(STILLS).filter((name) => !only || only.includes(name))
  const written = []
  for (const name of names) {
    const result = await encodeStill(name)
    if (!result) {
      console.log(`[page] no master for ${name}`)
      continue
    }
    console.log(`[page] ${result.name}.jpg  ${result.width}×${result.height}  ${kb(result.bytes)}`)
    written.push(result)
  }
  return written
}

// ─── GIFs ────────────────────────────────────────────────────────────────────────────────────

/** The recorded frames of one GIF, as `stage.mjs` wrote them. */
export function framesOf(name) {
  const dir = join(FRAMES_DIR, name)
  const metaPath = join(dir, 'meta.json')
  if (!existsSync(metaPath)) return null
  const meta = JSON.parse(readFileSync(metaPath, 'utf8'))
  return meta.frames.map((frame) => ({ t: frame.t, buf: readFileSync(join(dir, frame.file)) }))
}

/** Puts the frames of one recording on disk, so a re-encode never needs the app again. */
export function writeFrames(name, frames) {
  const dir = join(FRAMES_DIR, name)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  const written = frames.map((frame, at) => {
    const file = `${String(at).padStart(4, '0')}.jpg`
    writeFileSync(join(dir, file), frame.buf)
    return { t: frame.t, file }
  })
  writeFileSync(join(dir, 'meta.json'), JSON.stringify({ frames: written }, null, 2))
  return dir
}

/**
 * Resamples the recording onto a fixed `1000 / fps` tick, taking the most recent frame at each one
 * and collapsing a run of repeats into one page held for the run's length. A screencast only
 * delivers a frame when the compositor draws one, so this turns that into steady playback.
 */
function timeline(frames, fps) {
  const tick = 1000 / fps
  const start = frames[0].t
  const end = frames[frames.length - 1].t
  const pages = []
  let at = 0
  for (let ms = 0; ms <= end - start; ms += tick) {
    while (at + 1 < frames.length && frames[at + 1].t - start <= ms) at++
    const last = pages[pages.length - 1]
    if (last && last.index === at) last.delay += tick
    else pages.push({ index: at, delay: tick })
  }
  return pages
}

/** Each page's own bytes, walked off the GIF's blocks. */
function pageBytes(gif) {
  const tableBytes = (packed) => (packed & 0x80 ? 3 * 2 ** ((packed & 7) + 1) : 0)
  const pastSubBlocks = (from) => {
    let cursor = from
    while (gif[cursor] !== 0) cursor += gif[cursor] + 1
    return cursor + 1
  }
  const sizes = []
  let at = 13 + tableBytes(gif[10])
  while (at < gif.length && gif[at] !== 0x3b) {
    if (gif[at] === 0x21) {
      at = pastSubBlocks(at + 2)
    } else if (gif[at] === 0x2c) {
      const started = at
      at = pastSubBlocks(at + 10 + tableBytes(gif[at + 9]) + 1)
      sizes.push(at - started)
    } else break
  }
  return sizes
}

/** One encode of one rung. The resampled page pictures are cached, since a rung reuses them. */
async function encodeAt(frames, rung, effort, cache, crop = null) {
  const pages = timeline(frames, rung.fps)
  const aspect = crop ? crop.height / crop.width : GIF_HEIGHT / GIF_WIDTH
  const height = Math.round(rung.width * aspect)
  const pictures = []
  for (const page of pages) {
    const key = `${rung.width}:${page.index}`
    if (!cache.has(key)) {
      cache.set(
        key,
        await (crop ? sharp(frames[page.index].buf).extract(crop) : sharp(frames[page.index].buf))
          .resize(rung.width, height, { kernel: 'lanczos3', fit: 'fill' })
          .png()
          .toBuffer()
      )
    }
    pictures.push(cache.get(key))
  }

  const delay = pages.map((page) => Math.max(20, Math.round(page.delay)))
  delay[delay.length - 1] = Math.max(delay[delay.length - 1], LAST_PAGE_MS)
  const gif = await sharp(pictures, { join: { animated: true } })
    .gif({
      colours: rung.colours,
      effort,
      dither: rung.dither,
      interFrameMaxError: rung.ife,
      interPaletteMaxError: 3,
      reuse: Boolean(rung.reuse),
      loop: 0,
      delay
    })
    .toBuffer()
  return { gif, pages: pages.length, width: rung.width, height, delay }
}

/**
 * The step-down ladder, each rung giving up one more thing than the one above it. The first that
 * fits the budget at a cheap effort is the one re-encoded properly.
 */
function ladder(baseFps) {
  const rungs = [
    { fps: baseFps, width: GIF_WIDTH, colours: 200, dither: 0.5, ife: 4 },
    { fps: baseFps, width: GIF_WIDTH, colours: 128, dither: 0.5, ife: 6 },
    { fps: baseFps, width: GIF_WIDTH, colours: 128, dither: 0.2, ife: 8 },
    { fps: 8, width: GIF_WIDTH, colours: 128, dither: 0.2, ife: 8 },
    { fps: 8, width: GIF_WIDTH, colours: 96, dither: 0, ife: 10 },
    { fps: 6, width: GIF_WIDTH, colours: 96, dither: 0, ife: 10 },
    { fps: 6, width: 700, colours: 96, dither: 0, ife: 10 }
  ]
  // A rung identical to the one above it — `texts` is recorded at 8 fps already — is not worth
  // an encode of its own.
  return rungs.filter((rung, at) => at === 0 || JSON.stringify(rung) !== JSON.stringify(rungs[at - 1]))
}

/** A rung as the report names it. */
const nameOf = (rung) =>
  `${rung.fps} fps ${rung.width}w ${rung.colours} colours dither ${rung.dither} ife ${rung.ife}` +
  (rung.reuse ? ' reuse' : '')

/**
 * One GIF: the ladder walked at effort 4 until a rung fits, then that rung re-encoded at effort
 * 10. Prints what every rung cost and what each page of the winner costs, because a per-frame
 * palette shows up as every page being as big as the first.
 */
export async function encodeGif(name, frames = framesOf(name)) {
  if (!frames || frames.length === 0) {
    console.log(`[page] no recorded frames for ${name}`)
    return null
  }
  const fps = (GIFS[name] ?? { fps: 10 }).fps
  const cache = new Map()
  const tried = []

  let winner = null
  for (const rung of ladder(fps)) {
    const attempt = await encodeAt(frames, rung, 4, cache, GIFS[name]?.crop ?? null)
    tried.push({ rung, bytes: attempt.gif.length, pages: attempt.pages })
    if (attempt.gif.length <= BUDGET_BYTES) {
      winner = rung
      break
    }
  }

  console.log(`[page] ${name}: ${frames.length} frames over ${Math.round((frames[frames.length - 1].t - frames[0].t))} ms`)
  for (const attempt of tried) {
    const fits = attempt.bytes <= BUDGET_BYTES ? 'fits' : 'over'
    console.log(`  ${nameOf(attempt.rung).padEnd(52)} ${attempt.pages.toString().padStart(3)} pages  ${kb(attempt.bytes).padStart(8)}  ${fits}`)
  }
  if (!winner) {
    console.log(`  no rung fit ${kb(BUDGET_BYTES)} — shorten the window, then 700 wide, then crop in`)
    return null
  }

  const final = await encodeAt(frames, winner, 10, cache, GIFS[name]?.crop ?? null)
  mkdirSync(GIFS_DIR, { recursive: true })
  const out = join(GIFS_DIR, `${name}.gif`)
  writeFileSync(out, final.gif)

  const sizes = pageBytes(final.gif)
  const total = sizes.reduce((sum, size) => sum + size, 0)
  console.log(
    `  chosen: ${nameOf(winner)} at effort 10 → ${final.width}×${final.height}, ` +
      `${final.pages} pages, ${kb(final.gif.length)}`
  )
  console.log(
    `  pages: first ${kb(sizes[0] ?? 0)}, mean of the rest ` +
      `${kb(sizes.length > 1 ? (total - sizes[0]) / (sizes.length - 1) : 0)}` +
      `${sizes.length > 1 && (total - sizes[0]) / (sizes.length - 1) > sizes[0] * 0.8 ? ' — a full frame per page; try reuse with dither 0' : ''}`
  )
  return { name, out, rung: nameOf(winner), width: final.width, height: final.height, pages: final.pages, bytes: final.gif.length }
}

/** Every recording on disk. */
export async function encodeGifs(only = null) {
  const names = Object.keys(GIFS).filter((name) => !only || only.includes(name))
  const written = []
  for (const name of names) {
    const result = await encodeGif(name)
    if (result) written.push(result)
  }
  return written
}

async function main() {
  const [what, ...only] = process.argv.slice(2)
  const names = only.length > 0 ? only : null
  if (!what || what === 'stills') await encodeStills(names)
  if (!what || what === 'gifs') await encodeGifs(names)
  if (what && what !== 'stills' && what !== 'gifs') {
    throw new Error(`no such target: ${what} (stills, gifs)`)
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((err) => {
    console.error(`[page] ${err.stack ?? err}`)
    process.exitCode = 1
  })
}
