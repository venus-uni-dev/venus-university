import { studentsOf } from '@shared/classes'
import { fullNameOf, READER_SPEAKER, type Character, type ClassEntry, type SceneLine } from '@shared/types'
import { UNKNOWN_NAME, useGameStore } from '../gameStore'
import { currentSlot } from '../timetable'

/** Who is in a scene, and what they are called. */

/**
 * Resolves charIds to `Character` records, dropping anyone who has sat out long enough to
 * count as gone.
 */
export function castCharactersOf(
  charIds: readonly string[],
  includeDeparted = false
): Character[] {
  const game = useGameStore.getState()
  return charIds
    .filter((charId) => includeDeparted || !game.departed.includes(charId))
    .map((charId) => game.characters[charId])
    .filter((c): c is Character => Boolean(c))
}

/**
 * Whether every one of them has walked out — the one case a scene still running keeps its
 * departed: the floor beneath the two-turn rule, not a rule of its own.
 */
function allDeparted(charIds: readonly string[]): boolean {
  const game = useGameStore.getState()
  return charIds.length > 0 && charIds.every((charId) => game.departed.includes(charId))
}

/**
 * The cast the prose calls are built with: settled departures dropped unless that would
 * leave nobody. Asked by the turn and by `promptState` alike, so the two cannot disagree.
 */
export function presentCastOf(charIds: readonly string[]): Character[] {
  return castCharactersOf(charIds, allDeparted(charIds))
}

/** The classes meeting in the current slot; none on a weekend or a cancelled day. */
export function classesNow(): ClassEntry[] {
  const slot = currentSlot()
  if (slot === null) return []
  return Object.values(useGameStore.getState().classes).filter((entry) => entry.slot === slot)
}

/** charIds sitting in `entry` right now, read back off the characters' schedules. */
export function studentsHere(entry: ClassEntry): string[] {
  const game = useGameStore.getState()
  return studentsOf(entry, game.chars, game.charInfo)
}

/** Display name for a charId, for the casting log. */
export function nameOf(charId: string): string {
  const character = useGameStore.getState().characters[charId]
  return character ? fullNameOf(character) : charId
}

/**
 * The name a line's speaker is shown under. **Given name alone**: a roster can't hold two of the
 * same first name, so it's as unambiguous as the full one. `fullNameOf` only stands in for a
 * no-given-name character, which only a hand-written save can produce.
 */
export function speakerNameOf(line: SceneLine | null): string {
  if (!line?.speaker) return ''
  // The player's own submitted action, which resolves to nobody on the roster.
  if (line.speaker === READER_SPEAKER) return 'You'
  const game = useGameStore.getState()
  const charId = game.charKeyToId[line.speaker]
  const character = charId ? game.characters[charId] : undefined
  if (!character) return line.speaker
  if (charId && !game.charInfo[charId]?.nameKnown) return UNKNOWN_NAME
  return character.firstName.trim() || fullNameOf(character)
}
