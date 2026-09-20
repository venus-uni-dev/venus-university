import { ROOM_LOCATION } from '@shared/locations'
import type { NpcGroup, NpcSlotOverlay } from '@shared/npcRelationships'
import { pick, shuffle } from '@shared/shuffle'
import type { TimeSlot } from '@shared/types'

/**
 * Who spends one slot with whom. **Pure and randomised — no IO, no store access, rolled once per
 * slot.** Three passes over a shuffled roster (haunt friends, then evening-only friends, then
 * solo) — passes 2-3 need an evening. A place holds one *set*, unlike standing haunts.
 */

/** What one character brings into the roll. */
export interface OverlayCharInput {
  /** Her standing haunt this slot — a location id, `'room'`, or null for none. */
  haunt: string | null
  /** In class or on shift: she is not part of any of this. */
  busy: boolean
  /** One of the days she stays in — home, and out of every pass. */
  moodHomebound: boolean
  /**
   * She has already been out inside the window that gates her, so passes 2–3 skip her.
   * The caller applies the window: a weekend, or the slot just gone in spring break.
   */
  wentOutRecently: boolean
  /** Everyone she counts as a friend, as charIds. */
  friends: readonly string[]
}

/**
 * Which fatigue window a slot falls in — `'weekend'` for one outing a weekend,
 * `'break'` for one a slot, and null for a slot nobody leaves campus in.
 */
export type OutingWindow = 'weekend' | 'break' | null

/** The odds a friend says yes to being dragged along. */
const PULL_CHANCE = 0.5

/** How many friends one host can pull into her evening. */
const MAX_PULLED = 2

/** Nobody's evening holds more than this, the on-screen cap's own number. */
export const MAX_GROUP = 3

/** One slot's groups. */
export function rollNpcOverlay(
  date: number,
  time: TimeSlot,
  outings: OutingWindow,
  chars: Record<string, OverlayCharInput>,
  spots: readonly string[],
  rand: () => number = Math.random
): NpcSlotOverlay {
  const charIds = Object.keys(chars)
  const groups: NpcGroup[] = []
  const wentOut = new Set<string>()
  /** Who is already spoken for this slot — a member of some group above. */
  const grouped = new Set<string>()

  /** She is part of the roster's social life at all this slot. */
  const eligible = (charId: string): boolean => {
    const input = chars[charId]
    return input !== undefined && !input.busy && !input.moodHomebound
  }
  /** Eligible, nowhere to be, and not already in somebody's evening. */
  const isLoose = (charId: string): boolean =>
    eligible(charId) && chars[charId].haunt === null && !grouped.has(charId)

  const takenSpots = new Set<string>()
  const openSpots = (): string[] => spots.filter((spot) => !takenSpots.has(spot))
  const record = (group: NpcGroup, out: readonly string[]): void => {
    groups.push(group)
    for (const member of group.members) grouped.add(member)
    if (group.location !== ROOM_LOCATION) takenSpots.add(group.location)
    if (outings !== null) for (const member of out) wentOut.add(member)
  }

  // 1. Friends pull each other into where they were already going; a room counts.
  for (const host of shuffle(charIds, rand)) {
    if (!eligible(host) || grouped.has(host)) continue
    const haunt = chars[host].haunt
    if (haunt === null) continue

    const pulled: string[] = []
    for (const friend of shuffle(chars[host].friends, rand)) {
      if (pulled.length >= MAX_PULLED) break
      if (!isLoose(friend)) continue
      if (rand() >= PULL_CHANCE) continue
      pulled.push(friend)
    }
    if (pulled.length === 0) continue
    // Being dragged along is not a night out — no fatigue for either of them.
    record({ location: haunt, host, members: [host, ...pulled] }, [])
  }

  // 2. A free slot with free friends, on a day there is somewhere to go, is a night out; no roll.
  if (outings !== null) {
    for (const host of shuffle(charIds, rand)) {
      if (!isLoose(host) || chars[host].wentOutRecently) continue
      const companions: string[] = []
      for (const friend of shuffle(chars[host].friends, rand)) {
        if (companions.length >= MAX_GROUP - 1) break
        if (!isLoose(friend) || chars[friend].wentOutRecently) continue
        companions.push(friend)
      }
      if (companions.length === 0) continue
      const open = openSpots()
      if (open.length === 0) break
      const members = [host, ...companions]
      record({ location: pick(open, rand), members }, members)
    }
  }

  // 3. The rest go out alone, one unshared spot each.
  if (outings !== null) {
    for (const charId of shuffle(charIds, rand)) {
      if (!isLoose(charId) || chars[charId].wentOutRecently) continue
      const open = openSpots()
      if (open.length === 0) break
      record({ location: pick(open, rand), members: [charId] }, [charId])
    }
  }

  return { date, time, groups, wentOut: [...wentOut] }
}
