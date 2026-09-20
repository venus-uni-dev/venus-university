import { dormSpotsOf, type DormBuilding } from '@shared/dorms'
import { ROOM_LOCATION } from '@shared/locations'
import type { NpcEncounterGroup } from '@shared/npcRelationships'
import { pick, shuffle } from '@shared/shuffle'
import { MAX_GROUP } from './npcOverlay'

/**
 * Who ran into whom off the overlay's books: residents out in their own building's shared
 * rooms, and pairs who bumped into each other out on campus. Pure and randomised — no store
 * access, the caller reads the store and hands both rolls what they need.
 */

/** The odds somebody spending the slot in her room is out in the building's shared rooms. */
const DORM_COMMON_CHANCE = 0.6

/** The odds a character out on campus bumps into somebody. */
const LOOSE_RUN_IN_CHANCE = 0.6

/** What one character brings into the two rolls. */
export interface RunInCharInput {
  /** In class, on shift or off campus: she is part of neither roll. */
  busy: boolean
  /** Where she is this slot — a location id, `'room'`, or null for a slot with no place. */
  location: string | null
  /** Her standing haunt, which is where a run-in with her happens. */
  haunt: string | null
  /** Which building her room is in, or null for a character with no dorm. */
  building: DormBuilding | null
  /** In the scene, or already in a group this slot. */
  spokenFor: boolean
}

/** Who spent a home slot out in her building's kitchens and lounges, and with whom. */
export function rollDormRunIns(
  chars: Record<string, RunInCharInput>,
  rand: () => number = Math.random
): NpcEncounterGroup[] {
  const winners = new Map<DormBuilding, string[]>()
  for (const charId of Object.keys(chars)) {
    const input = chars[charId]
    if (input.busy || input.spokenFor) continue
    if (input.location !== ROOM_LOCATION || input.building === null) continue
    if (rand() >= DORM_COMMON_CHANCE) continue
    const building = winners.get(input.building) ?? []
    building.push(charId)
    winners.set(input.building, building)
  }

  const groups: NpcEncounterGroup[] = []
  for (const [building, residents] of winners) {
    const spots = dormSpotsOf(building)
    const order = shuffle(residents, rand)
    for (let i = 0; i < order.length; i += MAX_GROUP) {
      const members = order.slice(i, i + MAX_GROUP)
      // A leftover of one met nobody.
      if (members.length < 2) continue
      groups.push({ kind: 'dorm', ref: pick(spots, rand).id, members })
    }
  }
  return groups
}

/** Who bumped into whom out on campus, a pair at a time, at one of their own haunts. */
export function rollLooseRunIns(
  chars: Record<string, RunInCharInput>,
  spots: readonly string[],
  rand: () => number = Math.random
): NpcEncounterGroup[] {
  const candidates = Object.keys(chars).filter((charId) => {
    const input = chars[charId]
    return !input.busy && !input.spokenFor && input.location !== ROOM_LOCATION
  })

  const groups: NpcEncounterGroup[] = []
  const paired = new Set<string>()
  for (const charId of shuffle(candidates, rand)) {
    if (paired.has(charId)) continue
    if (rand() >= LOOSE_RUN_IN_CHANCE) continue
    const free = candidates.filter((other) => other !== charId && !paired.has(other))
    if (free.length === 0) continue
    const partner = pick(free, rand)
    paired.add(charId)
    paired.add(partner)

    const haunt = chars[charId].haunt ?? chars[partner].haunt
    // Neither of them keeps a haunt and there is nowhere open to fall back on: a `pick` off an
    // empty list is `undefined`, which would write an encounter with no place into the save.
    if (haunt === null && spots.length === 0) continue
    groups.push({
      kind: 'hangout',
      ref: haunt ?? pick(spots, rand),
      members: [charId, partner]
    })
  }
  return groups
}
