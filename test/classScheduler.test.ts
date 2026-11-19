import { describe, expect, it } from 'vitest'
import { CLASS_SLOTS, MAX_CLASS_SIZE, scheduleComplaint, studentsOf } from '@shared/classes'
import { shuffle } from '@shared/shuffle'
import { charKeyOf, type Character, type ClassEntry, type CourseEntry } from '@shared/types'
import {
  decorateClasses,
  type ClassDraft,
  type ClassGenDraft
} from '../src/renderer/prompts/classPrompt'
import {
  buildSchedules,
  seatTransfer,
  slotTransferClasses,
  SWIM_CLASS,
  type UnslottedCourse
} from '../src/renderer/stores/classScheduler'
import { character, classEntry, lcg, legalPick, peClassEntry } from './fixtures'

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

  it('never leaks the scheduling-only owner and written fields into a saved class', () => {
    const generated = draft(cast)
    generated.classes = generated.classes.map((entry, i) =>
      i % 2 === 0 ? { ...entry, written: true } : entry
    )
    const { classes } = schedule(generated, cast)
    for (const entry of Object.values(classes)) {
      expect(entry).not.toHaveProperty('owner')
      expect(entry).not.toHaveProperty('written')
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

  it('seats girls in the player’s own classes first, still pairing them up', () => {
    for (let run = 0; run < RUNS; run++) {
      const { cast, generated } = twoPeClasses(3)
      generated.classes[1].written = true
      const { perChar } = schedule(generated, cast)
      const inWritten = Object.values(perChar).filter(({ schedule }) =>
        Object.values(schedule).includes('PE 102')
      )
      expect(inWritten).toHaveLength(2)
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

// The one class the scheduler authors itself: the most-attended PE class the player did not
// write becomes the swim class, so the swimsuit wardrobes have a class to be seen in.
describe('the swim class', () => {
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

  it('replaces a PE class the player left blank over a fuller one the player wrote', () => {
    for (let run = 0; run < RUNS; run++) {
      const { cast, generated } = twoPeClasses(3)
      generated.classes[1].written = true
      const { classes, perChar } = schedule(generated, cast)
      expect(classes['PE 102']).toMatchObject({ name: 'Course PE 102' })
      expect(classes[SWIM_CLASS.code]).toMatchObject({ name: SWIM_CLASS.name, category: 'pe' })
      expect(attendanceOf(perChar).get(SWIM_CLASS.code)).toBe(1)
    }
  })

  it('makes no swim class where every PE class attended is the player’s', () => {
    for (let run = 0; run < RUNS; run++) {
      const generated = draft(cast)
      generated.classes = generated.classes.map((entry) =>
        entry.category === 'pe' ? { ...entry, written: true } : entry
      )
      const { classes } = schedule(generated, cast)
      expect(Object.values(classes).some((entry) => entry.name === SWIM_CLASS.name)).toBe(false)
      expect(Object.values(classes).some((entry) => entry.category === 'pe')).toBe(true)
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

describe('seatTransfer', () => {
  // A catalog with its slots fixed: two PE classes, two Biology, one History, four fillers.
  const catalog: Record<string, ClassEntry> = Object.fromEntries(
    [
      peClassEntry({ code: 'PED 101', slot: 0 }),
      peClassEntry({ code: 'PED 102', slot: 1 }),
      classEntry({ code: 'BIO 201', slot: 2, major: 'Biology' }),
      classEntry({ code: 'BIO 202', slot: 3, major: 'Biology' }),
      classEntry({ code: 'HIS 201', slot: 4, major: 'History' }),
      classEntry({ code: 'HUM 201', slot: 5, category: 'humanities' }),
      classEntry({ code: 'ART 201', slot: 6, category: 'arts' }),
      classEntry({ code: 'MSC 201', slot: 7, category: 'misc' }),
      classEntry({ code: 'INT 201', slot: 8, category: 'interest' })
    ].map((entry) => [entry.code, entry])
  )
  const entries = Object.values(catalog)

  /** Ten girls in random classes, never more than a class holds. */
  function standing(rand: () => number): Record<string, { schedule: Record<number, string> }> {
    const out: Record<string, { schedule: Record<number, string> }> = {}
    const seated = new Map<string, number>()
    for (let i = 0; i < 10; i++) {
      const schedule: Record<number, string> = {}
      for (const entry of entries) {
        if (rand() < 0.5 || (seated.get(entry.code) ?? 0) >= MAX_CLASS_SIZE) continue
        schedule[entry.slot] = entry.code
        seated.set(entry.code, (seated.get(entry.code) ?? 0) + 1)
      }
      out[`g${i}`] = { schedule }
    }
    return out
  }

  it('keeps every class to its size, every class in its slot, and her load and major', () => {
    const rand = lcg(7)
    for (let run = 0; run < RUNS; run++) {
      const schedules = standing(rand)
      const classesTaken = 3 + Math.floor(rand() * 4)
      const majorClassesTaken = 1 + Math.floor(rand() * 3)
      const { schedule } = seatTransfer(
        { major: 'Biology', classesTaken, majorClassesTaken },
        catalog,
        schedules,
        { 0: 'PED 101', 4: 'HIS 201', 6: 'ART 201' },
        rand
      )
      expect(Object.keys(schedule).length).toBeLessThanOrEqual(classesTaken)
      expect(Object.values(schedule)).not.toContain('HIS 201')
      const all = { ...schedules, her: { schedule } }
      for (const [slot, code] of Object.entries(schedule)) {
        expect(catalog[code].slot).toBe(Number(slot))
      }
      for (const entry of entries) {
        expect(studentsOf(entry, Object.keys(all), all).length).toBeLessThanOrEqual(MAX_CLASS_SIZE)
      }
    }
  })

  it('takes one of the reader’s classes with a seat free before an emptier one', () => {
    // The reader's arts class holds two already; every other filler stands empty, and his History
    // class is another major's.
    const schedules = { a: { schedule: { 6: 'ART 201' } }, b: { schedule: { 6: 'ART 201' } } }
    for (let run = 0; run < RUNS; run++) {
      const { schedule } = seatTransfer(
        { major: 'Biology', classesTaken: 3, majorClassesTaken: 1 },
        catalog,
        schedules,
        { 4: 'HIS 201', 6: 'ART 201' }
      )
      expect(schedule[6]).toBe('ART 201')
      expect(Object.values(schedule)).not.toContain('HIS 201')
      expect(Object.keys(schedule)).toHaveLength(3)
    }
  })

  /** A course made for her, no slot yet. */
  function fresh(code: string, over: Partial<CourseEntry> = {}): UnslottedCourse {
    const { slot: _slot, ...course } = classEntry({ code, ...over })
    return course
  }

  it('deals her own courses into distinct slots free in her week, the emptiest first', () => {
    const rand = lcg(11)
    for (let run = 0; run < RUNS; run++) {
      const busy = new Set(CLASS_SLOTS.filter(() => rand() < 0.4))
      const courses = [fresh('KNT 101'), fresh('NUR 101'), fresh('NUR 102'), fresh('NUR 103')]
      const slotted = slotTransferClasses(courses, busy, catalog, rand)
      const slots = slotted.map((entry) => entry.slot)
      expect(new Set(slots).size).toBe(slots.length)
      for (const slot of slots) expect(busy.has(slot)).toBe(false)
      expect(slotted).toHaveLength(Math.min(courses.length, CLASS_SLOTS.length - busy.size))
    }
    // The catalog fills slots 0 to 8, so slot 9 is the emptiest.
    expect(slotTransferClasses([fresh('KNT 101')], new Set(), catalog)[0].slot).toBe(9)
  })

  it('seats her own interest class and her new major classes, never filling a class past its size', () => {
    const rand = lcg(13)
    for (let run = 0; run < RUNS; run++) {
      const schedules = standing(rand)
      const classesTaken = 4 + Math.floor(rand() * 3)
      const majorClassesTaken = 1 + Math.floor(rand() * 3)
      const interest = fresh('KNT 101', { category: 'interest' })
      const major = [1, 2, 3].map((n) => fresh(`NUR 10${n}`, { major: 'Nursing' }))
      const { schedule, classes } = seatTransfer(
        { major: 'Nursing', classesTaken, majorClassesTaken, fresh: { interest, major } },
        catalog,
        schedules,
        { 0: 'PED 101', 6: 'ART 201' },
        rand
      )
      expect(Object.keys(schedule).length).toBeLessThanOrEqual(classesTaken)
      expect(Object.values(schedule)).toContain('KNT 101')
      // The reader's, PE and her interest class leave room for one of her major at least.
      const nursing = Object.values(schedule).filter((code) => code.startsWith('NUR'))
      expect(nursing.length).toBeGreaterThanOrEqual(1)
      expect(nursing.length).toBeLessThanOrEqual(majorClassesTaken)
      // Her own courses come back as seated, each in its own slot.
      expect(classes.map((entry) => entry.code).sort()).toEqual(
        Object.values(schedule)
          .filter((code) => !(code in catalog))
          .sort()
      )
      for (const entry of classes) expect(schedule[entry.slot]).toBe(entry.code)
      const all = { ...schedules, her: { schedule } }
      for (const entry of entries) {
        expect(studentsOf(entry, Object.keys(all), all).length).toBeLessThanOrEqual(MAX_CLASS_SIZE)
      }
    }

    // With nothing shared, PE and her interest class leave the rest of her load to her major.
    const { schedule } = seatTransfer(
      {
        major: 'Nursing',
        classesTaken: 5,
        majorClassesTaken: 3,
        fresh: {
          interest: fresh('KNT 101', { category: 'interest' }),
          major: [1, 2, 3].map((n) => fresh(`NUR 10${n}`, { major: 'Nursing' }))
        }
      },
      catalog,
      {},
      {}
    )
    const codes = Object.values(schedule)
    expect(codes.filter((code) => code.startsWith('PED'))).toHaveLength(1)
    expect(codes).toContain('KNT 101')
    expect(codes.filter((code) => code.startsWith('NUR'))).toHaveLength(3)
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
