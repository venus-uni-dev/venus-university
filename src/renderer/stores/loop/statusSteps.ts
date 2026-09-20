/**
 * The scene-end sequence as a list of beats: the lines the player clicks through and
 * the two things that are a screen rather than a line. Pure — the ordering lives here and the
 * playing lives in `gameLoop.ts`.
 */

import {
  STAT_KEYS,
  STAT_LABELS,
  type PlayerStats,
  type StatKey,
  type StatusText
} from '@shared/playerStats'
import { formatMoney } from '@shared/money'
import type { Emotion, Polarity, SceneLine, TextMark } from '@shared/types'
import type { MilestoneReport } from '../sceneSanitizer'

/**
 * The three stat words as one pattern, built from the labels so a renamed stat carries — and
 * case-sensitive, since what it is looking for is the app's own word rather than the reader's.
 */
const STAT_WORDS = new RegExp(
  String.raw`\b(${STAT_KEYS.map((key) => STAT_LABELS[key]).join('|')})\b`,
  'gu'
)

/** Whether a span is already painted: two marks over the same characters draw on top of each other. */
function overlaps(marks: readonly TextMark[], span: { start: number; end: number }): boolean {
  return marks.some((mark) => mark.start < span.end && span.start < mark.end)
}

/** The end of the sentence a mark sits in — what keeps `Brain`'s figure off `Heart`'s number. */
function sentenceEndAfter(text: string, from: number): number {
  const at = text.slice(from).search(/[.!?]/u)
  return at === -1 ? text.length : from + at
}

/** The first figure the same sentence reports after a stat word — the points it moved by. */
function figureAfter(text: string, from: number): { start: number; end: number } | null {
  const rest = text.slice(from, sentenceEndAfter(text, from))
  const hit = /\d+/u.exec(rest)
  if (!hit) return null
  return { start: from + hit.index, end: from + hit.index + hit[0].length }
}

/**
 * One status line as the box will draw it: each stat word marked in its own hue along with the
 * figure that follows it, the money figure colored by which way the balance moved, and a given
 * polarity carried onto the note for the sting its arrival fires.
 */
export function markStatusLine(
  text: string,
  money?: { from: number; to: number },
  polarity?: Polarity
): SceneLine {
  const marks: TextMark[] = []
  STAT_WORDS.lastIndex = 0
  for (let hit = STAT_WORDS.exec(text); hit !== null; hit = STAT_WORDS.exec(text)) {
    const key = STAT_KEYS.find((stat) => STAT_LABELS[stat] === hit[1])
    if (!key) continue
    const end = hit.index + hit[1].length
    marks.push({ start: hit.index, end, tone: key })
    const figure = figureAfter(text, end)
    // The first stat word of a sentence claims its figure; a second one is not marked twice.
    if (figure && !overlaps(marks, figure)) marks.push({ ...figure, tone: key })
  }
  if (money && money.to !== money.from) {
    const figure = formatMoney(Math.abs(money.to - money.from))
    const at = text.indexOf(figure)
    const span = { start: at, end: at + figure.length }
    if (at >= 0 && !overlaps(marks, span)) {
      marks.push({ ...span, tone: money.to > money.from ? 'gain' : 'loss' })
    }
  }
  marks.sort((a, b) => a.start - b.start)
  // A line with nothing to paint, nothing to count and no polarity carries no note at all.
  if (marks.length === 0 && !money && !polarity) return { speaker: '', text }
  return {
    speaker: '',
    text,
    status: { marks, ...(money ? { money } : {}), ...(polarity ? { polarity } : {}) }
  }
}

/** The two beats that own the screen — `gameStore.statusModal`'s value. */
export type StatusModal =
  | {
      kind: 'rankUp'
      /** The stats that crossed; the two readings below say which tiers. */
      ups: StatKey[]
      /** The reader either side of the scene: the chart walks from one to the other. */
      before: PlayerStats
      after: PlayerStats
    }
  | {
      kind: 'milestone'
      charId: string
      name: string
      lines: string[]
      negative: boolean
      /** The face she is drawn with, read off the same flag diff as the sentences. */
      emotion: Emotion
    }

/** One beat: a run of narrator lines, or one of the two modals. */
export type StatusStep = { kind: 'lines'; lines: SceneLine[] } | StatusModal

/** Everything a finished scene has to say, before it is put in order. */
export interface StatusParts {
  /** `resolveStatDeltas`' own lines — the movement, in points, each with which way it went. */
  movement: StatusText[]
  ups: StatKey[]
  before: PlayerStats
  after: PlayerStats
  /**
   * The money sentence, the academic notes and the project note: one run. **Already marked**,
   * since only the loop knows what the balance was either side of the money line.
   */
  ledgerNotes: SceneLine[]
  /**
   * Her paragraph — **already marked** where the sentence and its coloured run were built
   * together; a line that arrives plain is read for its stat words here.
   */
  memories: SceneLine[]
  milestones: MilestoneReport[]
}

/**
 * The scene-end beats in order: movement, a rank-up screen, then money, academic and memory
 * lines as one beat, then one milestone screen per girl. No parts at all yields no steps.
 */
export function buildStatusSteps(parts: StatusParts): StatusStep[] {
  const steps: StatusStep[] = []

  if (parts.movement.length > 0) {
    steps.push({
      kind: 'lines',
      lines: parts.movement.map((line) => markStatusLine(line.text, undefined, line.polarity))
    })
  }
  if (parts.ups.length > 0) {
    steps.push({ kind: 'rankUp', ups: parts.ups, before: parts.before, after: parts.after })
  }

  // The two runs are pushed as one: adjacent lines are one beat, however many sources wrote them.
  const prose = [
    ...parts.ledgerNotes,
    ...parts.memories.map((line) => (line.status ? line : markStatusLine(line.text)))
  ]
  if (prose.length > 0) steps.push({ kind: 'lines', lines: prose })

  for (const report of parts.milestones) steps.push({ kind: 'milestone', ...report })

  return steps
}
