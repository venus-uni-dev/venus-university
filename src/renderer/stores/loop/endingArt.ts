import { messageOf } from '@shared/errors'
import {
  alphaBounds,
  layoutLineup,
  padBox,
  LINEUP_MIME_TYPE,
  LINEUP_QUALITY,
  LINEUP_SCAN_STEP,
  type LineupSprite
} from '@shared/lineup'
import { loadWardrobeImage } from '../characterStore'
import { useGameStore } from '../gameStore'
import { retrySilently } from '../silentRetry'
import { useUiStore } from '../uiStore'
import { canvasToBase64 } from './encode'
import { armEndingPosts } from './endingPosts'
import { friendCharIds } from './farewells'
import { writeEpilogueSave } from './saves'
import { currentRun, loopState, runStale, LOOP_LLM_GROUP } from './state'

/**
 * The graduation picture, where it meets the store: the reference sheet's arithmetic is pure in
 * `@shared/lineup.ts`; this half reads the roster, drives a canvas and talks to the bridge.
 * {@link armEpilogue} is the one call every way into the epilogue makes, status updates included.
 */

/** How long the ending will wait for a picture that has not arrived, in ms. */
const ENDING_ART_WAIT_MS = 3 * 60_000

/** The object URL the view is rendering, so the next one can revoke it. */
let artUrl: string | null = null

/**
 * Hands the bytes to the view, releasing whatever was on screen before them; the
 * picture is whatever the model answered with, and the image decoder reads the
 * type off the bytes.
 */
function publish(bytes: Uint8Array<ArrayBuffer>): void {
  if (artUrl) URL.revokeObjectURL(artUrl)
  artUrl = URL.createObjectURL(new Blob([bytes]))
  useGameStore.getState().setEndingArt(artUrl)
}

/** Drops the picture and releases the URL behind it, on the way out of a game. */
export function dropEndingArt(): void {
  if (artUrl) URL.revokeObjectURL(artUrl)
  artUrl = null
  const game = useGameStore.getState()
  game.setEndingArt(null)
  game.setEndingArtPending(false)
}

/**
 * One sprite for the sheet: her `happy` frame, or her `neutral` one, or nothing.
 */
async function spriteOf(charId: string): Promise<ImageBitmap | null> {
  for (const emotion of ['happy', 'neutral']) {
    try {
      const bitmap = await loadWardrobeImage(charId, null, emotion)
      if (bitmap) return bitmap
    } catch {
      // Sprites deleted outside the app leave her out of the photograph, silently.
      continue
    }
  }
  return null
}

/** Her opaque bounding box, scanned coarsely and padded back out. */
function trimOf(bitmap: ImageBitmap): LineupSprite | null {
  const width = Math.max(1, Math.round(bitmap.width / LINEUP_SCAN_STEP))
  const height = Math.max(1, Math.round(bitmap.height / LINEUP_SCAN_STEP))
  const scratch = document.createElement('canvas')
  scratch.width = width
  scratch.height = height
  const ctx = scratch.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(bitmap, 0, 0, width, height)

  const { data } = ctx.getImageData(0, 0, width, height)
  const alpha = new Uint8ClampedArray(width * height)
  for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * 4 + 3]

  const scanned = alphaBounds(alpha, width, height)
  if (!scanned) return null
  const full = {
    x: scanned.x * LINEUP_SCAN_STEP,
    y: scanned.y * LINEUP_SCAN_STEP,
    width: scanned.width * LINEUP_SCAN_STEP,
    height: scanned.height * LINEUP_SCAN_STEP
  }
  return {
    width: bitmap.width,
    height: bitmap.height,
    // One scan cell of slack on every side: a downscale averages a hair strand toward nothing.
    art: padBox(full, LINEUP_SCAN_STEP, bitmap.width, bitmap.height)
  }
}

/**
 * Every friend's sprite trimmed, evened out and laid side by side on black — the cast list the
 * image model is handed.
 */
async function stitchFriendLineup(
  charIds: readonly string[]
): Promise<{ data: string; count: number } | null> {
  // Two passes with one bitmap alive at a time — the first measures, the second draws — since
  // twelve full frames decoded at once would be ~95MB.
  const drawn: string[] = []
  const sprites: LineupSprite[] = []
  for (const charId of charIds) {
    const bitmap = await spriteOf(charId)
    if (!bitmap) continue
    const sprite = trimOf(bitmap)
    bitmap.close()
    if (!sprite) continue
    drawn.push(charId)
    sprites.push(sprite)
  }

  const layout = layoutLineup(sprites)
  if (layout.placements.length === 0) return null

  const sheet = document.createElement('canvas')
  sheet.width = layout.width
  sheet.height = layout.height
  const ctx = sheet.getContext('2d')
  if (!ctx) return null
  // Opaque black: the sheet is a JPEG, and a lineup on black reads as "no background".
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, sheet.width, sheet.height)

  for (const [i, placement] of layout.placements.entries()) {
    const bitmap = await spriteOf(drawn[i])
    if (!bitmap) continue
    ctx.drawImage(
      bitmap,
      placement.sx,
      placement.sy,
      placement.sw,
      placement.sh,
      placement.dx,
      placement.dy,
      placement.dw,
      placement.dh
    )
    bitmap.close()
  }

  return {
    data: await canvasToBase64(sheet, LINEUP_MIME_TYPE, LINEUP_QUALITY),
    count: layout.placements.length
  }
}

/** Sends the sheet, re-sending itself quietly for as long as its budget lasts. */
async function send(
  playthroughId: string,
  sheet: { data: string; count: number },
  run: object
): Promise<Uint8Array<ArrayBuffer> | null> {
  for (let spent = 0; ; spent++) {
    const result = await window.api.saves.generateEndingArt(
      playthroughId,
      sheet.data,
      sheet.count,
      LOOP_LLM_GROUP
    )
    if (runStale(run)) return null
    if (result.ok) return result.data
    const again = await retrySilently('ending', result.error, spent, {
      // Cut short when the playthrough is left.
      onSleep: (cancel) => loopState.parkedWaiters.push(cancel)
    })
    if (!again || runStale(run)) return null
  }
}

/** Reads the picture off disk if it belongs to this epilogue, else draws one. */
async function fetchEndingArt(charIds: readonly string[], reuse: boolean): Promise<void> {
  const run = currentRun()
  try {
    const playthroughId = useGameStore.getState().playthroughId
    if (!playthroughId) return

    if (reuse) {
      const found = await window.api.saves.readEndingArt(playthroughId)
      if (runStale(run)) return
      if (found.ok && found.data) {
        publish(found.data)
        return
      }
    }

    const sheet = await stitchFriendLineup(charIds)
    if (runStale(run) || !sheet) return
    const bytes = await send(playthroughId, sheet, run)
    if (runStale(run) || !bytes) return
    publish(bytes)
  } catch (err) {
    console.warn('[ending] no graduation picture:', messageOf(err))
  }
}

/** Starts the graduation picture, or picks up the one already on disk. */
function armEndingArt(): void {
  if (loopState.endingArt) return
  const game = useGameStore.getState()
  const friends = friendCharIds()
  if (friends.length === 0) return

  const reuse = game.endingArtWanted
  if (!reuse) {
    game.markEndingArtWanted()
    // A resumed epilogue is past the goodbyes save that would persist the claim, so it is
    // written here; without it every reload draws the picture again.
    if (game.graduationSeen) void writeEpilogueSave()
  }

  game.setEndingArtPending(true)
  const run = currentRun()
  const capped = Promise.race([
    fetchEndingArt(friends, reuse),
    new Promise<void>((resolve) => setTimeout(resolve, ENDING_ART_WAIT_MS))
  ])
  loopState.endingArt = capped.then(() => {
    // Whichever way it went, the ending stops waiting: this is what makes the spinner terminate.
    if (!runStale(run)) useGameStore.getState().setEndingArtPending(false)
  })
}

/**
 * Everything the epilogue asks for once: the picture and the contacts' last posts. Both are
 * idempotent, so every way into the epilogue may call it.
 */
export function armEpilogue(): void {
  armEndingArt()
  armEndingPosts()
}

/** Hands the reader a copy of the picture; false where the dialog was dismissed or it failed. */
export async function exportEndingArt(): Promise<boolean> {
  const playthroughId = useGameStore.getState().playthroughId
  if (!playthroughId) return false

  const result = await window.api.saves.exportEndingArt(playthroughId)
  if (!result.ok) {
    useUiStore.getState().showError(result.error)
    return false
  }
  return result.data !== null
}
