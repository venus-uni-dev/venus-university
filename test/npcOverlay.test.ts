import { describe, expect, it } from 'vitest'
import { ROOM_LOCATION } from '@shared/locations'
import type { NpcSlotOverlay } from '@shared/npcRelationships'
import { rollNpcOverlay, type OverlayCharInput } from '../src/renderer/stores/npcOverlay'

/**
 * The per-slot hangout deal. Its output is written into a save and read by the casting draw,
 * the classifier and the phone for the whole slot — checked as invariants over many random
 * runs, with the extremes pinned by an injected `rand`.
 */

const RUNS = 60
const SPOTS = ['beach', 'museum', 'mall', 'cinema'] as const

function input(over: Partial<OverlayCharInput> = {}): OverlayCharInput {
  return {
    haunt: null,
    busy: false,
    moodHomebound: false,
    wentOutRecently: false,
    friends: [],
    ...over
  }
}

/** Everyone the overlay put somewhere, flattened. */
function placed(overlay: NpcSlotOverlay): string[] {
  return overlay.groups.flatMap((group) => group.members)
}

/** The group holding `charId`, or undefined. */
function groupOf(overlay: NpcSlotOverlay, charId: string) {
  return overlay.groups.find((group) => group.members.includes(charId))
}

describe('rollNpcOverlay', () => {
  it('stamps the slot it was rolled for', () => {
    const overlay = rollNpcOverlay(12, 1, null, { a: input() }, SPOTS)
    expect(overlay.date).toBe(12)
    expect(overlay.time).toBe(1)
  })

  it('never places anybody who is in class, on shift, or staying in', () => {
    const chars: Record<string, OverlayCharInput> = {
      busy: input({ busy: true, haunt: 'arcade', friends: ['host', 'loose'] }),
      homebound: input({ moodHomebound: true, haunt: 'arcade', friends: ['host', 'loose'] }),
      host: input({ haunt: 'arcade', friends: ['busy', 'homebound', 'loose'] }),
      loose: input({ friends: ['busy', 'homebound', 'host'] })
    }
    for (let run = 0; run < RUNS; run++) {
      const members = placed(rollNpcOverlay(0, 0, 'weekend', chars, SPOTS))
      expect(members).not.toContain('busy')
      expect(members).not.toContain('homebound')
    }
  })

  it("pulls at most two friends, and pulls them to the host's own place", () => {
    const chars: Record<string, OverlayCharInput> = {
      host: input({ haunt: 'arcade', friends: ['f1', 'f2', 'f3', 'f4'] }),
      f1: input({ friends: ['host'] }),
      f2: input({ friends: ['host'] }),
      f3: input({ friends: ['host'] }),
      f4: input({ friends: ['host'] })
    }
    for (let run = 0; run < RUNS; run++) {
      const overlay = rollNpcOverlay(0, 0, null, chars, SPOTS)
      const group = groupOf(overlay, 'host')
      if (!group) continue
      expect(group.location).toBe('arcade')
      expect(group.host).toBe('host')
      expect(group.members.length).toBeLessThanOrEqual(3)
    }
  })

  it('pulls friends into a room, because a night in with somebody is a hangout', () => {
    const chars: Record<string, OverlayCharInput> = {
      host: input({ haunt: ROOM_LOCATION, friends: ['friend'] }),
      friend: input({ friends: ['host'] })
    }
    // rand() === 0 passes the 50% pull.
    const overlay = rollNpcOverlay(0, 0, null, chars, SPOTS, () => 0)
    expect(groupOf(overlay, 'friend')?.location).toBe(ROOM_LOCATION)
  })

  it('never pulls somebody who is not a friend', () => {
    const chars: Record<string, OverlayCharInput> = {
      host: input({ haunt: 'arcade', friends: [] }),
      stranger: input({ friends: [] })
    }
    // Weekday, so a pull is the only thing that could place her at all.
    for (let run = 0; run < RUNS; run++) {
      expect(groupOf(rollNpcOverlay(0, 0, null, chars, SPOTS), 'stranger')).toBeUndefined()
    }
  })

  it('never lets a group grow past three', () => {
    const chars: Record<string, OverlayCharInput> = {}
    const everyone = ['a', 'b', 'c', 'd', 'e', 'f']
    for (const charId of everyone) {
      chars[charId] = input({
        haunt: charId === 'a' ? 'arcade' : null,
        friends: everyone.filter((other) => other !== charId)
      })
    }
    for (let run = 0; run < RUNS; run++) {
      for (const group of rollNpcOverlay(0, 0, 'weekend', chars, SPOTS).groups) {
        expect(group.members.length).toBeLessThanOrEqual(3)
      }
    }
  })

  it('places nobody in two groups at once', () => {
    const chars: Record<string, OverlayCharInput> = {}
    const everyone = ['a', 'b', 'c', 'd', 'e']
    for (const charId of everyone) {
      chars[charId] = input({ friends: everyone.filter((other) => other !== charId) })
    }
    for (let run = 0; run < RUNS; run++) {
      const members = placed(rollNpcOverlay(0, 0, 'weekend', chars, SPOTS))
      expect(new Set(members).size).toBe(members.length)
    }
  })

  it('sends nobody out on a weekday, whatever the rolls', () => {
    const chars: Record<string, OverlayCharInput> = {
      a: input({ friends: ['b'] }),
      b: input({ friends: ['a'] })
    }
    for (let run = 0; run < RUNS; run++) {
      const overlay = rollNpcOverlay(0, 0, null, chars, SPOTS)
      expect(overlay.groups).toEqual([])
      expect(overlay.wentOut).toEqual([])
    }
  })

  it('sends the same weekday out once spring break opens the window', () => {
    const chars: Record<string, OverlayCharInput> = {
      a: input({ friends: ['b'] }),
      b: input({ friends: ['a'] })
    }
    const overlay = rollNpcOverlay(49, 0, 'break', chars, SPOTS)
    expect(placed(overlay).sort()).toEqual(['a', 'b'])
    expect(overlay.wentOut.sort()).toEqual(['a', 'b'])
  })

  it('takes friends out on a weekend with no roll at all', () => {
    const chars: Record<string, OverlayCharInput> = {
      a: input({ friends: ['b'] }),
      b: input({ friends: ['a'] })
    }
    // Even at the roll value that fails everything else, the meetup still fires.
    const overlay = rollNpcOverlay(0, 0, 'weekend', chars, SPOTS, () => 0.999999)
    const group = groupOf(overlay, 'a')
    expect(group?.members.sort()).toEqual(['a', 'b'])
    expect(SPOTS).toContain(group?.location)
    expect(overlay.wentOut.sort()).toEqual(['a', 'b'])
  })

  it('gives each group its own spot', () => {
    const chars: Record<string, OverlayCharInput> = {
      a: input({ friends: ['b'] }),
      b: input({ friends: ['a'] }),
      c: input({ friends: ['d'] }),
      d: input({ friends: ['c'] })
    }
    for (let run = 0; run < RUNS; run++) {
      const overlay = rollNpcOverlay(0, 0, 'weekend', chars, SPOTS)
      const spots = overlay.groups.map((group) => group.location)
      expect(new Set(spots).size).toBe(spots.length)
    }
  })

  it('sends a girl with nobody free out on her own at the weekend', () => {
    const overlay = rollNpcOverlay(0, 0, 'weekend', { alone: input() }, SPOTS, () => 0.999999)
    expect(overlay.groups).toHaveLength(1)
    expect(overlay.groups[0].members).toEqual(['alone'])
    expect(overlay.wentOut).toEqual(['alone'])
  })

  it('leaves her in rather than throwing when every spot is taken', () => {
    const chars: Record<string, OverlayCharInput> = { a: input(), b: input() }
    const overlay = rollNpcOverlay(0, 0, 'weekend', chars, ['beach'], () => 0.999999)
    expect(overlay.groups).toHaveLength(1)
    expect(placed(overlay)).toHaveLength(1)
  })

  it('keeps somebody who already went out this weekend at home for the rest of it', () => {
    const chars: Record<string, OverlayCharInput> = {
      tired: input({ wentOutRecently: true, friends: ['fresh'] }),
      fresh: input({ friends: ['tired'] })
    }
    for (let run = 0; run < RUNS; run++) {
      expect(placed(rollNpcOverlay(0, 0, 'weekend', chars, SPOTS))).not.toContain('tired')
    }
  })

  it('still lets a tired girl be pulled along, which costs her nothing', () => {
    const chars: Record<string, OverlayCharInput> = {
      host: input({ haunt: 'arcade', friends: ['tired'] }),
      tired: input({ wentOutRecently: true, friends: ['host'] })
    }
    const overlay = rollNpcOverlay(0, 0, 'weekend', chars, SPOTS, () => 0)
    expect(groupOf(overlay, 'tired')?.location).toBe('arcade')
    expect(overlay.wentOut).not.toContain('tired')
  })

  it('leaves a host with a closed haunt alone rather than inventing one', () => {
    // A campus place on a day an occasion shut it reads as no haunt at all, so
    // she has nowhere to pull anybody to.
    const chars: Record<string, OverlayCharInput> = {
      host: input({ haunt: null, friends: ['friend'] }),
      friend: input({ friends: ['host'] })
    }
    const overlay = rollNpcOverlay(0, 0, null, chars, SPOTS, () => 0)
    expect(overlay.groups).toEqual([])
  })
})
