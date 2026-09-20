/**
 * The player-stat vocabulary: three stats that accumulate points and tier up. Points
 * are stored; a tier is always derived. This module owns the arithmetic and every word said
 * about a stat — the UI labels, the prompt phrasing and the status-message text alike.
 */

import { andList } from './sentences'
import type { Polarity } from './types'

/** The three stats, in display order. */
export type StatKey = 'brain' | 'body' | 'heart'

/** Accumulated points per stat. Never a tier — see {@link tierOf}. */
export interface PlayerStats {
  brain: number
  body: number
  heart: number
}

/** Tier 1 is the floor, tier 5 the ceiling. */
export type StatTier = 1 | 2 | 3 | 4 | 5

/** Every stat key, in the order the status panel lists them. */
export const STAT_KEYS: readonly StatKey[] = ['brain', 'body', 'heart']

/** What the player is shown. The prompt uses {@link STAT_PHRASES} instead. */
export const STAT_LABELS: Record<StatKey, string> = {
  brain: 'Brain',
  body: 'Body',
  heart: 'Heart'
}

/**
 * What a character who prefers a stat is drawn to — the phrase the character-generation question
 * and her contact profile share. Written to complete `"<Name> goes for ___."`.
 */
export const STAT_ATTRACTIONS: Record<StatKey, string> = {
  brain: 'brains',
  body: 'a good body',
  heart: 'charm'
}

/** The plain adjective used when a relationship prompt explains a missing stat requirement. */
export const STAT_REQUIREMENT_PHRASES: Record<StatKey, string> = {
  brain: 'smarter',
  body: 'more fit',
  heart: 'more charming'
}

/** Guard for a stat key read off disk or echoed back by the LLM. */
export function isStatKey(value: unknown): value is StatKey {
  return typeof value === 'string' && (STAT_KEYS as readonly string[]).includes(value)
}

/** Points needed to *enter* each tier, tier 1 first; gaps widen every tier. */
export const TIER_THRESHOLDS: readonly number[] = [0, 15, 35, 60, 100]

/** Tier names, index 0 = tier 1. */
const TIER_NAMES: readonly string[] = [
  'Unremarkable',
  'Decent',
  'Good',
  'Exceptional',
  'Godly'
]

/** The reader description's wording, indexed by tier - 1; each phrase sits after "the reader is". */
const STAT_PHRASES: Record<StatKey, readonly string[]> = {
  brain: [
    'not that interesting',
    'decently smart',
    'pretty smart',
    'exceptionally smart',
    'a god-like genius'
  ],
  body: [
    'a little plain',
    'decently fit',
    'pretty strong and fast',
    'exceptionally strong and fast',
    'a god-like superathlete'
  ],
  heart: [
    'somewhat forgettable',
    'easy to get along with',
    'pretty charming',
    'exceptionally charming',
    'a god-like seducer'
  ]
}

/** All stats at zero — the loader's fallback, and where New Game's selector opens. */
export const DEFAULT_PLAYER_STATS: PlayerStats = { brain: 0, body: 0, heart: 0 }

/** The floor of New Game's stat selector: the tier an untouched row keeps. */
export const STARTING_TIER: StatTier = 1

/** The ceiling of that selector, and of the scale itself. */
export const MAX_TIER: StatTier = 5

/** The fewest points that buy `tier` — what New Game seeds a chosen tier with. */
export function pointsForTier(tier: StatTier): number {
  return TIER_THRESHOLDS[tier - 1]
}

/** The one place a tier choice becomes a savable stat block. */
export function statsForTiers(tiers: Record<StatKey, StatTier>): PlayerStats {
  return {
    brain: pointsForTier(tiers.brain),
    body: pointsForTier(tiers.body),
    heart: pointsForTier(tiers.heart)
  }
}

/** The tier `points` buys: the highest threshold it reaches, clamped both ends. */
export function tierOf(points: number): StatTier {
  let tier = 1
  for (let i = TIER_THRESHOLDS.length - 1; i >= 0; i--) {
    if (points >= TIER_THRESHOLDS[i]) {
      tier = i + 1
      break
    }
  }
  return tier as StatTier
}

/** A tier's display name, e.g. `"Exceptional"` — the one place the table is indexed. */
export function tierNameOf(tier: StatTier): string {
  return TIER_NAMES[tier - 1]
}

/** The tier `points` buys, by display name. */
export function tierName(points: number): string {
  return tierNameOf(tierOf(points))
}

/**
 * The `READER` block's description of the player, weakest stat to strongest. `but`
 * separates the tier-1 stats from the rest; a reader bad at nothing or at everything gets none.
 */
export function describePlayer(stats: PlayerStats): string {
  return describeStats(stats, 'The reader is', 'he is')
}

/** The same description addressed to the player — the intro scroll's `"You're …"` line. */
export function describeReaderToPlayer(stats: PlayerStats): string {
  return describeStats(stats, "You're", "you're")
}

/** Every stat at the top of the scale — the scroll's one branch. */
export function statsMaxed(stats: PlayerStats): boolean {
  return STAT_KEYS.every((key) => tierOf(stats[key]) === MAX_TIER)
}

/** Every stat key, points ascending; ties keep {@link STAT_KEYS} order. */
export function statsLowestFirst(stats: PlayerStats): StatKey[] {
  return [...STAT_KEYS].sort((a, b) => stats[a] - stats[b])
}

/** The one implementation behind both descriptions above: ordering, phrases and the but/and rule. */
function describeStats(stats: PlayerStats, lead: string, rest: string): string {
  const ordered = statsLowestFirst(stats)
  const clauses = ordered.map((key, i) => {
    const phrase = STAT_PHRASES[key][tierOf(stats[key]) - 1]
    return `${i === 0 ? lead : rest} ${phrase}`
  })

  const weakCount = ordered.filter((key) => tierOf(stats[key]) === 1).length
  if (weakCount === 0 || weakCount === clauses.length) return `${andList(clauses)}.`
  return `${andList(clauses.slice(0, weakCount))}, but ${andList(clauses.slice(weakCount))}.`
}

/** One thing a worked shift can pay: the stats it moves a point each, and the sentence that says so. */
export interface ShiftGain {
  stats: readonly StatKey[]
  text: string
}

/** What the app knows about the slot that the ledger does not. */
export interface StatContext {
  /**
   * The scene had no other characters in it: every exercised stat counts, and each pays twice.
   */
  solo: boolean
  /** The scene *was* the reader's class, whose stat the timetable decides. */
  classScene: boolean
  /**
   * The player was enrolled in a class this slot, and whether the scene was in it.
   */
  classOutcome: { stat: StatKey; attended: boolean; showcase?: boolean } | null
  /**
   * The scene was a worked shift, carrying the gain rolled when it was cast. When set it
   * **replaces** everything else here and the ledger's award: the gain's own points are the
   * only stat movement.
   */
  jobOutcome: { gain: ShiftGain } | null
  /** A midterm result that reached the reader this slot, in class or off his phone. */
  gradeOutcome?: { heart: number; lines: StatusText[] } | null
}

/** Which stats the scene exercised, as the ledger reported them. */
export type LedgerStats = Partial<Record<StatKey, boolean>>

/** What one exercised stat is worth — the same point work and attendance pay. */
const AWARD = 1

/** How many stats a scene with company can pay at once. */
const CAST_STATS = 1

/** The extra point each exercised stat earns for an hour spent alone. */
const SOLO_BONUS = 1

/** `"Brain went up by 2."` */
function movementLine(key: StatKey, delta: number): string {
  const direction = delta > 0 ? 'went up' : 'went down'
  return `${STAT_LABELS[key]} ${direction} by ${Math.abs(delta)}.`
}

/** One status sentence and which way it went, for the sting its arrival fires. */
export interface StatusText {
  text: string
  polarity?: Polarity
}

/** Decides a scene's final stat movement and the lines the player reads about it. */
export function resolveStatDeltas(
  ledger: LedgerStats | undefined,
  ctx: StatContext
): { deltas: PlayerStats; lines: StatusText[] } {
  const deltas: PlayerStats = { brain: 0, body: 0, heart: 0 }
  const lines: StatusText[] = []

  // A shift pays only its rolled gain; the early return keeps the ledger's award out.
  if (ctx.jobOutcome) {
    const { gain } = ctx.jobOutcome
    for (const stat of gain.stats) deltas[stat] += AWARD
    lines.push({
      text: `${gain.text} ${gain.stats.map((stat) => movementLine(stat, AWARD)).join(' ')}`,
      polarity: 'positive'
    })
    return { deltas, lines }
  }

  // What the ledger said the hour exercised: all alone, one with company, none for a
  // class the reader sat in.
  const exercised = STAT_KEYS.filter((key) => ledger?.[key] === true)
  const gained = ctx.solo ? exercised : ctx.classScene ? [] : exercised.slice(0, CAST_STATS)
  for (const key of gained) deltas[key] += AWARD
  if (gained.length > 0) {
    lines.push({
      text: gained.map((key) => movementLine(key, AWARD)).join(' '),
      polarity: 'positive'
    })
    // An hour to himself pays each exercised stat a second point, on its own line.
    if (ctx.solo) {
      for (const key of gained) deltas[key] += SOLO_BONUS
      lines.push({
        text:
          'You were able to really focus on your own. ' +
          gained.map((key) => movementLine(key, SOLO_BONUS)).join(' '),
        polarity: 'positive'
      })
    }
  }

  if (ctx.classOutcome) {
    const { stat, attended, showcase } = ctx.classOutcome
    // Attendance pays; ditching costs nothing here.
    if (attended) deltas[stat] += 1
    lines.push(
      attended
        ? {
            text: showcase
              ? `Your presentation skills really got a work out. ${movementLine(stat, 1)}`
              : `Turns out going to class pays off! ${movementLine(stat, 1)}`,
            polarity: 'positive'
          }
        : { text: 'Skipping class is going to hurt later, though...', polarity: 'negative' }
    )
  }

  // Last, on its own lines: the grade's heart movement.
  if (ctx.gradeOutcome) {
    deltas.heart += ctx.gradeOutcome.heart
    lines.push(...ctx.gradeOutcome.lines)
  }

  return { deltas, lines }
}

/**
 * Which stats a slot's movement crossed a tier on. Upward only — losing a tier goes unannounced,
 * since the player didn't cause it. **Stats, not crossings**: the caller already holds the
 * reader either side and reads both tiers off those points, so a tier pair here would double up.
 */
export function tierUps(before: PlayerStats, deltas: PlayerStats): StatKey[] {
  const after = applyStatDeltas(before, deltas)
  return STAT_KEYS.filter((key) => tierOf(after[key]) > tierOf(before[key]))
}

/** Adds `deltas` to `stats`, flooring each at zero. Never mutates its input. */
export function applyStatDeltas(stats: PlayerStats, deltas: PlayerStats): PlayerStats {
  return {
    brain: Math.max(0, stats.brain + deltas.brain),
    body: Math.max(0, stats.body + deltas.body),
    heart: Math.max(0, stats.heart + deltas.heart)
  }
}
