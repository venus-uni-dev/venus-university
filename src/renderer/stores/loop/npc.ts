import { studentsOf } from '@shared/classes'
import { dormBuildingOf } from '@shared/dorms'
import {
  isLocationOpen,
  LOCATIONS,
  LOWRISE_LOCATION,
  OUTING_LOCATIONS,
  ROOM_LOCATION
} from '@shared/locations'
import {
  newCouples,
  newFriendships,
  npcFriendsOf,
  npcPartnersOf,
  settleNpcPairsFull,
  type NpcAdvice,
  type NpcEncounterGroup,
  type NpcSettleResult,
  type NpcRelationshipMap,
  type NpcSlotOverlay
} from '@shared/npcRelationships'
import { npcAttractionOf } from '@shared/relationship'
import type { Attraction, Character, CharInfo, Haunt, TimeSlot } from '@shared/types'
import { globalSlotOf, jobDefOf, shiftSlotOf } from '@shared/jobs'
import { isRainedOut, weatherAt } from '@shared/weather'
import { classSlotOf, hauntClosedOn, isBreakOutingWeek } from '../../prompts/occasions'
import { prevSlot, shiftWeekdayOf, weekendSaturdayOf } from '../../prompts/gameDate'
import { useGameStore } from '../gameStore'
import { rollNpcOverlay, type OutingWindow, type OverlayCharInput } from '../npcOverlay'
import {
  rollDormRunIns,
  rollLooseRunIns,
  sharedHauntGroups,
  type RunInCharInput,
  type SharedHauntCharInput
} from '../npcRunIns'
import {
  charAwayNow,
  charHiddenLocationNow,
  charOverlayGroupNow,
  charSickAtHomeNow,
  charStandingHauntAt,
  charStandingHauntNow,
  charUnavailableNow,
  classCodeIn,
  isHomebound,
  jobIn,
  standingHauntIn
} from '../timetable'

/** The roster's own social life, where it meets the store. */

/** Where a character is this slot and who is with her. */
export interface NpcWhereabouts {
  /** A location id, or `'room'`. */
  location: string
  /** Companions whose names the reader has heard, in group order. */
  knownNames: string[]
  /** How many more are with her whose names he has not. */
  unknown: number
  /** Her own standing haunt, when that is where she is. */
  haunt?: Haunt
}

/** A transfer arriving at the slot being rolled, not yet on the roster: her character and entry. */
export interface Arrival {
  charId: string
  character: Character
  info: CharInfo
}

/**
 * Where a student whose entry is `info` stands in a slot, off that entry and whether she is off
 * campus: her standing haunt, whether she is out of the overlay's passes, whether she stays in,
 * and the employer she is working for.
 */
function standingOf(
  charId: string,
  character: Character | undefined,
  info: CharInfo | undefined,
  date: number,
  time: TimeSlot
): Pick<OverlayCharInput, 'haunt' | 'busy' | 'moodHomebound'> & { jobId: string | null } {
  const game = useGameStore.getState()
  const away = charAwayNow(charId, date)
  const jobId = jobIn(info, date, time, game.calendar, away)
  const committed = classCodeIn(info, date, time, game.calendar) !== null || jobId !== null
  return {
    // The standing haunt, not `charHiddenLocationNow`, which reads the overlay this call is
    // producing and would deal a replay a second evening.
    haunt:
      standingHauntIn(info, date, time, game.calendar, game.weather, committed)?.location ?? null,
    // Off campus takes her out of all three passes at once.
    busy: committed || away,
    moodHomebound: isHomebound(character, info, date, time),
    jobId
  }
}

/**
 * Rolls who spends `date`/`time` with whom: the roster, and whoever is `arriving` at that slot,
 * each a stranger to everybody with nothing yet to keep her in.
 */
export function rollNpcOverlayNow(
  date: number,
  time: TimeSlot,
  relationships: NpcRelationshipMap = useGameStore.getState().npcRelationships,
  arriving: readonly Arrival[] = []
): NpcSlotOverlay {
  const game = useGameStore.getState()
  const window = outingWindowOf(date)
  const saturday = weekendSaturdayOf(date)
  const previous = prevSlot(date, time)

  const chars: Record<string, OverlayCharInput> = {}
  // Where one of the roster or an arrival is working a shift.
  const worked = new Set<string>()
  const addWorkplace = (jobId: string | null): void => {
    const workplace = jobId === null ? undefined : jobDefOf(jobId)?.locationId
    if (workplace) worked.add(workplace)
  }
  for (const charId of game.chars) {
    const { jobId, ...standing } = standingOf(
      charId,
      game.characters[charId],
      game.charInfo[charId],
      date,
      time
    )
    addWorkplace(jobId)
    chars[charId] = {
      ...standing,
      // Each window reads only its own record, off the arguments rather than the clock, which
      // at an ending names the slot before the one being rolled.
      wentOutRecently:
        window === 'break'
          ? game.outingSlots[charId] === globalSlotOf(previous.date, previous.time)
          : window === 'weekend' &&
            saturday !== null &&
            game.weekendOutings[charId] === saturday,
      friends: npcFriendsOf(relationships, charId, game.chars),
      partners: npcPartnersOf(relationships, charId, game.chars)
    }
  }
  for (const { charId, character, info } of arriving) {
    if (chars[charId]) continue
    const { jobId, ...standing } = standingOf(charId, character, info, date, time)
    addWorkplace(jobId)
    chars[charId] = { ...standing, wentOutRecently: false, friends: [], partners: [] }
  }

  // A spot shut this half of the day, open-air under rain, or where one of the roster is working
  // a shift is never drawn for an outing.
  const sky = weatherAt(game.weather, date, time)
  const spots = OUTING_LOCATIONS.filter(
    (id) =>
      isLocationOpen(id, shiftSlotOf(shiftWeekdayOf(date), time)) &&
      !isRainedOut(id, sky) &&
      !worked.has(id)
  )
  return rollNpcOverlay(date, time, window, chars, spots)
}

/** Which fatigue window a date falls in. */
function outingWindowOf(date: number): OutingWindow {
  if (isBreakOutingWeek(date, useGameStore.getState().calendar.season)) return 'break'
  return weekendSaturdayOf(date) !== null ? 'weekend' : null
}

/** Files an overlay as the slot's own, and banks its fatigue. */
export function applyNpcOverlay(overlay: NpcSlotOverlay): void {
  const game = useGameStore.getState()
  game.setNpcOverlay(overlay)
  if (outingWindowOf(overlay.date) === 'break') {
    game.recordOutingSlots(overlay.wentOut, globalSlotOf(overlay.date, overlay.time))
    return
  }
  const saturday = weekendSaturdayOf(overlay.date)
  if (saturday !== null) game.recordWeekendOutings(overlay.wentOut, saturday)
}

/**
 * Every encounter the finished slot held — the lectures, the hour's hangouts, the haunts kept
 * side by side and the run-ins. Rolled once per ending, because the run-ins are dice, and read
 * by both settles.
 */
export function rollSlotEncounterGroups(): NpcEncounterGroup[] {
  const game = useGameStore.getState()
  const groups: NpcEncounterGroup[] = []

  // Who sat in a lecture together; null on a weekend or a closed day.
  const slot = classSlotOf(game.date, game.time, game.calendar)
  if (slot !== null) {
    for (const entry of Object.values(game.classes)) {
      if (entry.slot !== slot) continue
      // A student in bed with a cold sat in nothing.
      const members = studentsOf(entry, game.chars, game.charInfo).filter(
        (charId) => !charSickAtHomeNow(charId)
      )
      if (members.length >= 2) groups.push({ kind: 'class', ref: entry.code, members })
    }
  }

  // Who spent the hour together; a stale overlay contributes nothing.
  const overlay = game.npcOverlay
  if (overlay && overlay.date === game.date && overlay.time === game.time) {
    for (const group of overlay.groups) {
      if (group.members.length < 2) continue
      groups.push({
        kind: 'hangout',
        ref: group.location,
        members: group.members,
        ...(group.host ? { host: group.host } : {})
      })
    }
  }

  // Who kept a haunt at the same place, met there. No pair is counted twice over the overlay:
  // a girl keeping a haunt is in an overlay group only as its one host, never pulled into
  // another's, so no overlay group holds two of them.
  const haunters: Record<string, SharedHauntCharInput> = {}
  for (const charId of game.chars) {
    haunters[charId] = {
      haunt: charStandingHauntNow(charId, game.date, game.time)?.location ?? null,
      excluded:
        game.cast.includes(charId) ||
        charUnavailableNow(charId, game.date, game.time) ||
        charSickAtHomeNow(charId)
    }
  }
  groups.push(...sharedHauntGroups(haunters))

  // Nobody is counted twice: the cast and everybody already grouped above are out of both rolls.
  const spokenFor = new Set([...game.cast, ...groups.flatMap((group) => group.members)])
  const runIns: Record<string, RunInCharInput> = {}
  for (const charId of game.chars) {
    runIns[charId] = {
      // In bed with a cold, she runs into nobody.
      busy: charUnavailableNow(charId, game.date, game.time) || charSickAtHomeNow(charId),
      location: charHiddenLocationNow(charId, game.date, game.time),
      haunt: charStandingHauntAt(charId, game.date, game.time)?.location ?? null,
      building: dormBuildingOf(game.charInfo[charId]?.dorm),
      spokenFor: spokenFor.has(charId)
    }
  }
  groups.push(...rollDormRunIns(runIns), ...rollLooseRunIns(runIns, runInSpots()))

  return groups
}

/**
 * Rolls every affinity and love life the finished slot earned and returns the settled map,
 * writing nothing. `charInfo` is who stands where with the reader once the scene is paid for,
 * which the ending projects.
 */
export function rollNpcRelationshipSettle(
  bonded: readonly string[] = [],
  groups: readonly NpcEncounterGroup[] = rollSlotEncounterGroups(),
  charInfo: Readonly<Record<string, CharInfo | undefined>> = useGameStore.getState().charInfo,
  relationships: NpcRelationshipMap = useGameStore.getState().npcRelationships
): NpcRelationshipMap {
  return rollNpcSettle(bonded, groups, charInfo, relationships).relationships
}

/**
 * {@link rollNpcRelationshipSettle} with the reader's `advice` this slot taken first, and what
 * the texts read off the settle: who argued and stayed together, and what his advice came to.
 */
export function rollNpcSettle(
  bonded: readonly string[],
  groups: readonly NpcEncounterGroup[],
  charInfo: Readonly<Record<string, CharInfo | undefined>>,
  relationships: NpcRelationshipMap,
  advice: readonly NpcAdvice[] = []
): NpcSettleResult {
  const game = useGameStore.getState()
  const everyone = [...game.chars, ...game.alumni]
  const attraction: Record<string, Attraction> = {}
  for (const charId of everyone) {
    attraction[charId] = npcAttractionOf(game.characters[charId], charInfo[charId], game.romance)
  }
  return settleNpcPairsFull({
    date: game.date,
    relationships,
    cast: game.cast,
    bonded,
    groups,
    characters: game.characters,
    roster: game.chars,
    alumni: game.alumni,
    attraction,
    readerCrush: game.chars.filter((charId) => charInfo[charId]?.flags?.hasCrush === true),
    readerLovers: game.chars.filter((charId) => charInfo[charId]?.flags?.isLover === true),
    readerClosed: game.chars.filter((charId) => {
      const flags = charInfo[charId]?.flags
      return flags?.isLover === true && flags.harem !== true
    }),
    night: game.time === 1,
    ...(advice.length > 0 ? { advice } : {})
  })
}

/** Every answer the reader gave this slot to a vent or a question about a crush, off the phone. */
export function adviceGivenNow(): NpcAdvice[] {
  const given: NpcAdvice[] = []
  for (const [charId, chat] of Object.entries(useGameStore.getState().bunnyboard.conversations)) {
    const advice = chat.advice
    if (advice?.answer) given.push({ charId, about: advice.about, answer: advice.answer })
  }
  return given
}

/**
 * Where a pair with no haunt between them can be run into: on campus, open today, not open-air
 * under rain, and never the Lowrises, whose label is one girl's own dorm.
 */
function runInSpots(): string[] {
  const game = useGameStore.getState()
  const sky = weatherAt(game.weather, game.date, game.time)
  return LOCATIONS.filter(
    (def) =>
      def.onCampus === true &&
      def.id !== LOWRISE_LOCATION &&
      !hauntClosedOn(def.id, 'fun', game.date, game.calendar) &&
      !isRainedOut(def.id, sky)
  ).map((def) => def.id)
}

/**
 * Records whoever the settle just made friends for the first time, stamped with the slot
 * that did it. **Run before the settled map is stored**, since the crossing is the difference
 * between the two; idempotent under the boundary's replay, where the two maps agree.
 */
export function applyNewFriendships(before: NpcRelationshipMap, after: NpcRelationshipMap): void {
  const game = useGameStore.getState()
  const fresh = newFriendships(before, after, game.npcFriendships)
  if (fresh.length === 0) return
  game.recordNpcFriendships(
    fresh.map((pair) => ({ ...pair, date: game.date, time: game.time }))
  )
}

/**
 * Records whoever the settle just put together, stamped with the slot that did it, and takes
 * each one's crush on the reader and friends-with-benefits standing where she is not open.
 * **Run before the settled map is stored**; idempotent under the boundary's replay.
 */
export function applyNewCouples(before: NpcRelationshipMap, after: NpcRelationshipMap): void {
  const game = useGameStore.getState()
  const fresh = newCouples(before, after, game.npcCouples)
  if (fresh.length === 0) return
  game.recordNpcCouples(fresh.map((couple) => ({ ...couple, time: game.time })))
}

/**
 * Where a character is and who is with her, for the two prompts that say so.
 */
export function npcWhereaboutsFor(
  charId: string,
  date: number,
  time: TimeSlot,
  overlay: NpcSlotOverlay | null,
  charInfo: Readonly<Record<string, CharInfo | undefined>> = useGameStore.getState().charInfo
): NpcWhereabouts | null {
  const game = useGameStore.getState()
  // Ahead of the homebound branch: a girl abroad on a stay-in day is not in her room.
  if (charUnavailableNow(charId, date, time)) return null
  // A graduate back for the day keeps no room or haunt in Veridan.
  if (game.alumni.includes(charId)) return null

  const stamped = overlay && overlay.date === date && overlay.time === time ? overlay : null
  const group = stamped
    ? (stamped.groups.find((g) => g.members.includes(charId)) ?? null)
    : charOverlayGroupNow(charId, date, time)

  const homebound = isHomebound(game.characters[charId], charInfo[charId], date, time)
  const standing = charStandingHauntAt(charId, date, time)
  const location = homebound ? ROOM_LOCATION : (group?.location ?? standing?.location)
  if (!location) return null

  const knownNames: string[] = []
  let unknown = 0
  // A homebound girl is alone whatever the overlay said: a stale one from before the day
  // turned can still list her.
  for (const member of homebound ? [] : (group?.members ?? [])) {
    if (member === charId) continue
    const character = game.characters[member]
    if (!character) continue
    if (charInfo[member]?.nameKnown) knownNames.push(character.firstName)
    else unknown++
  }

  const atHaunt = !homebound && standing && location === standing.location
  return { location, knownNames, unknown, ...(atHaunt ? { haunt: standing } : {}) }
}
