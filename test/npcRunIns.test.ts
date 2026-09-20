import { describe, expect, it } from 'vitest'
import { dormSpotsOf } from '@shared/dorms'
import { ROOM_LOCATION } from '@shared/locations'
import type { NpcEncounterGroup } from '@shared/npcRelationships'
import { MAX_GROUP } from '../src/renderer/stores/npcOverlay'
import {
  rollDormRunIns,
  rollLooseRunIns,
  type RunInCharInput
} from '../src/renderer/stores/npcRunIns'

/**
 * The two run-in rolls the settle folds in on top of the overlay. What they return is
 * written into a save as encounters between pairs, so these are invariant checks over many
 * random runs, with the two extremes pinned by an injected `rand`.
 */

const RUNS = 60
const SPOTS = ['agora', 'kendall_library'] as const

function input(over: Partial<RunInCharInput> = {}): RunInCharInput {
  return {
    busy: false,
    location: null,
    haunt: null,
    building: null,
    spokenFor: false,
    ...over
  }
}

/** Everybody the roll put in a group, flattened. */
function placed(groups: readonly NpcEncounterGroup[]): string[] {
  return groups.flatMap((group) => [...group.members])
}

describe('rollDormRunIns', () => {
  it('never puts out anybody who is busy, spoken for, or not in her room', () => {
    const chars: Record<string, RunInCharInput> = {
      busy: input({ busy: true, location: ROOM_LOCATION, building: 'lowrise' }),
      spoken: input({ spokenFor: true, location: ROOM_LOCATION, building: 'lowrise' }),
      away: input({ location: 'agora', building: 'lowrise' }),
      homeless: input({ location: ROOM_LOCATION }),
      a: input({ location: ROOM_LOCATION, building: 'lowrise' }),
      b: input({ location: ROOM_LOCATION, building: 'lowrise' }),
      c: input({ location: ROOM_LOCATION, building: 'lowrise' })
    }
    for (let run = 0; run < RUNS; run++) {
      const members = placed(rollDormRunIns(chars))
      expect(members).not.toContain('busy')
      expect(members).not.toContain('spoken')
      expect(members).not.toContain('away')
      expect(members).not.toContain('homeless')
    }
  })

  it('holds every group between a pair and the on-screen cap', () => {
    const chars: Record<string, RunInCharInput> = {}
    for (let i = 0; i < 8; i++) {
      chars[`r${i}`] = input({ location: ROOM_LOCATION, building: 'lowrise' })
    }
    for (let run = 0; run < RUNS; run++) {
      for (const group of rollDormRunIns(chars)) {
        expect(group.members.length).toBeGreaterThanOrEqual(2)
        expect(group.members.length).toBeLessThanOrEqual(MAX_GROUP)
      }
    }
  })

  it('keeps the two buildings apart and names a room inside the right one', () => {
    const chars: Record<string, RunInCharInput> = {
      e1: input({ location: ROOM_LOCATION, building: 'elysium' }),
      e2: input({ location: ROOM_LOCATION, building: 'elysium' }),
      l1: input({ location: ROOM_LOCATION, building: 'lowrise' }),
      l2: input({ location: ROOM_LOCATION, building: 'lowrise' })
    }
    /** The rooms the building `charId` lives in has, as ids. */
    const spotsFor = (charId: string): string[] => {
      const building = chars[charId].building
      return building === null ? [] : dormSpotsOf(building).map((spot) => spot.id)
    }
    for (let run = 0; run < RUNS; run++) {
      for (const group of rollDormRunIns(chars)) {
        const building = chars[group.members[0]].building
        for (const member of group.members) expect(chars[member].building).toBe(building)
        expect(spotsFor(group.members[0])).toContain(group.ref)
      }
    }
  })

  it('never puts the same resident in two groups', () => {
    const chars: Record<string, RunInCharInput> = {}
    for (let i = 0; i < 6; i++) {
      chars[`r${i}`] = input({ location: ROOM_LOCATION, building: 'lowrise' })
    }
    for (let run = 0; run < RUNS; run++) {
      const members = placed(rollDormRunIns(chars))
      expect(new Set(members).size).toBe(members.length)
    }
  })

  it('leaves the one resident who came out alone out of it', () => {
    const chars: Record<string, RunInCharInput> = {
      alone: input({ location: ROOM_LOCATION, building: 'elysium' }),
      busy: input({ busy: true, location: ROOM_LOCATION, building: 'elysium' })
    }
    expect(rollDormRunIns(chars, () => 0)).toEqual([])
  })

  it('keeps everybody in her own room on a failing roll', () => {
    const chars: Record<string, RunInCharInput> = {
      a: input({ location: ROOM_LOCATION, building: 'lowrise' }),
      b: input({ location: ROOM_LOCATION, building: 'lowrise' }),
      c: input({ location: ROOM_LOCATION, building: 'elysium' }),
      d: input({ location: ROOM_LOCATION, building: 'elysium' })
    }
    expect(rollDormRunIns(chars, () => 0.999999)).toEqual([])
  })
})

describe('rollLooseRunIns', () => {
  const out = (over: Partial<RunInCharInput> = {}): RunInCharInput =>
    input({ location: 'agora', ...over })

  it('bumps people into each other two at a time, and never twice', () => {
    const chars: Record<string, RunInCharInput> = {
      a: out(),
      b: out(),
      c: out(),
      d: out(),
      e: out()
    }
    for (let run = 0; run < RUNS; run++) {
      const groups = rollLooseRunIns(chars, SPOTS)
      for (const group of groups) {
        expect(group.kind).toBe('hangout')
        expect(group.members.length).toBe(2)
      }
      const members = placed(groups)
      expect(new Set(members).size).toBe(members.length)
    }
  })

  it('never draws anybody who is at home, busy or spoken for', () => {
    const chars: Record<string, RunInCharInput> = {
      inside: out({ location: ROOM_LOCATION }),
      busy: out({ busy: true }),
      spoken: out({ spokenFor: true }),
      a: out(),
      b: out()
    }
    for (let run = 0; run < RUNS; run++) {
      const members = placed(rollLooseRunIns(chars, SPOTS))
      expect(members).not.toContain('inside')
      expect(members).not.toContain('busy')
      expect(members).not.toContain('spoken')
    }
  })

  it("sets the run-in at one of the pair's own haunts when either of them keeps one", () => {
    const chars: Record<string, RunInCharInput> = {
      a: out({ location: 'btb_arcade', haunt: 'btb_arcade' }),
      b: out({ location: 'cutetea', haunt: 'cutetea' })
    }
    for (let run = 0; run < RUNS; run++) {
      for (const group of rollLooseRunIns(chars, SPOTS)) {
        expect(['btb_arcade', 'cutetea']).toContain(group.ref)
      }
    }
  })

  it('falls back to an open spot when neither of them keeps a haunt', () => {
    const chars: Record<string, RunInCharInput> = { a: out(), b: out() }
    for (let run = 0; run < RUNS; run++) {
      for (const group of rollLooseRunIns(chars, SPOTS)) {
        expect(SPOTS).toContain(group.ref)
      }
    }
  })

  it('drops the pair rather than writing an encounter with nowhere to be', () => {
    const chars: Record<string, RunInCharInput> = { a: out(), b: out() }
    for (let run = 0; run < RUNS; run++) {
      expect(rollLooseRunIns(chars, [])).toEqual([])
    }
  })
})
