import { describe, expect, it } from 'vitest'
import { CLASS_SLOTS, MAX_CLASS_SIZE, MIN_PLAYER_COURSES, scheduleComplaint } from '@shared/classes'
import { shuffle } from '@shared/shuffle'
import { charKeyOf, type Character, type ClassEntry } from '@shared/types'
import {
  decorateClasses,
  type ClassDraft,
  type ClassGenDraft
} from '../src/renderer/prompts/classPrompt'
import { buildSchedules, SWIM_CLASS } from '../src/renderer/stores/classScheduler'
import { character } from './fixtures'

/**
 * The scheduler runs once per playthrough and freezes into the save forever, so a double-booked
 * slot or a class scheduled but not saved cannot be repaired later. Checked over many random
 * runs rather than fixed examples, since nothing in play would throw over either failure.
 */

const RUNS = 60

function course(
  code: string,
  category: ClassDraft['category'],
  over: Partial<ClassDraft> = {}
): ClassDraft {
  return { code, name: `Course ${code}`, description: 'A course.', category, ...over }
}

/** The scheduler takes a decorated draft; the roll is pinned so only the deal is random. */
function schedule(generated: ClassGenDraft, cast: readonly Character[]) {
  return buildSchedules(decorateClasses(generated, ['Okafor'], () => 0), cast)
}

const NAMES: Array<[string, string]> = [
  ['Sarah', 'Rose'],
  ['Mina', 'Kwon'],
  ['Eve', 'Lang'],
  ['Nia', 'Ito'],
  ['Ada', 'Bell'],
  ['Iris', 'Vance']
]

const MAJORS = ['Biology', 'History']

/**
 * A legal player pick built off the catalog itself: one PE class, then one non-PE course per
 * distinct slot until the minimum is held. Feeding it to `scheduleComplaint` checks that the
 * catalog admits a real schedule, rather than assuming it does.
 */
function legalPick(classes: Record<string, ClassEntry>): Record<number, string> {
  const entries = Object.values(classes)
  const pe = entries.find((entry) => entry.category === 'pe')!
  const pick: Record<number, string> = { [pe.slot]: pe.code }
  let courses = 0
  for (const entry of entries) {
    if (courses >= MIN_PLAYER_COURSES) break
    if (entry.category === 'pe' || entry.slot in pick) continue
    pick[entry.slot] = entry.code
    courses++
  }
  return pick
}

function roster(): Character[] {
  return NAMES.map(([firstName, lastName], i) =>
    character({ charId: `c${i}`, firstName, lastName })
  )
}

function draft(cast: readonly Character[]): ClassGenDraft {
  const classes: ClassDraft[] = []
  for (let i = 0; i < 10; i++) classes.push(course(`PE ${100 + i}`, 'pe'))
  for (const category of ['humanities', 'arts', 'misc'] as const) {
    for (let i = 0; i < 5; i++) classes.push(course(`${category.slice(0, 3).toUpperCase()} ${200 + i}`, category))
  }
  for (const major of MAJORS) {
    for (let i = 0; i < 5; i++) {
      classes.push(course(`${major.slice(0, 3).toUpperCase()} ${300 + i}`, 'major', { major }))
    }
  }

  const characters: ClassGenDraft['characters'] = {}
  cast.forEach((entry, i) => {
    const key = charKeyOf(entry.firstName, entry.lastName)
    const major = MAJORS[i % MAJORS.length]
    classes.push(course(`INT ${400 + i}`, 'interest', { owner: key }))
    characters[key] = {
      year: (i % 4) + 1,
      dorm: 'lowrise_1',
      major,
      classesTaken: 4 + (i % 3),
      majorClassesTaken: 1 + (i % 2),
      interestClass: { code: `INT ${400 + i}`, name: 'Interest', description: 'Hers.' }
    }
  })

  return { characters, classes }
}

describe('buildSchedules invariants', () => {
  const cast = roster()

  it('holds over many randomised runs', () => {
    for (let run = 0; run < RUNS; run++) {
      const { classes, perChar } = schedule(draft(cast), cast)

      expect(Object.keys(perChar).sort()).toEqual(cast.map((c) => c.charId).sort())

      const enrollment = new Map<string, number>()
      for (const entry of cast) {
        const key = charKeyOf(entry.firstName, entry.lastName)
        const profile = draft(cast).characters[key]
        const { schedule } = perChar[entry.charId]
        const slots = Object.keys(schedule).map(Number)

        // One class per slot: the key of the record IS the slot, so a duplicate
        // cannot exist — what can is a slot outside the ten that exist.
        for (const slot of slots) expect(CLASS_SLOTS).toContain(slot)

        // Never over her course load. Under it is a valid outcome (greedy fill).
        expect(slots.length).toBeLessThanOrEqual(profile.classesTaken)

        // Every code she is scheduled into is a class the save actually holds,
        // or the schedule modal and every prompt would reference a phantom.
        for (const code of Object.values(schedule)) {
          expect(classes[code]).toBeDefined()
          expect(classes[code].slot).toBe(Number(Object.entries(schedule).find(([, c]) => c === code)![0]))
          enrollment.set(code, (enrollment.get(code) ?? 0) + 1)
        }
      }

      // Never more students in a class than can fit on screen at once.
      for (const [, count] of enrollment) expect(count).toBeLessThanOrEqual(MAX_CLASS_SIZE)

      // A class nobody takes is not saved, and every saved class has a student.
      for (const code of Object.keys(classes)) expect(enrollment.get(code) ?? 0).toBeGreaterThan(0)

      // The catalog always admits a legal player schedule: the registrar's rule is the one
      // gate before a timetable is saved, and a catalog that cannot pass it strands him there.
      expect(scheduleComplaint(legalPick(classes), classes)).toBeNull()
    }
  })

  it('never leaks the scheduling-only owner field into a saved class', () => {
    const { classes } = schedule(draft(cast), cast)
    for (const entry of Object.values(classes)) {
      expect(entry).not.toHaveProperty('owner')
      expect(entry.slot).toBeTypeOf('number')
    }
  })

  it('seats every character in a PE class', () => {
    // Guaranteed rather than likely, which is why it is an invariant and not a
    // tendency: ten PE classes dealt into ten slots of three occupy at least
    // four of them, only her interest slot is spoken for when the PE step runs,
    // and five girls ahead of her can hold one PE seat each — so a free,
    // non-full PE class is always still standing when her turn comes.
    for (let run = 0; run < RUNS; run++) {
      const { classes, perChar } = schedule(draft(cast), cast)
      for (const entry of cast) {
        const taken = Object.values(perChar[entry.charId].schedule)
        expect(taken.some((code) => classes[code].category === 'pe')).toBe(true)
      }
    }
  })

  it('seats each character in her own interest class', () => {
    const generated = draft(cast)
    const { perChar } = schedule(generated, cast)
    for (const entry of cast) {
      const key = charKeyOf(entry.firstName, entry.lastName)
      const own = generated.classes.find((c) => c.category === 'interest' && c.owner === key)!
      expect(Object.values(perChar[entry.charId].schedule)).toContain(own.code)
    }
  })
})

/**
 * A catalog of exactly two PE classes and profiles that take exactly one class each: with no
 * interest, major or filler courses, only the PE step fires, so who ends up where is pick order
 * alone — exact, not statistical.
 */
function twoPeClasses(size: number): { cast: Character[]; generated: ClassGenDraft } {
  const cast = NAMES.slice(0, size).map(([firstName, lastName], i) =>
    character({ charId: `c${i}`, firstName, lastName })
  )
  const characters: ClassGenDraft['characters'] = {}
  for (const entry of cast) {
    characters[charKeyOf(entry.firstName, entry.lastName)] = {
      year: 1,
      dorm: 'lowrise_1',
      major: 'Biology',
      classesTaken: 1,
      majorClassesTaken: 1,
      // Never added to the catalog, so nothing is seated from it.
      interestClass: { code: 'INT 400', name: 'Interest', description: 'Hers.' }
    }
  }
  return {
    cast,
    generated: { characters, classes: [course('PE 101', 'pe'), course('PE 102', 'pe')] }
  }
}

/** How many students each enrolled class ended up with, ascending. */
function classSizes(perChar: Record<string, { schedule: Record<number, string> }>): number[] {
  const counts = new Map<string, number>()
  for (const { schedule } of Object.values(perChar)) {
    for (const code of Object.values(schedule)) counts.set(code, (counts.get(code) ?? 0) + 1)
  }
  return [...counts.values()].sort()
}

// A class holding one girl is picked before an empty one, and an empty one
// before a class holding two: two in a room is the scene worth writing, three is
// the room the prompt pays for, and opening an empty class is what leaves the
// player courses to pick between.
describe('decorateClasses', () => {
  /**
   * The rolls are stored as fields and nothing else. A sentence folded back into the
   * description would be said twice the moment `fullDescriptionOf` composed it.
   */
  it('rolls the fields without touching the blurb the model wrote', () => {
    const drafted = [course('BIO 210', 'major'), course('PED 101', 'pe')]
    const { classes } = decorateClasses({ classes: drafted }, ['Okafor'], () => 0)

    for (const entry of classes) expect(entry.description).toBe('A course.')
    expect(classes[0]).toMatchObject({ difficulty: 'easy', professor: { lastName: 'Okafor' } })
    expect(classes[1]).toMatchObject({ category: 'pe', instructor: { lastName: 'Okafor' } })
  })
})

describe('the pick order', () => {
  it('pairs girls up before opening a second room', () => {
    for (let run = 0; run < RUNS; run++) {
      const { cast, generated } = twoPeClasses(3)
      // The third girl takes the empty class rather than making a trio.
      expect(classSizes(schedule(generated, cast).perChar)).toEqual([1, 2])
    }
  })

  it('takes a PE class and her major ahead of any filler', () => {
    const cast = [character({ charId: 'c0', firstName: 'Sarah', lastName: 'Rose' })]
    const key = charKeyOf('Sarah', 'Rose')
    // One course per category, so four classes into four distinct slots: no pick
    // can be blocked, and what she carries is the priority order alone. The PE
    // class she attends is the only one, so it becomes the swim class.
    const taken = (classesTaken: number): string[] => {
      const generated: ClassGenDraft = {
        characters: {
          [key]: {
            year: 1,
            dorm: 'lowrise_1',
            major: 'Biology',
            classesTaken,
            majorClassesTaken: 1,
            interestClass: { code: 'INT 400', name: 'Interest', description: 'Hers.' }
          }
        },
        classes: [
          course('INT 400', 'interest', { owner: key }),
          course('PE 101', 'pe'),
          course('BIO 300', 'major', { major: 'Biology' }),
          course('HUM 200', 'humanities')
        ]
      }
      return Object.values(schedule(generated, cast).perChar.c0.schedule).sort()
    }

    for (let run = 0; run < RUNS; run++) {
      expect(taken(1)).toEqual(['INT 400'])
      expect(taken(2)).toEqual(['INT 400', SWIM_CLASS.code].sort())
      expect(taken(3)).toEqual(['BIO 300', 'INT 400', SWIM_CLASS.code].sort())
      expect(taken(4)).toEqual(['BIO 300', 'HUM 200', 'INT 400', SWIM_CLASS.code].sort())
    }
  })
})

// The one class the scheduler authors itself: the most-attended PE class becomes
// the swim class, so the swimsuit wardrobes always have a class to be seen in.
describe('the guaranteed swim class', () => {
  const cast = roster()

  function attendanceOf(perChar: Record<string, { schedule: Record<number, string> }>) {
    const counts = new Map<string, number>()
    for (const { schedule } of Object.values(perChar)) {
      for (const code of Object.values(schedule)) counts.set(code, (counts.get(code) ?? 0) + 1)
    }
    return counts
  }

  it('replaces the most-attended PE class, over many runs', () => {
    for (let run = 0; run < RUNS; run++) {
      const { classes, perChar } = schedule(draft(cast), cast)
      const swim = classes[SWIM_CLASS.code]
      expect(swim).toBeDefined()
      expect(swim).toMatchObject({ code: SWIM_CLASS.code, name: SWIM_CLASS.name, category: 'pe' })

      const counts = attendanceOf(perChar)
      expect(counts.get(SWIM_CLASS.code) ?? 0).toBeGreaterThan(0)
      for (const entry of Object.values(classes)) {
        if (entry.category !== 'pe') continue
        expect(counts.get(SWIM_CLASS.code)!).toBeGreaterThanOrEqual(counts.get(entry.code) ?? 0)
      }
    }
  })

  it('seats itself when no PE class was attended, so a PE class always exists', () => {
    for (let run = 0; run < RUNS; run++) {
      const generated = draft(cast)
      generated.classes = generated.classes.filter((entry) => entry.category !== 'pe')
      const { classes, perChar } = schedule(generated, cast)

      const swim = classes[SWIM_CLASS.code]
      expect(swim).toMatchObject({ code: SWIM_CLASS.code, name: SWIM_CLASS.name, category: 'pe' })
      expect(CLASS_SLOTS).toContain(swim.slot)
      // Seated, not enrolled: nobody was moved into it.
      for (const { schedule } of Object.values(perChar)) {
        expect(Object.values(schedule)).not.toContain(SWIM_CLASS.code)
      }
    }
  })

  it('takes a free code when seating itself over an occupied one', () => {
    for (let run = 0; run < RUNS; run++) {
      const generated = draft(cast)
      generated.classes = generated.classes.filter((entry) => entry.category !== 'pe')
      generated.classes.push(course(SWIM_CLASS.code, 'misc'))
      const { classes, perChar } = schedule(generated, cast)

      // However the codes fell, the swim class exists exactly once and nothing
      // enrolled was overwritten by it.
      const swims = Object.values(classes).filter((entry) => entry.name === SWIM_CLASS.name)
      expect(swims).toHaveLength(1)
      const counts = attendanceOf(perChar)
      for (const [code, entry] of Object.entries(classes)) {
        if (entry.name === SWIM_CLASS.name) continue
        expect(counts.get(code) ?? 0).toBeGreaterThan(0)
      }
    }
  })

  it('keeps the replaced code when the model already invented the swim code', () => {
    for (let run = 0; run < RUNS; run++) {
      const generated = draft(cast)
      generated.classes.push(course(SWIM_CLASS.code, 'pe'))
      const { classes, perChar } = schedule(generated, cast)

      // However the codes fell, no class was lost to a key collision and the
      // swim class exists exactly once, still the front-runner.
      const swims = Object.values(classes).filter((entry) => entry.name === SWIM_CLASS.name)
      expect(swims).toHaveLength(1)
      const counts = attendanceOf(perChar)
      expect(counts.get(swims[0].code) ?? 0).toBeGreaterThan(0)
      for (const code of Object.keys(classes)) expect(counts.get(code) ?? 0).toBeGreaterThan(0)
    }
  })
})

describe('shuffle', () => {
  it('leaves the caller’s array alone', () => {
    const input = [1, 2, 3, 4, 5]
    const copy = [...input]
    const out = shuffle(input)
    expect(input).toEqual(copy)
    expect(out).not.toBe(input)
  })
})
