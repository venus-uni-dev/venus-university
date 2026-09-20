// Dev tool, run by hand: asks Gemini 3.1 Flash Image for a "just finished raining" version of
// each background and writes it beside its source as `<stem>_day_rain.png`.
//
//   node scripts/rain_backgrounds.mjs               every listed background without a rain file yet
//   node scripts/rain_backgrounds.mjs --dry-run     list what would be sent, send nothing
//   node scripts/rain_backgrounds.mjs --only quad,pool   just those stems (before `_day.png`)
//   node scripts/rain_backgrounds.mjs --force       regenerate even where a rain file exists
//
// Not part of the game; nothing imports it.

import { readdir, readFile, writeFile, rename, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import sharp from 'sharp'

// ── Settings ─────────────────────────────────────────────────────────────────────────────

/** Paid Gemini API key. Leave empty and set the GEMINI_API_KEY environment variable to keep it out of git. */
const GEMINI_API_KEY = ''

const MODEL_ID = 'gemini-3.1-flash-image'
const PROMPT =
  'Generate a version of this image where it just finished raining outside and is still a little overcast.'
const BG_DIR = resolve(import.meta.dirname, '..', 'assets', 'bg')
const EXTERIOR_DIR = join(BG_DIR, 'exterior')
const INTERIOR_DIR = join(BG_DIR, 'interior')
/** Exterior stems (the name before `_day.png`) never sent; every other exterior day file is. */
const EXTERIOR_EXCLUDED = ['market']
/** Interior day backgrounds that get a rain version; the rest of the folder is left alone. */
const INTERIOR_STEMS = [
  'campus_hallway',
  'dorm_lounge',
  'elysium_living_room',
  'cute_tea',
  'inside_train',
  'kitchen',
  'lab',
  'lecture_hall',
  'pinocola_lounge',
  'pool',
  'restaurant',
  'weight_room'
]
const CONCURRENCY = 3
const ATTEMPTS = 3
const BACKOFF_MS = [5_000, 15_000, 45_000]
const REQUEST_TIMEOUT_MS = 5 * 60_000

const SAFETY_OFF = [
  'HARM_CATEGORY_HARASSMENT',
  'HARM_CATEGORY_HATE_SPEECH',
  'HARM_CATEGORY_SEXUALLY_EXPLICIT',
  'HARM_CATEGORY_DANGEROUS_CONTENT'
].map((category) => ({ category, threshold: 'BLOCK_NONE' }))

// ── Arguments ────────────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2)
const force = argv.includes('--force')
const dryRun = argv.includes('--dry-run')
const onlyIndex = argv.indexOf('--only')
const only = onlyIndex >= 0 ? (argv[onlyIndex + 1] ?? '').split(',').filter(Boolean) : null
if (onlyIndex >= 0 && (!only || only.length === 0)) {
  console.error('--only needs a comma-separated list of stems, e.g. --only quad,pool')
  process.exit(2)
}

const apiKey = GEMINI_API_KEY || process.env.GEMINI_API_KEY || ''
if (!apiKey && !dryRun) {
  console.error('No API key: fill in GEMINI_API_KEY at the top of scripts/rain_backgrounds.mjs or set the GEMINI_API_KEY environment variable.')
  process.exit(2)
}

// ── Helpers ──────────────────────────────────────────────────────────────────────────────

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff])

/** The type the bytes really are; the file extension and the API's declared type both lie. */
function sniffMime(bytes) {
  if (bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) return 'image/png'
  if (bytes.subarray(0, JPEG_SIGNATURE.length).equals(JPEG_SIGNATURE)) return 'image/jpeg'
  return null
}

const mb = (bytes) => `${(bytes.length / 1024 / 1024).toFixed(1)}MB`
const short = (mime) => (mime ?? 'unknown').replace('image/', '')
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

const sourcePathOf = ({ dir, stem }) => join(dir, `${stem}_day.png`)
const targetPathOf = ({ dir, stem }) => join(dir, `${stem}_day_rain.png`)

class RequestError extends Error {
  constructor(message, retryable) {
    super(message)
    this.retryable = retryable
  }
}

/** One generateContent call: the source image first, then the prompt. Answers the raw image bytes and the declared type. */
async function requestRain(bytes, mime) {
  const body = {
    contents: [
      {
        role: 'user',
        parts: [{ inlineData: { mimeType: mime, data: bytes.toString('base64') } }, { text: PROMPT }]
      }
    ],
    generationConfig: {
      responseModalities: ['TEXT', 'IMAGE'],
      thinkingConfig: { thinkingLevel: 'high' },
      // No aspectRatio: the edit follows the source image.
      imageConfig: { imageSize: '2K' }
    },
    safetySettings: SAFETY_OFF
  }

  let response
  try {
    response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_ID}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      }
    )
  } catch (error) {
    throw new RequestError(`network: ${error?.message ?? error}`, true)
  }

  const text = await response.text()
  if (!response.ok) {
    const retryable = response.status === 429 || response.status >= 500
    throw new RequestError(`HTTP ${response.status}: ${text.slice(0, 500)}`, retryable)
  }

  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new RequestError(`not JSON: ${text.slice(0, 200)}`, true)
  }

  const candidate = parsed.candidates?.[0]
  const parts = candidate?.content?.parts ?? []
  for (const part of parts) {
    if (!part.thought && part.inlineData?.data) {
      return { bytes: Buffer.from(part.inlineData.data, 'base64'), mime: part.inlineData.mimeType }
    }
  }
  const reason = [
    candidate?.finishReason && `finishReason=${candidate.finishReason}`,
    parsed.promptFeedback?.blockReason && `blockReason=${parsed.promptFeedback.blockReason}`,
    parts.map((part) => part.text ?? '').join('').slice(0, 300)
  ]
    .filter(Boolean)
    .join(' | ')
  throw new RequestError(`no image in reply: ${reason || text.slice(0, 300)}`, true)
}

/** Re-encodes whatever the model answered as a PNG and reads its size. */
async function toPng(bytes) {
  const png = await sharp(bytes).png().toBuffer()
  const { width, height } = await sharp(png).metadata()
  return { png, width, height }
}

async function withRetries(fn, label) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn()
    } catch (error) {
      const canRetry = error instanceof RequestError && error.retryable && attempt < ATTEMPTS
      if (!canRetry) throw error
      const wait = BACKOFF_MS[attempt - 1] ?? BACKOFF_MS.at(-1)
      console.warn(`  ${label}: attempt ${attempt} failed (${error.message}); retrying in ${wait / 1000}s`)
      await sleep(wait)
    }
  }
}

async function processOne(job) {
  const { stem } = job
  const targetPath = targetPathOf(job)
  const tempPath = `${targetPath}.tmp`

  const source = await readFile(sourcePathOf(job))
  const sourceMime = sniffMime(source)
  if (!sourceMime) throw new Error(`${stem}: source is neither PNG nor JPEG`)
  console.log(`→ ${stem} (${short(sourceMime)}, ${mb(source)})`)

  const started = Date.now()
  const answer = await withRetries(() => requestRain(source, sourceMime), stem)
  const realMime = sniffMime(answer.bytes)
  if (!realMime) throw new Error(`${stem}: the model answered ${answer.bytes.length} bytes that are not an image (declared ${answer.mime})`)
  const declared = realMime === answer.mime ? short(realMime) : `${short(realMime)}, declared ${short(answer.mime)}`

  const { png, width, height } = await toPng(answer.bytes)
  await writeFile(tempPath, png)
  await rename(tempPath, targetPath)
  const seconds = Math.round((Date.now() - started) / 1000)
  console.log(`← ${stem} ${width}×${height} ${declared} → png ${mb(png)} in ${seconds}s`)
}

// ── Main ─────────────────────────────────────────────────────────────────────────────────

const exteriorNames = await readdir(EXTERIOR_DIR)
const exteriorJobs = exteriorNames
  .filter((name) => name.endsWith('_day.png'))
  .map((name) => name.slice(0, -'_day.png'.length))
  .filter((stem) => !EXTERIOR_EXCLUDED.includes(stem))
  .sort()
  .map((stem) => ({ dir: EXTERIOR_DIR, stem }))
const interiorJobs = INTERIOR_STEMS.map((stem) => ({ dir: INTERIOR_DIR, stem }))

const missing = interiorJobs.filter((job) => !existsSync(sourcePathOf(job)))
for (const job of missing) console.warn(`interior ${job.stem}: no ${sourcePathOf(job)}; dropped`)

const jobs = [...exteriorJobs, ...interiorJobs.filter((job) => !missing.includes(job))].filter(
  (job) => !only || only.includes(job.stem)
)

if (only) {
  for (const stem of only) {
    if (!jobs.some((job) => job.stem === stem)) console.warn(`--only ${stem}: not an exterior day file or a listed interior (or it is excluded)`)
  }
}

const skipped = []
const queue = []
for (const job of jobs) {
  if (!force && existsSync(targetPathOf(job))) skipped.push(job)
  else queue.push(job)
}

const stemsOf = (list) => list.map((job) => job.stem).join(', ')
console.log(`${MODEL_ID}, thinking high, 2K, aspect auto; ${BG_DIR}`)
if (skipped.length) console.log(`skipping (rain file exists, --force to redo): ${stemsOf(skipped)}`)
if (queue.length === 0) {
  console.log('nothing to send')
  process.exit(0)
}
console.log(`${dryRun ? 'would send' : 'sending'} ${queue.length}: ${stemsOf(queue)}`)
if (dryRun) process.exit(0)

const failures = []
let written = 0
let next = 0
async function worker() {
  while (next < queue.length) {
    const job = queue[next++]
    try {
      await processOne(job)
      written++
    } catch (error) {
      failures.push({ stem: job.stem, message: error?.message ?? String(error) })
      console.error(`✗ ${job.stem}: ${error?.message ?? error}`)
      await rm(`${targetPathOf(job)}.tmp`, { force: true })
    }
  }
}
await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker))

console.log(`\nwritten ${written}, skipped ${skipped.length}, failed ${failures.length}`)
for (const { stem, message } of failures) console.log(`  ${stem}: ${message}`)
process.exit(failures.length ? 1 : 0)
