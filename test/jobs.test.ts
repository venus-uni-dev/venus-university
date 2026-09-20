import { describe, expect, it } from 'vitest'
import {
  classSlotForShift,
  CLOSURES_PER_JOB,
  FRESHMAN_JOB_EARLIEST,
  FRESHMAN_JOB_LATEST,
  globalSlotOf,
  offeredShifts,
  placeNpcShifts,
  rollFreshmanJobStart,
  rollJobClosures,
  JOB_CATALOG,
  jobDefForChat,
  jobDefOf,
  bossChatIdOf,
  isBossChat,
  judgeShiftChange,
  MAX_RAISES,
  MAX_STRIKES,
  meetsRequirements,
  newJobState,
  payOf,
  settleShifts,
  shiftRecordOf,
  SHIFT_CHANGE_SLOT,
  SHIFT_SLOTS,
  shiftSlotOf,
  slotFromId,
  unmetRequirements
} from '@shared/jobs'
import { charJobAt, shiftWeekdayOf } from '../src/renderer/prompts/gameDate'
import { pointsForTier, type StatKey } from '@shared/playerStats'
import type { JobState, ShiftSlot } from '@shared/types'
import { charJob, playerStats } from './fixtures'

/**
 * The job arithmetic. A strike applied twice on reload, a raise past the ceiling, or a shift
 * credited to the wrong slot each produce a perfectly loadable `GameSave` describing an
 * employment history that never happened.
 */

/** The global slot id `shiftSlotAt` decodes, so a test can name a slot by date. */
function slotAt(slotId: number): ShiftSlot {
  const { date, time } = slotFromId(slotId)
  return shiftSlotOf(shiftWeekdayOf(date), time)
}

/** A job state with the fields a test cares about, defaults for the rest. */
function job(patch: Partial<JobState> = {}): JobState {
  return { ...newJobState('fast_eats', [], 0), ...patch }
}


describe('judgeShiftChange', () => {
  const midweek = shiftSlotOf(2, 0)

  it('acknowledges a fresh request once and then stays quiet', () => {
    expect(judgeShiftChange(job({ pendingShifts: [1] }), midweek)).toBe('approve')
    expect(
      judgeShiftChange(job({ pendingShifts: [1], shiftChangeApproved: true }), midweek)
    ).toBeNull()
  })

  it('swaps on Sunday Day whether or not the boss got to acknowledge it', () => {
    // A request made on Saturday Night meets the swap as its first boundary and
    // must skip the acknowledgement, or the boss promises a Sunday already here.
    expect(judgeShiftChange(job({ pendingShifts: [1] }), SHIFT_CHANGE_SLOT)).toBe('swap')
    expect(
      judgeShiftChange(job({ pendingShifts: [1], shiftChangeApproved: true }), SHIFT_CHANGE_SLOT)
    ).toBe('swap')
  })
})

describe('rollJobClosures', () => {
  // A player in class every weekday morning — the constraint the roll works around.
  const schedule: Record<number, string> = { 0: 'AAA', 2: 'BBB', 4: 'CCC', 6: 'DDD', 8: 'EEE' }

  it('closes two slots for every all-hours employer and none for the rest', () => {
    // Randomised, so it is asserted over a run rather than once.
    for (let i = 0; i < 60; i++) {
      const closures = rollJobClosures(schedule)
      for (const def of JOB_CATALOG) {
        const closed = closures[def.id]
        if (def.hours.length < SHIFT_SLOTS.length) {
          expect(closed).toBeUndefined()
          continue
        }
        expect(closed).toHaveLength(CLOSURES_PER_JOB)
        expect(new Set(closed).size).toBe(CLOSURES_PER_JOB)
        for (const slot of closed) {
          expect(def.hours).toContain(slot)
          // Closing a slot he has class in is a closure he could never feel.
          const classSlot = classSlotForShift(slot)
          if (classSlot !== null) expect(schedule[classSlot]).toBeUndefined()
        }
      }
    }
  })

  it('subtracts what it closed from what the employer offers', () => {
    const closures = rollJobClosures({})
    const def = jobDefOf('fast_eats')!
    const offered = offeredShifts(def, closures)
    expect(offered).toHaveLength(SHIFT_SLOTS.length - CLOSURES_PER_JOB)
    for (const slot of closures[def.id]) expect(offered).not.toContain(slot)

    // A restricted employer has no closures, so its hours pass through whole —
    // as does any employer's through an empty or absent closure map.
    expect(offeredShifts(jobDefOf('club_apogee')!, closures)).toEqual([3, 5, 7, 9, 11])
    expect(offeredShifts(def, undefined)).toEqual(SHIFT_SLOTS)
    expect(offeredShifts(def, {})).toEqual(SHIFT_SLOTS)
  })
})

describe('placeNpcShifts', () => {
  // A character in class every weekday morning — the constraint placement works
  // around, and the first ten shift slots are exactly those `ClassSlot`s.
  const schedule: Record<number, string> = { 0: 'AAA', 2: 'BBB', 4: 'CCC', 6: 'DDD', 8: 'EEE' }

  it('never rosters her over her own timetable, and only inside the offered hours', () => {
    // Randomised, so it is asserted over a run rather than once.
    for (let i = 0; i < 60; i++) {
      const closures = rollJobClosures({})
      for (const def of JOB_CATALOG) {
        const shifts = placeNpcShifts(def.id, 2, schedule, closures)
        const offered = offeredShifts(def, closures)
        expect(shifts.length).toBeLessThanOrEqual(2)
        expect(new Set(shifts).size).toBe(shifts.length)
        expect([...shifts].sort((a, b) => a - b)).toEqual(shifts)
        for (const slot of shifts) {
          expect(offered).toContain(slot)
          const classSlot = classSlotForShift(slot)
          if (classSlot !== null) expect(schedule[classSlot]).toBeUndefined()
        }
      }
    }
  })

  it('yields fewer than asked when the pool is too thin, rather than repeating one', () => {
    // The library keeps the university's week; block nine of its ten slots.
    const packed: Record<number, string> = { 0: 'A', 1: 'B', 2: 'C', 3: 'D', 4: 'E', 5: 'F', 6: 'G', 7: 'H', 8: 'I' }
    const shifts = placeNpcShifts('kendall_library', 2, packed, {})
    expect(shifts).toEqual([9])
  })

  it('never rosters two characters behind one counter at one hour', () => {
    // Sharing an employer is ordinary; sharing a *shift* makes them each other's
    // alibi, and is what the `taken` argument exists to prevent.
    for (let i = 0; i < 60; i++) {
      const taken: ShiftSlot[] = []
      for (let girl = 0; girl < 5; girl++) {
        const shifts = placeNpcShifts('kendall_library', 2, {}, {}, taken)
        for (const slot of shifts) expect(taken).not.toContain(slot)
        taken.push(...shifts)
      }
      expect(new Set(taken).size).toBe(taken.length)
    }
  })
})

describe('charJobAt', () => {
  // Day 0 is a Monday, so its day half is shift slot 0 and day 5 is a Saturday.
  it('answers the employer on a slot she works, and null everywhere else', () => {
    const job = charJob({ shifts: [0] })
    expect(charJobAt(job, 0, 0)).toBe('cutetea')
    expect(charJobAt(job, 0, 1)).toBeNull()
    expect(charJobAt(job, 1, 0)).toBeNull()
    // The same weekday a week later is the same slot: the week repeats.
    expect(charJobAt(job, 7, 0)).toBe('cutetea')
  })

  it('withholds a freshman job until its start day, then keeps it', () => {
    const job = charJob({ shifts: [0], startsOn: 14 })
    expect(charJobAt(job, 7, 0)).toBeNull()
    expect(charJobAt(job, 14, 0)).toBe('cutetea')
    expect(charJobAt(job, 21, 0)).toBe('cutetea')
  })
})

describe('rollFreshmanJobStart', () => {
  it('can reach both ends of its window', () => {
    expect(rollFreshmanJobStart(() => 0)).toBe(FRESHMAN_JOB_EARLIEST)
    expect(rollFreshmanJobStart(() => 0.999999)).toBe(FRESHMAN_JOB_LATEST)
  })
})

describe('the boss thread key', () => {
  it('round-trips a job id and never collides with a charId', () => {
    const id = bossChatIdOf('club_apogee')
    expect(isBossChat(id)).toBe(true)
    expect(jobDefForChat(id)).toBe(jobDefOf('club_apogee'))
    // charIds are UUIDs, so nothing on the roster can start with the prefix.
    expect(isBossChat('3f2504e0-4f89-11d3-9a0c-0305e82c3301')).toBe(false)
    expect(jobDefForChat('3f2504e0-4f89-11d3-9a0c-0305e82c3301')).toBeUndefined()
  })
})

describe('payOf', () => {
  const base = jobDefOf('fast_eats')!.pay

  it('raises by 20% of the base each time rather than compounding', () => {
    // Compounding would overshoot double at the fifth raise and make the ceiling
    // a rounding artefact instead of a rule.
    expect(payOf(job({ raises: 0 }))).toBe(base)
    expect(payOf(job({ raises: 1 }))).toBe(base * 1.2)
    expect(payOf(job({ raises: 2 }))).toBe(base * 1.4)
    expect(payOf(job({ raises: 3 }))).toBe(base * 1.6)
    expect(payOf(job({ raises: 4 }))).toBe(base * 1.8)
  })

  it('tops out at exactly double, and cannot be pushed past it', () => {
    expect(payOf(job({ raises: MAX_RAISES }))).toBe(base * 2)
    expect(payOf(job({ raises: MAX_RAISES + 3 }))).toBe(base * 2)
  })
})

describe('requirements', () => {
  const apogee = jobDefOf('club_apogee')!

  it('clears a job the reader exactly meets and refuses one point short', () => {
    const exact = playerStats(
      pointsForTier(apogee.requires.brain!),
      pointsForTier(apogee.requires.body!),
      pointsForTier(apogee.requires.heart!)
    )
    expect(meetsRequirements(exact, apogee)).toBe(true)
    expect(unmetRequirements(exact, apogee)).toEqual([])

    const short = { ...exact, heart: exact.heart - 1 }
    expect(meetsRequirements(short, apogee)).toBe(false)
    expect(unmetRequirements(short, apogee)).toEqual(['Heart: Good'])
  })
})

describe('shiftRecordOf', () => {
  /** A restored scene, as much of one as the derivation reads. */
  function scene(
    patch: Partial<{
      jobId: string
      visitJobId: string
      cast: string[]
      jobStats: readonly StatKey[]
    }> = {}
  ) {
    return { cast: [], ...patch }
  }

  it('derives the whole record from the scene and the save', () => {
    // What the cast turn computed, recomputed from state alone — which is what
    // lets a shift survive a reload uncredited by nothing.
    const record = shiftRecordOf(job({ jobId: 'cutetea', raises: 2 }), scene({ jobId: 'cutetea' }), 4, 1)
    expect(record).toEqual({
      slotId: globalSlotOf(4, 1),
      // Raises are part of what the hour pays, and the boundary banks this figure.
      pay: payOf(job({ jobId: 'cutetea', raises: 2 })),
      gain: jobDefOf('cutetea')?.gains[0]
    })
  })

  it('takes the gain the scene rolled, and the first one when it rolled none', () => {
    // Two gains to choose between: the point the boundary pays has to be the one
    // the cast turn rolled, not one re-rolled out from under a reload.
    const def = jobDefOf('fast_eats')
    const heart = def?.gains.find((gain) => gain.stats[0] === 'heart')
    const rolled = shiftRecordOf(
      job({ jobId: 'fast_eats' }),
      scene({ jobId: 'fast_eats', jobStats: ['heart'] }),
      0,
      0
    )
    expect(rolled?.gain).toEqual(heart)
    const unrolled = shiftRecordOf(job({ jobId: 'fast_eats' }), scene({ jobId: 'fast_eats' }), 0, 0)
    expect(unrolled?.gain).toEqual(def?.gains[0])
  })

  it('records nothing for a scene that is not his shift', () => {
    // No job in the scene at all.
    expect(shiftRecordOf(job(), scene(), 0, 0)).toBeNull()
    // Standing at a counter somebody else is working is not a shift, and paying
    // a wage for it is what the two fields being separate prevents.
    expect(shiftRecordOf(job(), scene({ visitJobId: 'fast_eats' }), 0, 0)).toBeNull()
    // Quit or fired mid-scene: the thread's Quit button is live while one plays.
    expect(shiftRecordOf(null, scene({ jobId: 'fast_eats' }), 0, 0)).toBeNull()
    // An employer he does not work for cannot be billed for the hour either.
    expect(shiftRecordOf(job({ jobId: 'cutetea' }), scene({ jobId: 'fast_eats' }), 0, 0)).toBeNull()
  })
})

describe('settleShifts', () => {
  // Monday Day is global slot 0; the reader is rostered for it every week.
  const MONDAY_DAY = shiftSlotOf(0, 0)

  it('judges nothing when the reader is not rostered for the slots that passed', () => {
    const result = settleShifts(job({ shifts: [shiftSlotOf(3, 1)], settledThrough: -1 }), 3, slotAt)
    expect(result.judgements.every((j) => j.strike === null)).toBe(true)
    expect(result.fired).toBe(false)
    expect(result.settledThrough).toBe(3)
  })

  it('strikes a rostered slot the reader never worked', () => {
    const result = settleShifts(job({ shifts: [MONDAY_DAY], settledThrough: -1 }), 1, slotAt)
    expect(result.judgements.filter((j) => j.strike).map((j) => j.strike)).toEqual(['missed'])
    expect(result.settledThrough).toBe(1)
  })

  it('does not strike a shift the reader actually turned up to', () => {
    // `workedSlots` is credited at the boundary, before this ever runs.
    const result = settleShifts(
      job({ shifts: [MONDAY_DAY], settledThrough: -1, workedSlots: [0] }),
      1,
      slotAt
    )
    expect(result.judgements.every((j) => j.strike === null)).toBe(true)
  })

  it('does not strike a rostered slot the employer was closed for', () => {
    const result = settleShifts(
      job({ shifts: [MONDAY_DAY], settledThrough: -1 }),
      1,
      slotAt,
      (slotId) => slotId === 0
    )
    expect(result.judgements.every((j) => j.strike === null)).toBe(true)
    expect(result.fired).toBe(false)
    // The sweep still advances: the closure is judged, not skipped.
    expect(result.settledThrough).toBe(1)
  })

  it('leaves the sick note unspent on a closed slot', () => {
    const result = settleShifts(
      job({ shifts: [MONDAY_DAY], settledThrough: -1, excusedSlot: 0 }),
      1,
      slotAt,
      () => true
    )
    expect(result.excusedUsed).toEqual([])
  })

  it('is idempotent across a replay from the same mark', () => {
    // The boundary's slot-save is written *before* `beginSlot` sweeps, so a
    // reload re-enters this over the same range. Striking twice for one missed
    // shift is the silent corruption this pair of fields exists to prevent.
    const before = job({ shifts: [MONDAY_DAY], settledThrough: -1 })
    const first = settleShifts(before, 1, slotAt)
    expect(first.judgements.filter((j) => j.strike)).toHaveLength(1)

    // The caller advanced the mark; the same range is now behind it.
    const after = job({ shifts: [MONDAY_DAY], settledThrough: first.settledThrough, strikes: 1 })
    const second = settleShifts(after, 1, slotAt)
    expect(second.judgements).toEqual([])
    expect(second.settledThrough).toBe(first.settledThrough)
  })

  it('spends a sick note on exactly the slot it excused, and no other', () => {
    const excused = settleShifts(
      job({ shifts: [MONDAY_DAY], settledThrough: -1, excusedSlot: 0, sickUsed: true }),
      1,
      slotAt
    )
    expect(excused.judgements.every((j) => j.strike === null)).toBe(true)
    expect(excused.excusedUsed).toEqual([0])

    // The same note does not cover next Monday.
    const later = settleShifts(
      job({ shifts: [MONDAY_DAY], settledThrough: 13, excusedSlot: 0, sickUsed: true }),
      14,
      slotAt
    )
    expect(later.judgements.filter((j) => j.strike)).toHaveLength(1)
    expect(later.excusedUsed).toEqual([])
  })

  it('fires on the third strike and stops judging there', () => {
    // Three consecutive Mondays missed, swept in one pass.
    const result = settleShifts(job({ shifts: [MONDAY_DAY], settledThrough: -1 }), 29, slotAt)
    expect(result.judgements.filter((j) => j.strike).map((j) => j.strike)).toEqual([
      'missed',
      'missed2',
      'fired'
    ])
    expect(result.fired).toBe(true)
    // It stops at the firing rather than judging the rest of the range: there is
    // no job left for those slots to belong to.
    expect(result.settledThrough).toBe(28)
  })

  it('carries strikes already banked into the count', () => {
    const result = settleShifts(
      job({ shifts: [MONDAY_DAY], settledThrough: -1, strikes: MAX_STRIKES - 1 }),
      1,
      slotAt
    )
    expect(result.judgements.filter((j) => j.strike).map((j) => j.strike)).toEqual(['fired'])
    expect(result.fired).toBe(true)
  })
})

describe('newJobState', () => {
  it('starts a clean record from the slot the reader was hired in', () => {
    const state = newJobState('cutetea', [shiftSlotOf(3, 1), shiftSlotOf(0, 0)], 17)
    // Sorted, so the grid and the calendar read the roster the same way.
    expect(state.shifts).toEqual([shiftSlotOf(0, 0), shiftSlotOf(3, 1)])
    expect(state.settledThrough).toBe(17)
    expect(state).toMatchObject({ shiftsWorked: 0, earned: 0, raises: 0, streak: 0, strikes: 0 })
    expect(state.sickUsed).toBe(false)
    expect(state.workedSlots).toEqual([])
    // Nothing before the hire can be judged, which is what stops a reader who
    // takes a job on Friday being struck for the Monday he had no job on.
    expect(settleShifts(state, 17, slotAt).judgements).toEqual([])
  })
})
