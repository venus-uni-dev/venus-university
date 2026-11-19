import { rollProfessor } from '@shared/academics'
import { CLASS_SLOTS, freeClassCode, MAX_CLASS_SIZE, studentsOf } from '@shared/classes'
import { pick, shuffle } from '@shared/shuffle'
import {
  charKeyOf,
  type CharSchedule,
  type Character,
  type ClassEntry,
  type ClassSlot,
  type CourseEntry,
  type PeClassEntry,
  type ScheduleResult
} from '@shared/types'
import { LAST_NAMES } from '../prompts/characterSuggestions'
import type { DecoratedClassGenDraft } from '../prompts/classPrompt'

/**
 * Turns a validated class-generation reply into slotted classes and per-character schedules.
 * Pure and randomised — no IO, no store access.
 */

/**
 * The PE class a save is given for the swimsuit wardrobes: after seating, the most-attended PE
 * class the player did not write becomes this. The blurb is the whole of a description; the
 * coach it inherits at the swap is spoken only where one is asked for.
 */
export const SWIM_CLASS = {
  code: 'SWIM 102',
  name: 'Fitness Swimming',
  description:
    'A lap swimming course building freestyle stroke mechanics, aquatic endurance, and water safety skills in the university pool.'
} as const

/** The three pools a filler class may come from, in no particular order. */
type FillerCategory = 'humanities' | 'arts' | 'misc'

/** Which pool a class counts as when picking a filler, or null if it is not filler material. */
function fillerPoolOf(entry: ClassEntry): FillerCategory | null {
  if (entry.category === 'humanities' || entry.category === 'arts') return entry.category
  if (entry.category === 'misc' || entry.category === 'interest') return 'misc'
  return null
}

/**
 * Where a class already holding `count` students sits in the pick order: one is best, empty is
 * next, and anything fuller comes after it, least full first.
 */
function seatRank(count: number): number {
  return count === 1 ? -1 : count
}

/**
 * The slot of `slots` holding the fewest classes by `loadOf`, ties at random; null where `slots`
 * is empty. Every class dealt into a slot is dealt by this.
 */
export function fewestLoadedSlot(
  slots: readonly ClassSlot[],
  loadOf: (slot: ClassSlot) => number,
  rand: () => number = Math.random
): ClassSlot | null {
  if (slots.length === 0) return null
  const fewest = Math.min(...slots.map(loadOf))
  return shuffle(
    slots.filter((slot) => loadOf(slot) === fewest),
    rand
  )[0]
}

/** Slots the decorated catalog and seats every character; pure and randomised. */
export function buildSchedules(
  draft: DecoratedClassGenDraft,
  roster: readonly Character[]
): ScheduleResult {
  // Deal every class into the slot holding the fewest so far, ties at random.
  const load = CLASS_SLOTS.map(() => 0)
  const slotted: ClassEntry[] = shuffle(draft.classes).map((draftEntry) => {
    const slot = fewestLoadedSlot(CLASS_SLOTS, (s) => load[s]) as ClassSlot
    load[slot]++
    // `owner` and `written` are scheduling details, not save state.
    const { owner: _owner, written: _written, ...entry } = draftEntry
    return { ...entry, slot }
  })
  const written = new Set(
    draft.classes.filter((entry) => entry.written).map((entry) => entry.code)
  )

  const byCode = new Map(slotted.map((entry) => [entry.code, entry]))
  const enrollment = new Map<string, number>(slotted.map((entry) => [entry.code, 0]))
  const owners = new Map<string, string>()
  for (const entry of draft.classes) {
    if (entry.category === 'interest' && entry.owner) owners.set(entry.owner, entry.code)
  }

  const fillerPool = slotted.filter((entry) => fillerPoolOf(entry) !== null)

  const perChar: Record<string, CharSchedule> = {}

  for (const character of shuffle(roster)) {
    const key = charKeyOf(character.firstName, character.lastName)
    const profile = draft.characters[key]
    const schedule: Record<number, string> = {}
    const usedSlots = new Set<number>()

    /** Seats the character if her load, the class and her slot all have room. */
    const seat = (entry: ClassEntry): boolean => {
      if (Object.keys(schedule).length >= profile.classesTaken) return false
      if (usedSlots.has(entry.slot)) return false
      if ((enrollment.get(entry.code) ?? 0) >= MAX_CLASS_SIZE) return false
      schedule[entry.slot] = entry.code
      usedSlots.add(entry.slot)
      enrollment.set(entry.code, (enrollment.get(entry.code) ?? 0) + 1)
      return true
    }

    /**
     * Picks from `candidates` by {@link seatRank}, the player's own classes first within the best
     * tier, at random among those left.
     */
    const choose = (candidates: readonly ClassEntry[]): ClassEntry | null => {
      const open = candidates.filter(
        (entry) =>
          !usedSlots.has(entry.slot) && (enrollment.get(entry.code) ?? 0) < MAX_CLASS_SIZE
      )
      if (open.length === 0) return null

      const rankOf = (entry: ClassEntry): number => seatRank(enrollment.get(entry.code) ?? 0)
      const best = Math.min(...open.map(rankOf))
      const tier = open.filter((entry) => rankOf(entry) === best)
      const own = tier.filter((entry) => written.has(entry.code))
      return shuffle(own.length > 0 ? own : tier)[0]
    }

    // 1. Her interest class, which is hers by construction and always has room.
    const interest = owners.get(key)
    const interestEntry = interest ? byCode.get(interest) : undefined
    if (interestEntry) seat(interestEntry)

    // 2. One PE class, ahead of her own subject so a small load still reaches one.
    const pe = choose(slotted.filter((entry) => entry.category === 'pe'))
    if (pe) seat(pe)

    // 3. Her major; the first always fits inside the smallest load there is. Major classes of no
    //    major in particular, which a catalog dealt without regard to majors holds, come after hers.
    const majorPool = slotted.filter(
      (entry) => entry.category === 'major' && entry.major === profile.major
    )
    const openPool = slotted.filter((entry) => entry.category === 'major' && !entry.major)
    for (let i = 0; i < profile.majorClassesTaken; i++) {
      const pick = choose(majorPool) ?? choose(openPool)
      if (!pick || !seat(pick)) break
    }

    // 4. Fillers, alternating pools; a pick with nowhere to go drops the
    //    exclusion and tries once more before the schedule ends short.
    let lastPool: FillerCategory | null = null
    while (Object.keys(schedule).length < profile.classesTaken) {
      const pick =
        choose(fillerPool.filter((entry) => fillerPoolOf(entry) !== lastPool)) ??
        choose(fillerPool)
      if (!pick || !seat(pick)) break
      lastPool = fillerPoolOf(pick)
    }

    perChar[character.charId] = {
      year: profile.year,
      dorm: profile.dorm,
      major: profile.major,
      schedule
    }
  }

  // A class nobody enrolled in is invisible to the game, so it is not saved.
  const classes: Record<string, ClassEntry> = {}
  for (const entry of slotted) {
    if ((enrollment.get(entry.code) ?? 0) > 0) classes[entry.code] = entry
  }

  swapInSwimClass(classes, perChar, written)

  return { classes, perChar }
}

/** A course generated for one transfer student, its slot not dealt yet. */
export type UnslottedCourse = Omit<CourseEntry, 'slot'>

/** The courses generated for one transfer student: her interest class, and her major's. */
export interface TransferCourses {
  interest?: UnslottedCourse
  major: readonly UnslottedCourse[]
}

/**
 * Deals each course into its own slot free in her week, the slot the catalog holds fewest classes
 * in first, ties at random; a course left no free slot is dropped.
 */
export function slotTransferClasses(
  fresh: readonly UnslottedCourse[],
  busy: ReadonlySet<number>,
  catalog: Readonly<Record<string, ClassEntry>>,
  rand: () => number = Math.random
): CourseEntry[] {
  const load = new Map<ClassSlot, number>(CLASS_SLOTS.map((slot) => [slot, 0]))
  for (const entry of Object.values(catalog)) {
    load.set(entry.slot, (load.get(entry.slot) ?? 0) + 1)
  }
  const used = new Set(busy)
  const slotted: CourseEntry[] = []
  for (const entry of fresh) {
    const slot = fewestLoadedSlot(
      CLASS_SLOTS.filter((s) => !used.has(s)),
      (s) => load.get(s) ?? 0,
      rand
    )
    if (slot === null) break
    used.add(slot)
    load.set(slot, (load.get(slot) ?? 0) + 1)
    slotted.push({ ...entry, slot })
  }
  return slotted
}

/**
 * One student's timetable seated into a semester's catalog as it stands, nothing re-slotted: one of
 * the reader's classes with room first, then PE, then the courses generated for her (her interest
 * class first) slotted around both, then her major and fillers in {@link buildSchedules}' order. A
 * class is full at {@link MAX_CLASS_SIZE} of `schedules`; another major's is never hers. Her
 * courses carry codes the catalog does not hold. Answers her timetable and the generated courses
 * she was seated in, slotted.
 */
export function seatTransfer(
  profile: {
    major: string
    classesTaken: number
    majorClassesTaken: number
    fresh?: TransferCourses
  },
  classes: Record<string, ClassEntry>,
  schedules: Record<string, { schedule: Record<number, string> }>,
  playerSchedule: Record<number, string>,
  rand: () => number = Math.random
): { schedule: Record<number, string>; classes: CourseEntry[] } {
  const entries = Object.values(classes)
  const holders = Object.keys(schedules)
  const enrollment = new Map<string, number>(
    entries.map((entry) => [entry.code, studentsOf(entry, holders, schedules).length])
  )
  const schedule: Record<number, string> = {}

  const majorPool = entries.filter(
    (entry) => entry.category === 'major' && entry.major === profile.major
  )
  const openPool = entries.filter((entry) => entry.category === 'major' && !entry.major)
  const pePool = entries.filter((entry) => entry.category === 'pe')
  const fillerPool = entries.filter((entry) => fillerPoolOf(entry) !== null)

  /** Seats her if her load, the class and her slot all have room. */
  const seat = (entry: ClassEntry): boolean => {
    if (Object.keys(schedule).length >= profile.classesTaken) return false
    if (schedule[entry.slot] !== undefined) return false
    if ((enrollment.get(entry.code) ?? 0) >= MAX_CLASS_SIZE) return false
    schedule[entry.slot] = entry.code
    enrollment.set(entry.code, (enrollment.get(entry.code) ?? 0) + 1)
    return true
  }

  /** Whether her week and the class both have room for it. */
  const isOpen = (entry: ClassEntry): boolean =>
    schedule[entry.slot] === undefined && (enrollment.get(entry.code) ?? 0) < MAX_CLASS_SIZE

  /** Picks from `candidates` by {@link seatRank}, at random among the best tier. */
  const choose = (candidates: readonly ClassEntry[]): ClassEntry | null => {
    const open = candidates.filter(isOpen)
    if (open.length === 0) return null
    const rankOf = (entry: ClassEntry): number => seatRank(enrollment.get(entry.code) ?? 0)
    const best = Math.min(...open.map(rankOf))
    return pick(
      open.filter((entry) => rankOf(entry) === best),
      rand
    )
  }

  // 1. One of the reader's classes she may take, counted toward its own kind; a major class of no
  //    major is hers only while none of her own major has room.
  const readers = new Set(Object.values(playerSchedule))
  const majorShare = majorPool.some(isOpen) ? majorPool : openPool
  const shared = choose(
    [...pePool, ...majorShare, ...fillerPool].filter((entry) => readers.has(entry.code))
  )
  if (shared) seat(shared)
  const sharedMajor = shared !== null && shared.category === 'major'
  const majorLoad =
    Math.min(profile.majorClassesTaken, profile.classesTaken) - (sharedMajor ? 1 : 0)

  // 2. One PE class, unless the reader's was one.
  if (shared?.category !== 'pe') {
    const pe = choose(pePool)
    if (pe) seat(pe)
  }

  // 3. Her own courses, as many as her load and her major share leave room for, each in a slot of
  //    its own free in her week; a course nobody else takes always has a seat.
  const room = profile.classesTaken - Object.keys(schedule).length
  const interest = profile.fresh?.interest && room > 0 ? [profile.fresh.interest] : []
  const ownMajor = (profile.fresh?.major ?? []).slice(
    0,
    Math.max(0, Math.min(majorLoad, room - interest.length))
  )
  const own = slotTransferClasses(
    [...interest, ...ownMajor],
    new Set(Object.keys(schedule).map(Number)),
    classes,
    rand
  ).filter((entry) => {
    enrollment.set(entry.code, 0)
    return seat(entry)
  })
  const ownMajorSeated = own.filter((entry) => entry.category === 'major').length

  // 4. Her major, then major classes of no major in particular.
  for (let i = 0; i < majorLoad - ownMajorSeated; i++) {
    const next = choose(majorPool) ?? choose(openPool)
    if (!next || !seat(next)) break
  }

  // 5. Fillers, alternating pools; a pick with nowhere to go drops the exclusion and tries once
  //    more before the timetable ends short.
  let lastPool: FillerCategory | null = shared ? fillerPoolOf(shared) : null
  while (Object.keys(schedule).length < profile.classesTaken) {
    const next =
      choose(fillerPool.filter((entry) => fillerPoolOf(entry) !== lastPool)) ?? choose(fillerPool)
    if (!next || !seat(next)) break
    lastPool = fillerPoolOf(next)
  }

  return { schedule, classes: own }
}

/**
 * Replaces the most-attended PE class the player did not write with {@link SWIM_CLASS} in place,
 * ties to the first seen, keeping the replaced class's code and coach when the swim code is taken;
 * the swim blurb comes with it. Where every PE class attended is the player's, none is replaced.
 */
function swapInSwimClass(
  classes: Record<string, ClassEntry>,
  perChar: Record<string, CharSchedule>,
  written: ReadonlySet<string>
): void {
  const attendance = new Map<string, number>()
  for (const { schedule } of Object.values(perChar)) {
    for (const code of Object.values(schedule)) {
      attendance.set(code, (attendance.get(code) ?? 0) + 1)
    }
  }

  let target: PeClassEntry | null = null
  let peAttended = false
  for (const entry of Object.values(classes)) {
    if (entry.category !== 'pe') continue
    peAttended = true
    if (written.has(entry.code)) continue
    if (!target || (attendance.get(entry.code) ?? 0) > (attendance.get(target.code) ?? 0)) {
      target = entry
    }
  }
  if (!target && peAttended) return
  // No PE attended to convert: the swim class is seated itself, in the
  // emptiest slot, under the next free number if its code is taken.
  if (!target) {
    if (Object.keys(classes).length === 0) return

    const load = new Map<ClassSlot, number>(CLASS_SLOTS.map((slot) => [slot, 0]))
    for (const entry of Object.values(classes)) {
      load.set(entry.slot, (load.get(entry.slot) ?? 0) + 1)
    }
    const slot = fewestLoadedSlot(CLASS_SLOTS, (s) => load.get(s) ?? 0) as ClassSlot

    const free = freeClassCode(SWIM_CLASS.code, (c) => c in classes)
    // Nobody to inherit a coach from, so this is the one path that rolls its own.
    const instructor = rollProfessor(LAST_NAMES)
    classes[free] = {
      ...SWIM_CLASS,
      code: free,
      category: 'pe',
      slot,
      instructor
    }
    return
  }

  const code = classes[SWIM_CLASS.code] ? target.code : SWIM_CLASS.code
  delete classes[target.code]
  classes[code] = { ...target, ...SWIM_CLASS, code }

  for (const { schedule } of Object.values(perChar)) {
    for (const [slot, entryCode] of Object.entries(schedule)) {
      if (entryCode === target.code) schedule[Number(slot)] = code
    }
  }
}
