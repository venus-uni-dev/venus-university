import { describe, expect, it } from 'vitest'
import { FINAL_DATE } from '@shared/classes'
import {
  classSlotOf,
  MIDTERM_WEEK,
  occasionLeadUpLines,
  occasionsOn,
  hauntClosedOn,
  jobClosedOn,
  SPRING_BREAK,
  STATIC_OCCASIONS,
  weekOf
} from '../src/renderer/prompts/occasions'
import {
  normalizeOccasions,
  planOccasionSlots,
  type OccasionRequest
} from '../src/renderer/prompts/occasionPrompt'
import type { Occasion, TimeSlot } from '@shared/types'

function occasionById(id: string): Occasion {
  const found = STATIC_OCCASIONS.find((occasion) => occasion.id === id)
  if (!found) throw new Error(`no static occasion "${id}"`)
  return found
}

/** A generated occasion, placed wherever a test needs one. */
function generatedOccasion(
  id: string,
  title: string,
  startDate: number,
  endDate: number,
  time: TimeSlot | null
): Occasion {
  return {
    id,
    title,
    description: 'Something is on.',
    startDate,
    endDate,
    time,
    cancelsClasses: false,
    kind: 'campus'
  }
}

describe('occasionsOn', () => {
  it('covers the first and last day of a run and neither day outside it', () => {
    const spring = occasionById('spring-break')
    expect(occasionsOn(spring.startDate).map((o) => o.id)).toContain('spring-break')
    expect(occasionsOn(spring.endDate).map((o) => o.id)).toContain('spring-break')
    expect(occasionsOn(spring.startDate - 1).map((o) => o.id)).not.toContain('spring-break')
    expect(occasionsOn(spring.endDate + 1).map((o) => o.id)).not.toContain('spring-break')
  })
})

describe('classSlotOf', () => {
  it('is null on a weekend', () => {
    expect(classSlotOf(5, 0)).toBeNull()
    expect(classSlotOf(6, 1)).toBeNull()
  })

  it('is null in both halves of a day an occasion cancelled', () => {
    // Presidents' Day is a Monday, which would otherwise be slot 0 and 1.
    expect(classSlotOf(28, 0)).toBeNull()
    expect(classSlotOf(28, 1)).toBeNull()
  })

  // Midterms and finals are the trap: they are academic, they are runs, and
  // classes still meet through both of them as exams.
  it('still meets through a run that does not cancel', () => {
    const finals = occasionById('finals-week')
    expect(classSlotOf(finals.startDate, 0)).not.toBeNull()
  })
})

describe('jobClosedOn', () => {
  const CLOSED = SPRING_BREAK.startDate
  const OPEN = 26 // Saturday, February 14 — Valentine's Day, which shuts nothing.

  it('shuts a university employer on a day the university is shut', () => {
    expect(jobClosedOn('agora_tutoring', CLOSED)).toBe(true)
    expect(jobClosedOn('palaestra', CLOSED)).toBe(true)
    expect(jobClosedOn('kendall_library', CLOSED)).toBe(true)
  })

  it('leaves the city open on the same day', () => {
    expect(jobClosedOn('fast_eats', CLOSED)).toBe(false)
    expect(jobClosedOn('club_apogee', CLOSED)).toBe(false)
    expect(jobClosedOn('lumiere', CLOSED)).toBe(false)
  })

  it('shuts nobody on a holiday that does not close the university', () => {
    expect(jobClosedOn('agora_tutoring', OPEN)).toBe(false)
    expect(jobClosedOn('fast_eats', OPEN)).toBe(false)
  })
})

describe('hauntClosedOn', () => {
  const GOOD_FRIDAY = occasionById('good-friday').startDate

  it('empties a campus haunt on a day the university is shut', () => {
    expect(hauntClosedOn('whitman_greenhouse', 'activity', GOOD_FRIDAY)).toBe(true)
    expect(hauntClosedOn('thorne_auditorium', 'activity', GOOD_FRIDAY)).toBe(true)
  })

  // The cafe is the whole point of the study rule: the only place the study menu
  // offers that a closed campus does not already empty.
  it('closes the off-campus study cafe for every day of spring break', () => {
    for (let date = SPRING_BREAK.startDate; date <= SPRING_BREAK.endDate; date++) {
      expect(hauntClosedOn('reserve_bank_cafe', 'study', date)).toBe(true)
    }
  })

  // A day off the books is not a week off them.
  it('leaves the cafe open on a single closed day', () => {
    expect(hauntClosedOn('reserve_bank_cafe', 'study', GOOD_FRIDAY)).toBe(false)
    expect(
      hauntClosedOn('reserve_bank_cafe', 'study', occasionById('reading-day').startDate)
    ).toBe(false)
  })

  // Fun is not study, even at the place the study menu also deals: the break shuts the
  // books, not the arcade.
  it('leaves a fun haunt standing through the break', () => {
    expect(hauntClosedOn('btb_arcade', 'fun', SPRING_BREAK.startDate)).toBe(false)
    expect(hauntClosedOn('cutetea', 'fun', SPRING_BREAK.endDate)).toBe(false)
    expect(hauntClosedOn('reserve_bank_cafe', 'fun', SPRING_BREAK.startDate)).toBe(false)
  })
})

describe('planOccasionSlots', () => {
  /** Which weeks the fixed calendar touches at all — the four named events' bar. */
  const claimed = new Set<number>()
  /** Which weeks a multi-day fixed occasion defines — the fillers' looser bar. */
  const owned = new Set<number>()
  for (const occasion of STATIC_OCCASIONS) {
    for (let date = occasion.startDate; date <= occasion.endDate; date++) {
      claimed.add(weekOf(date))
      if (occasion.endDate > occasion.startDate) owned.add(weekOf(date))
    }
  }

  const NAMED = ['gala', 'dance', 'career-fair', 'concert']

  it('places every occasion legally, over sixty runs', () => {
    for (let run = 0; run < 60; run++) {
      const requests = planOccasionSlots((n) => Array.from({ length: n }, (_, i) => `word${i}`))
      const ids = requests.map((r) => r.id)
      expect(new Set(ids).size).toBe(ids.length)

      for (const request of requests) {
        expect(request.startDate).toBeGreaterThanOrEqual(0)
        expect(request.endDate).toBeLessThanOrEqual(FINAL_DATE)
        expect(request.endDate).toBeGreaterThanOrEqual(request.startDate)
        expect(request.seed.trim()).not.toBe('')

        if (NAMED.includes(request.id)) {
          // A named event owns its week outright, so it needs a clear one.
          expect(claimed.has(weekOf(request.startDate))).toBe(false)
          expect(claimed.has(weekOf(request.endDate))).toBe(false)
        } else if (request.springBreak) {
          // The one filler that goes inside a multi-day occasion, and spring
          // break is the only one it may share a day with.
          expect(request.startDate).toBeGreaterThanOrEqual(SPRING_BREAK.startDate)
          expect(request.endDate).toBeLessThanOrEqual(SPRING_BREAK.endDate)
          expect(occasionsOn(request.startDate).map((o) => o.id)).toEqual(['spring-break'])
        } else {
          // A filler shares a week with a one-day holiday but never the day, and
          // never goes in a week a multi-day run defines.
          expect(owned.has(weekOf(request.startDate))).toBe(false)
          expect(occasionsOn(request.startDate)).toEqual([])
        }
      }
    }
  })
})

describe('occasionLeadUpLines', () => {
  /** Whether the fixture with `title` is one of the lines, static neighbours ignored. */
  function announces(lines: string[], title: string): boolean {
    return lines.some((line) => line.startsWith(`${title}:`))
  }

  // Days 16 through 22 are empty on the fixed calendar, so only a fixture can answer there.
  const D = 20

  it('leads a night occasion up in the day before it, and in no other slot', () => {
    const gala = [generatedOccasion('gala', 'Gala', D, D, 1)]
    expect(announces(occasionLeadUpLines(D, 0, gala), 'Gala')).toBe(true)
    expect(announces(occasionLeadUpLines(D, 1, gala), 'Gala')).toBe(false)
    expect(announces(occasionLeadUpLines(D - 1, 1, gala), 'Gala')).toBe(false)
    expect(announces(occasionLeadUpLines(D - 1, 0, gala), 'Gala')).toBe(false)
  })

  it('leads a day occasion up in the night before it, and in no other slot', () => {
    const fair = [generatedOccasion('career-fair', 'Career Fair', D, D, 0)]
    expect(announces(occasionLeadUpLines(D - 1, 1, fair), 'Career Fair')).toBe(true)
    expect(announces(occasionLeadUpLines(D - 1, 0, fair), 'Career Fair')).toBe(false)
    expect(announces(occasionLeadUpLines(D, 0, fair), 'Career Fair')).toBe(false)
  })

  it('leads a whole-day occasion up in both slots of the day before', () => {
    const dance = [generatedOccasion('dance', 'Dance', D, D, null)]
    expect(announces(occasionLeadUpLines(D - 1, 0, dance), 'Dance')).toBe(true)
    expect(announces(occasionLeadUpLines(D - 1, 1, dance), 'Dance')).toBe(true)
    expect(announces(occasionLeadUpLines(D - 2, 0, dance), 'Dance')).toBe(false)
    expect(announces(occasionLeadUpLines(D - 2, 1, dance), 'Dance')).toBe(false)
    expect(announces(occasionLeadUpLines(D, 0, dance), 'Dance')).toBe(false)
  })

  it('leads a three-day run up for the three days before it', () => {
    const fest = [generatedOccasion('concert', 'Fest', D, D + 2, null)]
    for (const date of [D - 3, D - 2, D - 1]) {
      expect(announces(occasionLeadUpLines(date, 0, fest), 'Fest')).toBe(true)
      expect(announces(occasionLeadUpLines(date, 1, fest), 'Fest')).toBe(true)
    }
    expect(announces(occasionLeadUpLines(D - 4, 0, fest), 'Fest')).toBe(false)
    expect(announces(occasionLeadUpLines(D - 4, 1, fest), 'Fest')).toBe(false)
    expect(announces(occasionLeadUpLines(D, 0, fest), 'Fest')).toBe(false)
  })

  it('leads up nothing that is announced elsewhere', () => {
    const week = [generatedOccasion('midterm-week', 'Fixture Midterms', D, D + 4, null)]
    expect(announces(occasionLeadUpLines(D - 1, 0, week), 'Fixture Midterms')).toBe(false)
    expect(announces(occasionLeadUpLines(D - 1, 1, week), 'Fixture Midterms')).toBe(false)
    expect(
      announces(occasionLeadUpLines(MIDTERM_WEEK.startDate - 1, 1), 'Midterm Week')
    ).toBe(false)
  })
})

describe('normalizeOccasions', () => {
  const request: OccasionRequest = {
    id: 'gala',
    startDate: 12,
    endDate: 13,
    time: 1,
    brief: 'a gala',
    seed: 'lantern'
  }

  it('takes the words from the reply and everything else from the request', () => {
    const [occasion] = normalizeOccasions(
      {
        events: {
          gala: { title: '  The Lantern Ball  ', description: '  Held in the Quad.  ' }
        }
      },
      [request]
    )
    expect(occasion).toEqual({
      id: 'gala',
      title: 'The Lantern Ball',
      description: 'Held in the Quad.',
      startDate: 12,
      endDate: 13,
      time: 1,
      cancelsClasses: false,
      kind: 'campus'
    })
  })

  it('drops an occasion missing either string', () => {
    expect(normalizeOccasions({ events: { gala: { title: 'A Ball' } } }, [request])).toEqual([])
    expect(normalizeOccasions({ events: { gala: { description: 'Words.' } } }, [request])).toEqual(
      []
    )
    expect(
      normalizeOccasions({ events: { gala: { title: '   ', description: 'Words.' } } }, [request])
    ).toEqual([])
  })

  // The model has no field to cancel a class with, but it can still invent one
  // in the object; nothing it says is read.
  it('never lets the reply cancel a class', () => {
    const [occasion] = normalizeOccasions(
      { events: { gala: { title: 'Ball', description: 'Words.', cancelsClasses: true } } },
      [request]
    )
    expect(occasion.cancelsClasses).toBe(false)
  })
})
