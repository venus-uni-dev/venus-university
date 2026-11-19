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

  it('never fills a place past three, counting the girls who keep a haunt there', () => {
    const chars: Record<string, OverlayCharInput> = {
      a: input({ haunt: 'arcade', friends: ['f1', 'f2', 'f3', 'f4'] }),
      b: input({ haunt: 'arcade', friends: ['f1', 'f2', 'f3', 'f4'] }),
      f1: input({ friends: ['a', 'b'] }),
      f2: input({ friends: ['a', 'b'] }),
      f3: input({ friends: ['a', 'b'] }),
      f4: input({ friends: ['a', 'b'] })
    }
    // rand() === 0 passes every pull, so each host pulls all the room she is given.
    for (const rand of [() => 0, Math.random]) {
      for (let run = 0; run < RUNS; run++) {
        const overlay = rollNpcOverlay(0, 0, 'weekend', chars, [...SPOTS, 'arcade'], rand)
        const atArcade = new Set(['a', 'b'])
        for (const group of overlay.groups) {
          if (group.location === 'arcade') for (const member of group.members) atArcade.add(member)
        }
        expect(atArcade.size).toBeLessThanOrEqual(3)
      }
    }
  })

  it('never sends an outing to a place somebody keeps a haunt at', () => {
    const chars: Record<string, OverlayCharInput> = {
      stays: input({ haunt: 'beach' }),
      a: input({ friends: ['b'] }),
      b: input({ friends: ['a'] }),
      c: input()
    }
    for (let run = 0; run < RUNS; run++) {
      for (const group of rollNpcOverlay(0, 0, 'weekend', chars, SPOTS).groups) {
        expect(group.location).not.toBe('beach')
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

  it('brings a couple together only where one of them already is, never past three', () => {
    const chars: Record<string, OverlayCharInput> = {
      a: input({ haunt: 'arcade', partners: ['b'], friends: ['c', 'd'] }),
      b: input({ partners: ['a'] }),
      c: input({ haunt: 'arcade', friends: ['a'] }),
      d: input({ friends: ['a'] }),
      e: input({ partners: ['f'] }),
      f: input({ partners: ['e'] }),
      g: input({ haunt: 'library', partners: ['h'] }),
      h: input({ haunt: 'museum', partners: ['g'] })
    }
    for (let run = 0; run < RUNS; run++) {
      const overlay = rollNpcOverlay(0, 1, 'weekend', chars, SPOTS)
      const members = placed(overlay)
      expect(new Set(members).size).toBe(members.length)
      for (const place of new Set(overlay.groups.map((group) => group.location))) {
        if (place === ROOM_LOCATION) continue
        const keepers = ['a', 'c', 'g', 'h'].filter((id) => chars[id].haunt === place)
        const others = overlay.groups
          .filter((group) => group.location === place)
          .flatMap((group) => group.members)
          .filter((id) => !keepers.includes(id))
        expect(keepers.length + others.length).toBeLessThanOrEqual(3)
      }
      // Two who each keep a haunt stay where they are.
      expect(groupOf(overlay, 'g')?.members ?? ['g']).not.toContain('h')
      const withA = groupOf(overlay, 'b')
      if (withA?.members.includes('a')) expect(withA.location).toBe('arcade')
    }
  })

  it('keeps two free lovers in one of their rooms on a passing roll', () => {
    const chars: Record<string, OverlayCharInput> = {
      e: input({ partners: ['f'] }),
      f: input({ partners: ['e'] })
    }
    const overlay = rollNpcOverlay(0, 1, null, chars, SPOTS, () => 0)
    expect(overlay.groups).toHaveLength(1)
    expect(overlay.groups[0].location).toBe(ROOM_LOCATION)
    expect(overlay.groups[0].members.sort()).toEqual(['e', 'f'])
  })
})
