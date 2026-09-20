/**
 * The arithmetic behind a sprite's breath, kept out of the view since it is the whole of what
 * decides one: period, phase and the delay a newcomer starts on to be out of step with the row.
 */

/** How long one breath takes at full height, in seconds. Paired with `motion.ts`'s `BREATH`. */
const SPRITE_BREATH_BASE = 4

/** One standing sprite's breath: when it began, how long it runs, and where it began. */
export interface BreathRecord {
  /** Seconds, on whatever clock the caller reads phases against. */
  startedAt: number
  /** Seconds for one full rise and fall. */
  period: number
  /** Where in the cycle it stood at `startedAt`, in [0, 1). */
  phase: number
}

/**
 * How long one breath takes for a character `height` tall — her schema-defined share of the
 * maximum.
 */
export function breathPeriod(height: number): number {
  return SPRITE_BREATH_BASE * height
}

/** Where in her own cycle a sprite stands at `now`, in [0, 1). */
export function breathPhaseAt(breath: BreathRecord, now: number): number {
  const turns = breath.phase + (now - breath.startedAt) / breath.period
  return turns - Math.floor(turns)
}

/** The phase farthest from all of `phases`: the middle of the widest gap between them. */
export function breathPhaseAmong(phases: readonly number[]): number {
  if (phases.length === 0) return 0
  const standing = [...phases].sort((a, b) => a - b)
  let widest = 0
  let after = standing[0]
  for (let i = 0; i < standing.length; i++) {
    // A cycle is a circle, so the last gap wraps: the widest one may be the arc across zero.
    const next = i + 1 < standing.length ? standing[i + 1] : standing[0] + 1
    if (next - standing[i] > widest) {
      widest = next - standing[i]
      after = standing[i]
    }
  }
  const middle = after + widest / 2
  return middle - Math.floor(middle)
}

/** The negative delay that starts a breath at `phase` instead of at the top of its cycle. */
export function breathDelay(phase: number, period: number): number {
  return -phase * period
}
