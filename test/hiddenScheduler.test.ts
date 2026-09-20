import { describe, expect, it } from 'vitest'
import { classSlotForShift, jobDefOf } from '@shared/jobs'
import { GROCERY_LOCATION, locationDefOf, ROOM_LOCATION } from '@shared/locations'
import type { CharJob, Haunt, ShiftSlot } from '@shared/types'
import {
  buildHiddenSchedules,
  type HiddenScheduleInput
} from '../src/renderer/stores/hiddenScheduler'

/**
 * The haunt deal runs once per playthrough and is frozen into the save, so
 * these are invariant checks over many random runs. Two girls dealt one place at
 * one hour cannot be repaired later and nothing in play would throw over it.
 */

const RUNS = 60

/** Six characters, no classes and no jobs unless a case adds them. */
function inputs(over: Record<string, Partial<HiddenScheduleInput>> = {}): Record<string, HiddenScheduleInput> {
  const base: Record<string, HiddenScheduleInput> = {}
  for (let i = 0; i < 6; i++) {
    base[`c${i}`] = {
      homeSlots: 2,
      study: 'kendall_library',
      fun: ['btb_arcade', 'cutetea'],
      activity: { location: 'palaestra_stadium', doing: 'swimming laps at the Palaestra' },
      meal: 'bobbys_diner',
      schedule: {},
      ...over[`c${i}`]
    }
  }
  for (const [charId, patch] of Object.entries(over)) {
    if (!base[charId]) {
      base[charId] = {
        homeSlots: 1,
        study: null,
        fun: [],
        activity: null,
        meal: null,
        schedule: {},
        ...patch
      }
    }
  }
  return base
}

/** Every (slot, location) pair a result holds, rooms excluded. */
function placements(
  result: Record<string, Record<number, Haunt>>
): Array<{ charId: string; slot: number; location: string }> {
  return Object.entries(result).flatMap(([charId, week]) =>
    Object.entries(week).map(([slot, haunt]) => ({
      charId,
      slot: Number(slot),
      location: haunt.location
    }))
  )
}

describe('buildHiddenSchedules', () => {
  it('never puts two characters in one place at one hour', () => {
    for (let run = 0; run < RUNS; run++) {
      const result = buildHiddenSchedules(inputs())
      const seen = new Set<string>()
      for (const { slot, location } of placements(result)) {
        if (location === ROOM_LOCATION) continue
        const key = `${slot}:${location}`
        expect(seen.has(key), key).toBe(false)
        seen.add(key)
      }
    }
  })

  it('never books a character over her own class', () => {
    for (let run = 0; run < RUNS; run++) {
      // Every weekday slot but Monday Day is a class for c0.
      const schedule: Record<number, string> = {}
      for (const slot of [1, 2, 3, 4, 5, 6, 7, 8, 9]) schedule[slot] = 'BIO 210'
      const result = buildHiddenSchedules(inputs({ c0: { schedule } }))
      for (const slot of Object.keys(result.c0).map(Number)) {
        const classSlot = classSlotForShift(slot as ShiftSlot)
        expect(classSlot === null || !schedule[classSlot], `slot ${slot}`).toBe(true)
      }
    }
  })

  it('never books a character over her own shift, or over somebody working there', () => {
    for (let run = 0; run < RUNS; run++) {
      // c0 works the library every weekday night; nobody else may study there
      // in those slots, and c0 herself is busy in them.
      const job: CharJob = { jobId: 'kendall_library', shifts: [1, 3, 5, 7, 9] }
      const result = buildHiddenSchedules(inputs({ c0: { job } }))

      for (const slot of job.shifts) expect(result.c0[slot]).toBeUndefined()

      const workplace = jobDefOf(job.jobId)!.locationId
      for (const { slot, location } of placements(result)) {
        if (location !== workplace) continue
        expect(job.shifts.includes(slot as ShiftSlot), `${location} at ${slot}`).toBe(false)
      }
    }
  })

  it('keeps a haunt inside the hours its place keeps', () => {
    for (let run = 0; run < RUNS; run++) {
      const result = buildHiddenSchedules(
        inputs({ c0: { fun: ['stalestein_bar', 'apogee_club', 'lumiere_fusion'] } })
      )
      for (const { slot, location } of placements(result)) {
        const hours = locationDefOf(location)?.hours
        if (!hours) continue
        expect(hours.includes(slot as ShiftSlot), `${location} at ${slot}`).toBe(true)
      }
    }
  })

  it('places every haunt she asked for while the week has room', () => {
    const result = buildHiddenSchedules({
      alone: {
        homeSlots: 3,
        study: 'kendall_library',
        fun: ['btb_arcade', 'cutetea'],
        activity: { location: 'palaestra_stadium', doing: 'swimming laps at the Palaestra' },
        meal: 'bobbys_diner',
        schedule: {}
      }
    })
    const week = Object.values(result.alone)
    const places = week.map((haunt) => haunt.location)
    expect(places).toContain('kendall_library')
    expect(places).toContain('btb_arcade')
    expect(places).toContain('cutetea')
    expect(places).toContain('palaestra_stadium')
    expect(places).toContain('bobbys_diner')
    expect(places).toContain(GROCERY_LOCATION)
    expect(places.filter((location) => location === ROOM_LOCATION)).toHaveLength(3)
    // Nine placements in nine distinct slots: a record cannot hold two values
    // for one key, so this length is the only thing that catches a later pass
    // dealing over an earlier one's slot.
    expect(week).toHaveLength(9)

    const activity = week.find((haunt) => haunt.location === 'palaestra_stadium')
    expect(activity?.kind).toBe('activity')
    expect(activity?.doing).toBe('swimming laps at the Palaestra')
  })

  // The only case where a pass's pool runs dry: without the empty-pool guard the
  // frozen week is written under an `undefined` key, which no reader ever finds.
  it('yields a short week rather than failing when there is nowhere left', () => {
    // Every slot is a class or a shift: nothing can be placed at all, and that
    // is a believable student rather than an error.
    const schedule: Record<number, string> = {}
    for (const slot of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]) schedule[slot] = 'BIO 210'
    const job: CharJob = { jobId: 'fast_eats', shifts: [10, 11, 12, 13] }
    const result = buildHiddenSchedules({
      busy: {
        homeSlots: 3,
        study: 'kendall_library',
        fun: ['btb_arcade'],
        activity: null,
        meal: null,
        schedule,
        job
      }
    })
    expect(result.busy).toEqual({})
  })

  it('lets everybody be home at once, because nobody is found in her own room', () => {
    const result = buildHiddenSchedules(
      inputs(
        Object.fromEntries(
          Array.from({ length: 6 }, (_, i) => [
            `c${i}`,
            { homeSlots: 3, study: null, fun: [], activity: null, meal: null }
          ])
        )
      )
    )
    for (let i = 0; i < 6; i++) {
      const rooms = Object.values(result[`c${i}`]).filter(
        (haunt) => haunt.location === ROOM_LOCATION
      )
      expect(rooms).toHaveLength(3)
    }
  })
})
