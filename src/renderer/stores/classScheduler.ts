import { rollProfessor } from '@shared/academics'
import { CLASS_SLOTS, MAX_CLASS_SIZE } from '@shared/classes'
import { shuffle } from '@shared/shuffle'
import {
  charKeyOf,
  type CharSchedule,
  type Character,
  type ClassEntry,
  type ClassSlot,
  type PeClassEntry
} from '@shared/types'
import { LAST_NAMES } from '../prompts/characterSuggestions'
import type { DecoratedClassGenDraft } from '../prompts/classPrompt'

/**
 * Turns a validated class-generation reply into slotted classes and per-character schedules.
 * Pure and randomised — no IO, no store access.
 */

export interface ScheduleResult {
  /** Classes with at least one student, keyed by code. */
  classes: Record<string, ClassEntry>
  /** Keyed by charId. */
  perChar: Record<string, CharSchedule>
}

/**
 * The one PE class every save is guaranteed: after seating, the most-attended generated PE
 * class becomes this, for the swimsuit wardrobes. The blurb is the whole of a description;
 * the coach it inherits at the swap is spoken only where one is asked for.
 */
export const SWIM_CLASS = {
  code: 'SWIM 102',
  name: 'Fitness Swimming',
  description:
    'Stroke technique, endurance and water safety in the university pool, from freestyle fundamentals to open turns.'
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

/** Slots the decorated catalog and seats every character; pure and randomised. */
export function buildSchedules(
  draft: DecoratedClassGenDraft,
  roster: readonly Character[]
): ScheduleResult {
  // Deal every class into the slot holding the fewest so far, ties at random.
  const load = CLASS_SLOTS.map(() => 0)
  const slotted: ClassEntry[] = shuffle(draft.classes).map((draftEntry) => {
    const fewest = Math.min(...load)
    const slot = shuffle(CLASS_SLOTS.filter((s) => load[s] === fewest))[0] as ClassSlot
    load[slot]++
    // `owner` is a scheduling detail, not save state.
    const { owner: _owner, ...entry } = draftEntry
    return { ...entry, slot }
  })

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

    /** Picks from `candidates` by {@link seatRank}, at random within a tier. */
    const choose = (candidates: readonly ClassEntry[]): ClassEntry | null => {
      const open = candidates.filter(
        (entry) =>
          !usedSlots.has(entry.slot) && (enrollment.get(entry.code) ?? 0) < MAX_CLASS_SIZE
      )
      if (open.length === 0) return null

      const rankOf = (entry: ClassEntry): number => seatRank(enrollment.get(entry.code) ?? 0)
      const best = Math.min(...open.map(rankOf))
      return shuffle(open.filter((entry) => rankOf(entry) === best))[0]
    }

    // 1. Her interest class, which is hers by construction and always has room.
    const interest = owners.get(key)
    const interestEntry = interest ? byCode.get(interest) : undefined
    if (interestEntry) seat(interestEntry)

    // 2. One PE class, ahead of her own subject so a small load still reaches one.
    const pe = choose(slotted.filter((entry) => entry.category === 'pe'))
    if (pe) seat(pe)

    // 3. Her major; the first always fits inside the smallest load there is.
    const majorPool = slotted.filter(
      (entry) => entry.category === 'major' && entry.major === profile.major
    )
    for (let i = 0; i < profile.majorClassesTaken; i++) {
      const pick = choose(majorPool)
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

  swapInSwimClass(classes, perChar)

  return { classes, perChar }
}

/**
 * Replaces the most-attended PE class with {@link SWIM_CLASS} in place, ties to the first seen;
 * keeps the replaced class's code and coach when the model already used the swim code. The
 * swim blurb comes with it, over whatever the class it replaced was described as.
 */
function swapInSwimClass(
  classes: Record<string, ClassEntry>,
  perChar: Record<string, CharSchedule>
): void {
  const attendance = new Map<string, number>()
  for (const { schedule } of Object.values(perChar)) {
    for (const code of Object.values(schedule)) {
      attendance.set(code, (attendance.get(code) ?? 0) + 1)
    }
  }

  let target: PeClassEntry | null = null
  for (const entry of Object.values(classes)) {
    if (entry.category !== 'pe') continue
    if (!target || (attendance.get(entry.code) ?? 0) > (attendance.get(target.code) ?? 0)) {
      target = entry
    }
  }
  // Nothing attended to convert: the swim class is seated itself, in the
  // emptiest slot, under the next free number if its code is taken.
  if (!target) {
    if (Object.keys(classes).length === 0) return

    const load = new Map<ClassSlot, number>(CLASS_SLOTS.map((slot) => [slot, 0]))
    for (const entry of Object.values(classes)) {
      load.set(entry.slot, (load.get(entry.slot) ?? 0) + 1)
    }
    const fewest = Math.min(...load.values())
    const slot = shuffle(CLASS_SLOTS.filter((s) => load.get(s) === fewest))[0] as ClassSlot

    let free = SWIM_CLASS.code as string
    while (classes[free]) free = free.replace(/\d+$/, (n) => String(Number(n) + 1))
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
