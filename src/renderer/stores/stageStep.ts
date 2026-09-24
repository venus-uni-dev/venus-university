import { parseSpriteRef } from '@shared/outfits'
import { parseAction } from '@shared/sceneActions'
import { sfwCgRefOf, sfwSpriteRefOf } from '@shared/sfw'
import { READER_SPEAKER, type OutfitSet, type SceneLine, type SpriteRef } from '@shared/types'
import { retireCgs, type CgRetireContext } from './stageDisplay'

/**
 * The scene's stage as its lines write it, one line at a time: what playback applies as each
 * line is reached, and what a rewind folds back up from the log.
 */

/** Number of on-screen portrait slots — left, center, right. Fixed. */
export const PORTRAIT_SLOTS = 3

/** How many drained turns off-stage make a `hide:` a departure rather than a step outside. */
export const DEPARTURE_TURNS = 2

/** The stage facts a line's actions move. */
export interface StageFacts {
  /** Background base name, without the `_day`/`_night` suffix. */
  bg: string | null
  /** charIds occupying the portrait slots, left to right; null = empty. */
  slots: Array<string | null>
  /** Sticky per-character sprite reference, a CG's position among them. */
  emotions: Record<string, SpriteRef>
  /** Sticky mirrored-sprite flag, decided when she is shown. */
  flipped: Record<string, boolean>
  /** charIds whose absence has become a departure. */
  departed: string[]
  /** charIds off-stage right now, mapped to the drained turns each has sat out. */
  offStage: Record<string, number>
  /** The player's hand on the stage, which the scene's own `show:`/`hide:` overrule. */
  stageOverride: Record<string, boolean>
}

/** What applying a line reads beyond the stage itself. */
export interface StageContext extends CgRetireContext {
  /** charKey → charId, for the characters the actions name. */
  charKeyToId: Record<string, string>
  /** The characters by charId, for the pose a newcomer mirrors on. */
  characters: Record<string, { pose: string } | undefined>
}

/** One line applied: the stage after it, and what it showed that the store learns from. */
export interface StageStep {
  stage: StageFacts
  /** The wardrobes the line put somebody in, as applied, in action order. */
  wardrobesSeen: [string, OutfitSet][]
  /**
   * Every happy face the line put on, in action order, with whether she stood on the stage at
   * that moment.
   */
  happyFaces: { charId: string; standing: boolean }[]
}

/** The blank stage: no background, empty slots, nobody sticky, nobody away. */
export function blankStage(): StageFacts {
  return {
    bg: null,
    slots: Array<string | null>(PORTRAIT_SLOTS).fill(null),
    emotions: {},
    flipped: {},
    departed: [],
    offStage: {},
    stageOverride: {}
  }
}

/** Exactly the stage facts out of a record that holds them among others. */
export function stageFactsOf(state: StageFacts): StageFacts {
  return {
    bg: state.bg,
    slots: state.slots,
    emotions: state.emotions,
    flipped: state.flipped,
    departed: state.departed,
    offStage: state.offStage,
    stageOverride: state.stageOverride
  }
}

/**
 * Applies one line's `bg` and actions to the stage, in the order written, so a `sprite:`/`cg:`
 * behind a `show:` lands on a stage that holds her. The input is never mutated.
 */
export function stepStage(stage: StageFacts, line: SceneLine, ctx: StageContext): StageStep {
  const slots = [...stage.slots]
  let emotions = { ...stage.emotions }
  const flipped = { ...stage.flipped }
  let departed = stage.departed
  let offStage = stage.offStage
  let stageOverride = stage.stageOverride
  const wardrobesSeen: [string, OutfitSet][] = []
  const happyFaces: { charId: string; standing: boolean }[] = []

  // Everything here has been through the sanitizer; this applies, never re-validates.
  for (const rawAction of line.actions ?? []) {
    const action = parseAction(rawAction)
    if (!action) continue

    if (action.kind === 'cg') {
      // A CG names no character: it is the lone occupant's.
      const [only, ...others] = slots.filter((id): id is string => Boolean(id))
      // Withheld, the CG becomes an expression on the clothes she is already in.
      if (only && others.length === 0) {
        emotions[only] = ctx.noNsfwImages
          ? sfwCgRefOf(action.position, emotions[only])
          : action.position
      }
      continue
    }

    const charId = ctx.charKeyToId[action.charKey]
    if (!charId) continue

    // A `show:`/`hide:` for her is the scene overruling the hand; a `sprite:` is not one.
    if ((action.kind === 'show' || action.kind === 'hide') && charId in stageOverride) {
      stageOverride = { ...stageOverride }
      delete stageOverride[charId]
    }

    if (action.kind === 'show') {
      // Walking back in ends the absence outright and cancels a departure.
      if (departed.includes(charId)) departed = departed.filter((id) => id !== charId)
      if (charId in offStage) {
        offStage = { ...offStage }
        delete offStage[charId]
      }
      if (!slots.includes(charId)) {
        const free = slots.indexOf(null)
        // A fourth character is dropped by the parser before it gets here.
        if (free !== -1) {
          slots[free] = charId
          // A CG is one girl by herself: somebody joining her ends it.
          emotions = retireCgs(
            emotions,
            slots.filter((id): id is string => Boolean(id) && id !== charId),
            ctx
          )
        }
        // A newcomer sharing a pose with somebody on stage mirrors. Decided here and never
        // revisited.
        const pose = ctx.characters[charId]?.pose
        if (pose && slots.some((id) => id && id !== charId && ctx.characters[id]?.pose === pose)) {
          flipped[charId] = true
        }
      }
    } else if (action.kind === 'hide') {
      const at = slots.indexOf(charId)
      if (at !== -1) slots[at] = null
      // Her CG ends when she walks off, so showing her again brings back a sprite.
      emotions = retireCgs(emotions, [charId], ctx)
      // Off-stage, not gone: the absence starts at zero and is charged by the decision point.
      // A second `hide:` on someone already off must not restart her clock.
      if (!(charId in offStage)) offStage = { ...offStage, [charId]: 0 }
    } else if (action.kind === 'sprite') {
      // Sticky until another action changes it. Withheld, the nude set is dropped off the
      // reference and she keeps the wardrobe she is in.
      emotions[charId] = ctx.noNsfwImages
        ? sfwSpriteRefOf(action.ref, emotions[charId])
        : action.ref
      // Read off the reference as *applied*, never as written: a set withheld above was never
      // on screen.
      const applied = parseSpriteRef(emotions[charId])
      if (applied?.set) wardrobesSeen.push([charId, applied.set])
      if (applied?.emotion === 'happy') {
        happyFaces.push({ charId, standing: slots.includes(charId) })
      }
    }
  }

  return {
    stage: { bg: line.bg ?? stage.bg, slots, emotions, flipped, departed, offStage, stageOverride },
    wardrobesSeen,
    happyFaces
  }
}

/**
 * Charges every running absence one turn: an entry reaching {@link DEPARTURE_TURNS} leaves
 * `offStage` for `departed`, and `settled` names each one that did.
 */
export function chargeAbsences(
  offStage: Record<string, number>,
  departed: string[]
): { offStage: Record<string, number>; departed: string[]; settled: string[] } {
  const charIds = Object.keys(offStage)
  if (charIds.length === 0) return { offStage, departed, settled: [] }
  const next = { ...offStage }
  let gone = departed
  const settled: string[] = []
  for (const charId of charIds) {
    const away = next[charId] + 1
    if (away < DEPARTURE_TURNS) {
      next[charId] = away
      continue
    }
    // Settled: the entry is spent and `departed` answers the prompt builders from here on.
    delete next[charId]
    if (!gone.includes(charId)) gone = [...gone, charId]
    settled.push(charId)
  }
  return { offStage: next, departed: gone, settled }
}

/**
 * The stage `lines` leave behind, folded from a blank one; each reader line is charged a turn of
 * absence first, since every decision point stood right before one. The hand's overrides are
 * folded from none and mean nothing here.
 */
export function stageAt(lines: readonly SceneLine[], ctx: StageContext): StageFacts {
  let stage = blankStage()
  for (const line of lines) {
    if (line.speaker === READER_SPEAKER) {
      const charged = chargeAbsences(stage.offStage, stage.departed)
      stage = { ...stage, offStage: charged.offStage, departed: charged.departed }
    }
    stage = stepStage(stage, line, ctx).stage
  }
  return stage
}

/** Whether a line is the reader's own action. */
function isReaderLine(line: SceneLine): boolean {
  return line.speaker === READER_SPEAKER
}

/** The index of the last reader line in `lines`, or -1 when there is none. */
export function lastReaderIndexOf(lines: readonly SceneLine[]): number {
  for (let at = lines.length - 1; at >= 0; at--) {
    if (isReaderLine(lines[at])) return at
  }
  return -1
}

/** The index of the first reader line in `lines`, or -1 when there is none. */
export function firstReaderIndexOf(lines: readonly SceneLine[]): number {
  return lines.findIndex(isReaderLine)
}

/** The index of the last line in `lines` that is not the reader's, or -1 when there is none. */
export function lastNonReaderIndexOf(lines: readonly SceneLine[]): number {
  for (let at = lines.length - 1; at >= 0; at--) {
    if (!isReaderLine(lines[at])) return at
  }
  return -1
}

/** How many of `lines` are not the reader's. */
export function nonReaderCount(lines: readonly SceneLine[]): number {
  return lines.filter((line) => !isReaderLine(line)).length
}

/**
 * The line a rewind of `log` lands on: the nearest one before the line shown that says
 * something and is not the reader's, back to the scene's first reply, or -1 when there is none.
 */
export function rewindTargetOf(log: readonly SceneLine[]): number {
  const floor = firstReaderIndexOf(log)
  for (let at = lastNonReaderIndexOf(log) - 1; at > floor; at--) {
    if (!isReaderLine(log[at]) && log[at].text.trim() !== '') return at
  }
  return -1
}

/**
 * Whether `log[at]` may be rewritten: a reply line past the scene's first action that is neither
 * the reader's own nor a status line.
 */
export function lineEditable(log: readonly SceneLine[], at: number): boolean {
  return (
    at >= 0 &&
    at < log.length &&
    at > firstReaderIndexOf(log) &&
    !isReaderLine(log[at]) &&
    !log[at].status
  )
}

/**
 * The index on `transcript` of the line `log[at]` was delivered as — as far past the same reader
 * line on both — or -1 when the transcript holds fewer of them. A line only the log holds finds
 * some other line, so callers match the result by value.
 */
export function transcriptIndexOf(
  log: readonly SceneLine[],
  transcript: readonly SceneLine[],
  at: number
): number {
  // The reader lines up to `at`, counted: the k-th one is the anchor on both arrays.
  let actions = 0
  let logAnchor = -1
  for (let i = 0; i <= at && i < log.length; i++) {
    if (!isReaderLine(log[i])) continue
    actions += 1
    logAnchor = i
  }
  if (actions === 0) return at
  let seen = 0
  for (let i = 0; i < transcript.length; i++) {
    if (!isReaderLine(transcript[i])) continue
    seen += 1
    if (seen === actions) return i + (at - logAnchor)
  }
  return -1
}
