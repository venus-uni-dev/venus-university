import { classSlotForShift, jobDefOf, SHIFT_SLOTS } from '@shared/jobs'
import { GROCERY_LOCATION, isLocationOpen, ROOM_LOCATION } from '@shared/locations'
import { shuffle } from '@shared/shuffle'
import type { CharJob, Haunt, ShiftSlot } from '@shared/types'
import type { HiddenScheduleAssignment } from '@shared/types'

/** Deals every character's standing haunts into the week. */

/** What one character brings into the deal. */
export interface HiddenScheduleInput extends HiddenScheduleAssignment {
  /** Her class timetable, keyed by `ClassSlot` — the first ten shift slots. */
  schedule: Record<number, string>
  /** Her job, if she holds one; its shifts are hers and its place is taken. */
  job?: CharJob
}

/** Keyed by charId, each a sparse `ShiftSlot` → the haunt she keeps in it. */
export type HiddenScheduleResult = Record<string, Record<number, Haunt>>

/**
 * The most haunts one place holds in one slot. A second girl is dealt in beside the first only
 * when every slot she has free for it is already held, so the pair and a friend one of them
 * pulls along still fit the stage.
 */
export const MAX_HAUNTS_PER_PLACE = 2

/**
 * The menus a week was dealt from, read back off the week: what a returning girl's routine is
 * dealt from again around her new timetable. Groceries are dealt to everybody and are not a menu.
 */
export function hauntAssignmentOf(week: Readonly<Record<number, Haunt>>): HiddenScheduleAssignment {
  const haunts = Object.keys(week)
    .map(Number)
    .sort((a, b) => a - b)
    .map((slot) => week[slot])
  const activity = haunts.find((haunt) => haunt.kind === 'activity')
  return {
    homeSlots: haunts.filter((haunt) => haunt.kind === 'room').length,
    study: haunts.find((haunt) => haunt.kind === 'study')?.location ?? null,
    fun: haunts.filter((haunt) => haunt.kind === 'fun').map((haunt) => haunt.location),
    activity: activity ? { location: activity.location, doing: activity.doing ?? '' } : null,
    meal: haunts.find((haunt) => haunt.kind === 'meal')?.location ?? null
  }
}

/** The weeks and jobs already standing that a deal is made around, taking their places first. */
export interface HiddenScheduleAround {
  weeks: readonly Readonly<Record<number, Haunt>>[]
  jobs: readonly CharJob[]
}

/**
 * One deal. `inputs` is keyed by charId; the order served is shuffled per pass. `around` holds
 * the places a standing week or shift already fills.
 */
export function buildHiddenSchedules(
  inputs: Record<string, HiddenScheduleInput>,
  around?: HiddenScheduleAround,
  rand: () => number = Math.random
): HiddenScheduleResult {
  const charIds = Object.keys(inputs)
  const result: HiddenScheduleResult = {}
  for (const charId of charIds) result[charId] = {}

  /** How many haunts each location already holds, per slot. Shifts go in first. */
  const occupancy = new Map<number, Map<string, number>>()
  const occupy = (slot: number, location: string, count = 1): void => {
    const held = occupancy.get(slot) ?? new Map<string, number>()
    held.set(location, (held.get(location) ?? 0) + count)
    occupancy.set(slot, held)
  }
  const heldAt = (slot: number, location: string): number =>
    occupancy.get(slot)?.get(location) ?? 0

  // A shift fills its place outright: nobody keeps a haunt beside somebody working there.
  const jobs = [
    ...(around?.jobs ?? []),
    ...charIds.flatMap((charId) => inputs[charId].job ?? [])
  ]
  for (const job of jobs) {
    const locationId = jobDefOf(job.jobId)?.locationId
    if (!locationId) continue
    for (const slot of job.shifts) occupy(slot, locationId, MAX_HAUNTS_PER_PLACE)
  }
  // A standing haunt holds its place as one dealt here would; a room is nobody else's anyway.
  for (const week of around?.weeks ?? []) {
    for (const [slot, haunt] of Object.entries(week)) {
      if (haunt.kind !== 'room') occupy(Number(slot), haunt.location)
    }
  }

  /** Slots this character already owes to a class, a shift or an earlier pass. */
  const busySlots = (charId: string): Set<number> => {
    const input = inputs[charId]
    const busy = new Set<number>(Object.keys(result[charId]).map(Number))
    for (const slot of input.job?.shifts ?? []) busy.add(slot)
    for (const slot of SHIFT_SLOTS) {
      const classSlot = classSlotForShift(slot)
      if (classSlot !== null && input.schedule[classSlot]) busy.add(slot)
    }
    return busy
  }

  /**
   * Of `slots`, those where the fewest haunts already hold `location` — the empty ones while
   * any is left — or none once every one is full.
   */
  const leastHeld = (slots: readonly ShiftSlot[], location: string): ShiftSlot[] => {
    const fewest = Math.min(...slots.map((slot) => heldAt(slot, location)))
    if (fewest >= MAX_HAUNTS_PER_PLACE) return []
    return slots.filter((slot) => heldAt(slot, location) === fewest)
  }

  /**
   * Places one haunt on one character's week, or gives up on it. `exclusive`
   * is off for a room, which nobody else can be in anyway.
   */
  const place = (charId: string, haunt: Haunt, exclusive = true): void => {
    const busy = busySlots(charId)
    const open = SHIFT_SLOTS.filter(
      (slot) => !busy.has(slot) && isLocationOpen(haunt.location, slot)
    )
    const pool = exclusive ? leastHeld(open, haunt.location) : open
    if (pool.length === 0) return
    const slot = shuffle(pool, rand)[0] as ShiftSlot
    result[charId][slot] = haunt
    if (exclusive) occupy(slot, haunt.location)
  }

  // Passes in priority order: fun, study, activity, the meal out, groceries, then nights in
  // take what is left.
  for (const charId of shuffle(charIds, rand)) {
    for (const location of inputs[charId].fun) place(charId, { location, kind: 'fun' })
  }
  for (const charId of shuffle(charIds, rand)) {
    const study = inputs[charId].study
    if (study) place(charId, { location: study, kind: 'study' })
  }
  for (const charId of shuffle(charIds, rand)) {
    const activity = inputs[charId].activity
    if (activity) {
      place(charId, { location: activity.location, kind: 'activity', doing: activity.doing })
    }
  }
  for (const charId of shuffle(charIds, rand)) {
    const meal = inputs[charId].meal
    if (meal) place(charId, { location: meal, kind: 'meal' })
  }
  for (const charId of shuffle(charIds, rand)) {
    place(charId, { location: GROCERY_LOCATION, kind: 'grocery' })
  }
  for (const charId of shuffle(charIds, rand)) {
    for (let i = 0; i < inputs[charId].homeSlots; i++) {
      place(charId, { location: ROOM_LOCATION, kind: 'room' }, false)
    }
  }

  return result
}
