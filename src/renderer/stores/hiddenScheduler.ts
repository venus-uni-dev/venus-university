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

/** One deal. `inputs` is keyed by charId; the order served is shuffled per pass. */
export function buildHiddenSchedules(
  inputs: Record<string, HiddenScheduleInput>
): HiddenScheduleResult {
  const charIds = Object.keys(inputs)
  const result: HiddenScheduleResult = {}
  for (const charId of charIds) result[charId] = {}

  /** Which locations are already spoken for, per slot. Shifts go in first. */
  const occupancy = new Map<number, Set<string>>()
  const occupy = (slot: number, location: string): void => {
    const held = occupancy.get(slot)
    if (held) held.add(location)
    else occupancy.set(slot, new Set([location]))
  }
  const isFree = (slot: number, location: string): boolean =>
    !occupancy.get(slot)?.has(location)

  for (const charId of charIds) {
    const job = inputs[charId].job
    const locationId = job ? jobDefOf(job.jobId)?.locationId : undefined
    if (!job || !locationId) continue
    for (const slot of job.shifts) occupy(slot, locationId)
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
   * Places one haunt on one character's week, or gives up on it. `exclusive`
   * is off for a room, which nobody else can be in anyway.
   */
  const place = (charId: string, haunt: Haunt, exclusive = true): void => {
    const busy = busySlots(charId)
    const pool = SHIFT_SLOTS.filter((slot) => {
      if (busy.has(slot)) return false
      if (!isLocationOpen(haunt.location, slot)) return false
      return !exclusive || isFree(slot, haunt.location)
    })
    if (pool.length === 0) return
    const slot = shuffle(pool)[0] as ShiftSlot
    result[charId][slot] = haunt
    if (exclusive) occupy(slot, haunt.location)
  }

  // Passes in priority order: fun, study, activity, the meal out, groceries, then nights in
  // take what is left.
  for (const charId of shuffle(charIds)) {
    for (const location of inputs[charId].fun) place(charId, { location, kind: 'fun' })
  }
  for (const charId of shuffle(charIds)) {
    const study = inputs[charId].study
    if (study) place(charId, { location: study, kind: 'study' })
  }
  for (const charId of shuffle(charIds)) {
    const activity = inputs[charId].activity
    if (activity) {
      place(charId, { location: activity.location, kind: 'activity', doing: activity.doing })
    }
  }
  for (const charId of shuffle(charIds)) {
    const meal = inputs[charId].meal
    if (meal) place(charId, { location: meal, kind: 'meal' })
  }
  for (const charId of shuffle(charIds)) {
    place(charId, { location: GROCERY_LOCATION, kind: 'grocery' })
  }
  for (const charId of shuffle(charIds)) {
    for (let i = 0; i < inputs[charId].homeSlots; i++) {
      place(charId, { location: ROOM_LOCATION, kind: 'room' }, false)
    }
  }

  return result
}
