import { describe, expect, it } from 'vitest'
import {
  applyStatDeltas,
  pointsForTier,
  resolveStatDeltas,
  statsForTiers,
  tierOf,
  tierUps,
  TIER_THRESHOLDS,
  type StatTier
} from '@shared/playerStats'
import { playerStats } from './fixtures'

/**
 * The stat arithmetic. Points are persisted, so a threshold read
 * off by one or a delta applied twice writes a save that looks perfectly valid
 * and describes a reader who never earned what it says he did.
 */

describe('tierOf', () => {
  it('puts each threshold in its own tier and the point below it in the previous one', () => {
    TIER_THRESHOLDS.forEach((threshold, i) => {
      expect(tierOf(threshold)).toBe(i + 1)
      if (threshold > 0) expect(tierOf(threshold - 1)).toBe(i)
    })
  })

  it('clamps below zero and above the top threshold', () => {
    // Nothing produces a negative stat — `applyStatDeltas` floors at zero — but
    // a tier lookup that returned 0 would index past the front of TIER_NAMES.
    expect(tierOf(-5)).toBe(1)
    expect(tierOf(10_000)).toBe(TIER_THRESHOLDS.length)
  })
})

describe('pointsForTier / statsForTiers', () => {
  /** Every tier the New Game selector can offer, floor to ceiling. */
  const ALL_TIERS = TIER_THRESHOLDS.map((_, i) => (i + 1) as StatTier)

  it('round-trips: a seeded tier is the tier the save reports back', () => {
    // The selector shows a tier and the save stores points; if these two
    // disagree the player picks Godly and starts the semester Exceptional.
    ALL_TIERS.forEach((tier) => expect(tierOf(pointsForTier(tier))).toBe(tier))
  })

  // A transposed field here seeds New Game's saved stats with another stat's tier.
  it('maps the three tiers independently', () => {
    expect(statsForTiers({ brain: 4, body: 1, heart: 5 })).toEqual(
      playerStats(TIER_THRESHOLDS[3], 0, TIER_THRESHOLDS[4])
    )
  })
})

describe('resolveStatDeltas', () => {
  const plain = { solo: false, classScene: false, classOutcome: null, jobOutcome: null }

  const alone = { solo: true, classScene: false, classOutcome: null, jobOutcome: null }

  it('pays each exercised stat a point plus the focus bonus, each on its own line', () => {
    const { deltas, lines } = resolveStatDeltas({ brain: true, body: false, heart: true }, alone)
    expect(deltas).toEqual(playerStats(2, 0, 2))
    expect(lines).toHaveLength(2)
  })

  // The hour was shared, so it pays one stat and no focus bonus.
  it('pays a scene with company a single point, on one line', () => {
    const { deltas, lines } = resolveStatDeltas({ brain: false, body: false, heart: true }, plain)
    expect(deltas).toEqual(playerStats(0, 0, 1))
    expect(lines).toHaveLength(1)
  })

  // The prompt asks for one stat but the schema cannot enforce it, so the cap is
  // the app's and a reply naming three pays the first.
  it('caps a scene with company at the first stat it named', () => {
    const { deltas, lines } = resolveStatDeltas({ brain: true, body: true, heart: true }, plain)
    expect(deltas).toEqual(playerStats(1, 0, 0))
    expect(lines).toHaveLength(1)
  })

  // A class's point comes off the timetable below instead, so its ledger is
  // never asked — and a stale reply that names one must still pay nothing.
  it('ignores a ledger award on a class the reader sat in', () => {
    const { deltas, lines } = resolveStatDeltas(
      { brain: true, body: true, heart: true },
      { solo: false, classScene: true, classOutcome: { stat: 'brain', attended: true }, jobOutcome: null }
    )
    expect(deltas).toEqual(playerStats(1, 0, 0))
    expect(lines).toHaveLength(1)
  })

  // Ditching is about the timetable, not about what the scene was: the hour he
  // spent elsewhere is judged like any other, and the warning lands on top.
  it('still pays a scene he ditched class for, warning and all', () => {
    const { deltas, lines } = resolveStatDeltas(
      { brain: false, body: false, heart: true },
      { solo: false, classScene: false, classOutcome: { stat: 'brain', attended: false }, jobOutcome: null }
    )
    expect(deltas).toEqual(playerStats(0, 0, 1))
    expect(lines).toHaveLength(2)
  })

  it('rewards attendance on the class’s own stat and only warns about ditching', () => {
    const attended = resolveStatDeltas(undefined, {
      solo: false,
      classScene: true,
      classOutcome: { stat: 'brain', attended: true },
      jobOutcome: null
    })
    expect(attended.deltas).toEqual(playerStats(1, 0, 0))
    expect(attended.lines[0].polarity).toBe('positive')

    const ditched = resolveStatDeltas(undefined, {
      solo: false,
      classScene: false,
      classOutcome: { stat: 'body', attended: false },
      jobOutcome: null
    })
    expect(ditched.deltas).toEqual(playerStats(0, 0, 0))
    expect(ditched.lines).toHaveLength(1)
    expect(ditched.lines[0].polarity).toBe('negative')
  })

  // The showcase is the one assessment that still moves a stat, and it is paid
  // for the presenting rather than for the turning up.
  it('pays a project showcase in heart, in its own words', () => {
    const { deltas, lines } = resolveStatDeltas(undefined, {
      solo: false,
      classScene: true,
      classOutcome: { stat: 'heart', attended: true, showcase: true },
      jobOutcome: null
    })
    expect(deltas).toEqual(playerStats(0, 0, 1))
    expect(lines).toHaveLength(1)
  })

  // A class the reader is the only student of is a class *and* an hour alone,
  // and it is the solo half that decides: the ledger still pays, doubled,
  // on top of the attendance point. Only company drops the ledger's award.
  it('sums every source into one delta while reporting them separately', () => {
    const { deltas, lines } = resolveStatDeltas(
      { brain: true, body: false, heart: false },
      { solo: true, classScene: true, classOutcome: { stat: 'brain', attended: true }, jobOutcome: null }
    )
    expect(deltas.brain).toBe(3)
    expect(lines).toHaveLength(3)
  })

  // A grade is something that happened *inside* the class the reader turned up
  // to, so unlike a shift it stacks rather than replacing.
  it('adds a midterm result on top of every other source', () => {
    const { deltas, lines } = resolveStatDeltas(
      { brain: true, body: false, heart: false },
      {
        solo: true,
        classScene: true,
        classOutcome: { stat: 'brain', attended: true },
        jobOutcome: null,
        gradeOutcome: { heart: 3, lines: [{ text: 'Aced it. Heart went up by 3.', polarity: 'positive' }] }
      }
    )
    expect(deltas).toEqual(playerStats(3, 0, 3))
    expect(lines).toHaveLength(4)
    expect(lines[3]).toEqual({ text: 'Aced it. Heart went up by 3.', polarity: 'positive' })
  })

  it('lets a worked shift replace every other source, the ledger included', () => {
    // A shift is judged by the app alone. If any of these leaked through,
    // a job scene would quietly pay stats twice, which is a save nothing would flag.
    const { deltas, lines } = resolveStatDeltas(
      { brain: true, body: true, heart: true },
      {
        solo: true,
        classScene: true,
        classOutcome: { stat: 'brain', attended: false },
        jobOutcome: { gain: { stats: ['body'], text: 'x' } }
      }
    )
    expect(deltas).toEqual(playerStats(0, 1, 0))
    expect(lines).toHaveLength(1)
  })

  it('pays every stat a two-stat gain names, on the one line', () => {
    const { deltas, lines } = resolveStatDeltas(undefined, {
      solo: false,
      classScene: false,
      classOutcome: null,
      jobOutcome: { gain: { stats: ['body', 'heart'], text: 'x' } }
    })
    expect(deltas).toEqual(playerStats(0, 1, 1))
    expect(lines).toHaveLength(1)
  })
})

describe('applyStatDeltas', () => {
  it('adds and never mutates its input', () => {
    const before = playerStats(4, 4, 4)
    expect(applyStatDeltas(before, playerStats(1, -1, 0))).toEqual(playerStats(5, 3, 4))
    expect(before).toEqual(playerStats(4, 4, 4))
  })

  it('floors at zero, so a loss can never drive a stat negative', () => {
    expect(applyStatDeltas(playerStats(0, 1, 5), playerStats(-1, -1, -1))).toEqual(playerStats(0, 0, 4))
  })
})

describe('tierUps', () => {
  it('reports the stat that crossed and says nothing about the two that did not', () => {
    // 14 is one point under `Decent`; the other two move without reaching it.
    expect(tierUps(playerStats(14, 2, 2), playerStats(1, 1, 1))).toEqual(['brain'])
  })

  it('names a stat once for a movement that crosses two tiers at once', () => {
    expect(tierUps(playerStats(0, 0, 14), playerStats(0, 0, 21))).toEqual(['heart'])
  })

  it('is upward only: a loss that drops a tier is not an announcement', () => {
    expect(tierUps(playerStats(0, 0, 15), playerStats(0, 0, -15))).toEqual([])
  })

  it('reads the thresholds off the ladder, so a stat at a boundary is inside the tier', () => {
    const floor = TIER_THRESHOLDS[1]
    expect(tierUps(playerStats(floor - 1, 0, 0), playerStats(1, 0, 0))).toEqual(['brain'])
    expect(tierUps(playerStats(floor, 0, 0), playerStats(1, 0, 0))).toEqual([])
  })
})
