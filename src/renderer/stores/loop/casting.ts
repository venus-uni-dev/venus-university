import { dormBuildingOf } from '@shared/dorms'
import { pronounsOf } from '@shared/gender'
import {
  EXTRA_CHARACTER_CHANCE,
  LOCAL_INJECT_CHANCE,
  MEET_SOMEBODY_CHANCE,
  PUBLIC_INJECT_CHANCE
} from '@shared/odds'
import { affectionFor } from '@shared/relationship'
import { shuffle } from '@shared/shuffle'
import { PORTRAIT_SLOTS, useGameStore } from '../gameStore'
import type { CalendarEvent } from '@shared/types'
import {
  charAwayNow,
  charCommitmentAt,
  charHiddenLocationNow,
  charJobNow,
  charOverlayGroupNow,
  charRoomDormNow,
  castableIds,
  charSickAtHomeNow,
  charStandingHauntAt,
  charUnavailableNow
} from '../timetable'
import { firstNameOf, isContact, nameIsKnown } from './classify'
import { jobDefOf, JOB_CATALOG } from '@shared/jobs'
import { ELYSIUM_LOCATION, LOWRISE_LOCATION, ROOM_LOCATION } from '@shared/locations'
import { isTutorialSlot } from '../../prompts/introScript'
import { loreEntryById } from '../../prompts/lorebook'
import { hauntActivity } from '../../prompts/npcRelationship'

/**
 * Who ends up on screen: the encounter ladder, the draws that use
 * it, and the notes that account for everybody the player did not name.
 */

/**
 * charIds who could turn up anywhere this slot: nothing scheduled and no standing haunt
 * holding them somewhere in particular.
 */
function freeCharacters(location?: string | null): string[] {
  const game = useGameStore.getState()
  return game.chars.filter((charId) => {
    // In bed with a cold, she is reached only by name or by a plan.
    if (charUnavailableNow(charId) || charSickAtHomeNow(charId)) return false
    const haunt = charHiddenLocationNow(charId)
    if (haunt === null) return true
    return haunt === ROOM_LOCATION && atRoomBuilding(charId, location)
  })
}

/**
 * Whether a scene at `location` is the building `charId`'s room slot is in — the host's dorm
 * when an overlay group pulled her into one. **Her own room is otherwise unreachable by any
 * scene**: only the paths, porches and shared kitchens outside it match.
 */
function atRoomBuilding(charId: string, location: string | null | undefined): boolean {
  const building = dormBuildingOf(charRoomDormNow(charId))
  if (building === null) return false
  return location === (building === 'elysium' ? ELYSIUM_LOCATION : LOWRISE_LOCATION)
}

/** One uniform draw off a non-empty pool. */
export function anyOf(pool: readonly string[]): string {
  return shuffle(pool)[0]
}

/**
 * One encounter draw off the casting ladder: unmet first, then unnamed, then a disposition
 * roll.
 */
function pickEncounter(pool: readonly string[]): string {
  const game = useGameStore.getState()

  const unmet = pool.filter((charId) => game.charInfo[charId]?.flags?.hasMet !== true)
  if (unmet.length > 0) return anyOf(unmet)

  const unnamed = pool.filter((charId) => game.charInfo[charId]?.nameKnown !== true)
  if (unnamed.length > 0) return anyOf(unnamed)

  const roll = Math.floor(Math.random() * 3)
  if (roll === 1) return anyOf(pool)

  const affection = (charId: string): number =>
    affectionFor(game.charInfo[charId], game.date, game.characters[charId])
  return pool.reduce((best, charId) =>
    roll === 0
      ? affection(charId) < affection(best)
        ? charId
        : best
      : affection(charId) > affection(best)
        ? charId
        : best
  )
}

/**
 * Draws the scene's cast for an action that names nobody and is not about going to class, into
 * whatever seats `seated` leaves and never drawing one of them.
 */
export function pickCast(
  inPublic: boolean,
  location?: string | null,
  seated: readonly string[] = []
): string[] {
  if (!inPublic) return []

  let pool = freeCharacters(inPublic ? location : null).filter(
    (charId) => !seated.includes(charId)
  )
  if (pool.length === 0) return []
  const game = useGameStore.getState()
  const anyUnmet = pool.some((charId) => game.charInfo[charId]?.flags?.hasMet !== true)

  const cast: string[] = []
  while (seated.length + cast.length < PORTRAIT_SLOTS && pool.length > 0) {
    const chance = cast.length === 0 && anyUnmet ? MEET_SOMEBODY_CHANCE : EXTRA_CHARACTER_CHANCE
    if (Math.random() >= chance) break
    const picked = pickEncounter(pool)
    cast.push(picked)
    pool = pool.filter((charId) => charId !== picked)
  }
  return cast
}

/**
 * The first night's draw: one stranger, guaranteed; a roster he has somehow already
 * met falls back to the ordinary draw. Either fills only the seats `seated` leaves.
 */
export function pickFirstNightCast(
  inPublic: boolean,
  location?: string | null,
  seated: readonly string[] = []
): string[] {
  if (!inPublic || seated.length >= PORTRAIT_SLOTS) return []

  const game = useGameStore.getState()
  const unmet = freeCharacters(location).filter(
    (charId) => game.charInfo[charId]?.flags?.hasMet !== true && !seated.includes(charId)
  )
  return unmet.length > 0 ? [anyOf(unmet)] : pickCast(inPublic, location, seated)
}

/** The encounter draw, with the first night's guaranteed stranger, beside whoever is `seated`. */
export function drawFreeCast(
  inPublic: boolean,
  location?: string | null,
  seated: readonly string[] = []
): string[] {
  const game = useGameStore.getState()
  const where = resolveLocationId(location)
  return isTutorialSlot(game.date, game.time, game.semesterIndex)
    ? pickFirstNightCast(inPublic, where, seated)
    : pickCast(inPublic, where, seated)
}

/** `ids` with whoever is in `shown` moved to the front, each part keeping its order. */
export function shownFirst(ids: readonly string[], shown: readonly string[]): string[] {
  return [
    ...ids.filter((charId) => shown.includes(charId)),
    ...ids.filter((charId) => !shown.includes(charId))
  ]
}

/**
 * Splits a mention list into who actually shows up and what the reader's action says about the
 * rest.
 */
export function resolveAttendance(
  mentionedIds: readonly string[],
  required?: string,
  exempt: readonly string[] = []
): { cast: string[]; notes: string[] } {
  // A graduate back for Homecoming can be named in too.
  const roster = castableIds()
  const ordered: string[] = []
  for (const charId of [...(required ? [required] : []), ...mentionedIds]) {
    if (roster.includes(charId) && !ordered.includes(charId)) ordered.push(charId)
  }

  const cast: string[] = []
  const notes: string[] = []
  for (const charId of ordered) {
    // `required` is exempt from both tests: a scene without her is not the one agreed to.
    if (
      charId === required ||
      ((!charUnavailableNow(charId) || exempt.includes(charId)) && cast.length < PORTRAIT_SLOTS)
    ) {
      cast.push(charId)
      continue
    }
    // Two reasons, because a girl on spring break is not reachable all week.
    notes.push(
      charAwayNow(charId)
        ? `${firstNameOf(charId)} is away for spring break and couldn't come.`
        : `${firstNameOf(charId)} is busy and couldn't come.`
    )
  }
  return { cast, notes }
}

/**
 * Who a plan's own button brings, in the plan's order: every attendee the reader can reach who is
 * in the city. Her class or her shift does not keep her away.
 */
export function planAttendees(event: CalendarEvent): string[] {
  return event.charIds.filter((charId) => isContact(charId) && !charAwayNow(charId))
}

/**
 * Every attendee of every plan on the clock's slot, as {@link planAttendees} reads each, once and
 * in plan order: whoever is called, by any plan's button or by the words alone, clears the busy
 * gate, so two plans on one hour can be kept in one scene.
 */
export function slotPlanAttendees(): string[] {
  const game = useGameStore.getState()
  const attendees: string[] = []
  for (const event of game.events) {
    if (event.date !== game.date || event.time !== game.time) continue
    for (const charId of planAttendees(event)) {
      if (!attendees.includes(charId)) attendees.push(charId)
    }
  }
  return attendees
}

/**
 * A line under the opening action for each girl in the cast with a plan this slot who has class
 * or a shift in it, leaving the model to pick whether it comes after the scene or she has just
 * come from it. A girl whose class or shift the scene itself is — working where it is set, or
 * sitting the class it is in — gets none.
 */
export function commitmentNotes(
  cast: readonly string[],
  attendees: readonly string[],
  atCommitment: readonly string[]
): string[] {
  const notes: string[] = []
  for (const charId of cast) {
    if (!attendees.includes(charId) || atCommitment.includes(charId)) continue
    const commitment = charCommitmentAt(charId)
    if (!commitment) continue
    const { their } = pronounsOf(useGameStore.getState().characters[charId])
    const what =
      commitment.kind === 'class'
        ? `${their} ${commitment.name} class`
        : `a shift at ${commitment.employer}`
    notes.push(
      `${firstNameOf(charId)} either has ${what} after this or is just coming from it. Choose what makes the most sense.`
    )
  }
  return notes
}

/** Names run together as a sentence reads them: "Mina", "Mina and Mia", "Mina, Mia and Sara". */
export function listOf(items: readonly string[]): string {
  return items.length > 1
    ? `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
    : (items[0] ?? '')
}

/** Spelled-out counts for the stranger item below; `PORTRAIT_SLOTS` bounds the range. */
const COUNT_WORDS = ['', 'one', 'two', 'three', 'four'] as const

/**
 * The one line that accounts for everyone who joined a scene uninvited — the passerby and the
 * encounter draw alike — with, when `location` names where the scene sits, a further sentence
 * for each named girl who is standing in her own haunt there, saying what she is doing.
 */
export function runIntoNote(charIds: readonly string[], location?: string | null): string {
  if (charIds.length === 0) return ''

  const items = charIds.filter((charId) => nameIsKnown(charId)).map(firstNameOf)

  const strangers = charIds.length - items.length
  if (strangers === 1) items.push("someone they don't know")
  else if (strangers > 1) items.push(`${COUNT_WORDS[strangers] ?? strangers} people they don't know`)

  let note = `They happen to run into ${listOf(items)}.`

  const resolved = location ? resolveLocationId(location) : null
  if (resolved) {
    const game = useGameStore.getState()
    for (const charId of charIds) {
      if (!nameIsKnown(charId)) continue
      const haunt = charStandingHauntAt(charId, game.date, game.time)
      if (!haunt || haunt.location !== resolved) continue
      const activity = hauntActivity(resolved, haunt, game.time)
      if (activity) note += ` ${firstNameOf(charId)} is ${activity}.`
    }
  }
  return note
}

/**
 * Normalizes a place name to the form both sides of the workplace match are compared in:
 * lowercase, punctuation-free, no leading article, underscores as spaces.
 */
function placeKeyOf(name: string): string {
  return name
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/^the /, '')
    .trim()
}

/** Whoever is behind the counter of the place the action walked into. */
export function workersAtLocation(location: string): { charId: string; jobId: string }[] {
  const key = placeKeyOf(location ?? '')
  if (!key) return []

  const resolved = resolveLocationId(location)
  const def = JOB_CATALOG.find(
    (entry) =>
      (resolved !== null && entry.locationId === resolved) ||
      [entry.employer, entry.id, entry.workplaceKey].some((name) => placeKeyOf(name) === key)
  )
  if (!def) return []

  return useGameStore
    .getState()
    .chars.filter((charId) => charJobNow(charId) === def.id)
    .map((charId) => ({ charId, jobId: def.id }))
}

/** The location id the classifier's answer names, or null. */
export function resolveLocationId(location: string | null | undefined): string | null {
  const raw = (location ?? '').trim()
  if (!raw) return null

  const entry = loreEntryById(raw)
  if (entry?.id) return entry.id

  const key = placeKeyOf(raw)
  if (!key) return null

  // A catalog spelling of a workplace resolves through the job that names it.
  const job = JOB_CATALOG.find((entry) =>
    [entry.employer, entry.id, entry.workplaceKey].some((name) => placeKeyOf(name) === key)
  )
  return job?.locationId ?? null
}

/**
 * Whoever is standing around at the scene's location off her own hidden schedule — the
 * haunt sibling of {@link workersAtLocation}.
 */
export function localsAtLocation(location: string): string[] {
  const resolved = resolveLocationId(location)
  if (!resolved || resolved === ROOM_LOCATION) return []

  return useGameStore.getState().chars.filter((charId) => {
    if (charUnavailableNow(charId) || charSickAtHomeNow(charId)) return false
    const haunt = charHiddenLocationNow(charId)
    if (haunt === null) return false
    return haunt === resolved || (haunt === ROOM_LOCATION && atRoomBuilding(charId, resolved))
  })
}

/**
 * The line accounting for a character the reader found at work — the workplace-visit
 * sibling of {@link runIntoNote}, masked the same way.
 */
export function workingHereNote(charId: string, jobId: string): string {
  const employer = jobDefOf(jobId)?.employer ?? 'work'
  const { noun } = pronounsOf(useGameStore.getState().characters[charId])
  const who = nameIsKnown(charId) ? firstNameOf(charId) : `A ${noun} they don't know`
  return `${who} is here, working a shift at ${employer}.`
}

/**
 * Puts whoever the scene's location holds into it after the people called — the workers, then
 * the locals — with anybody in `shown` seated ahead of everybody else, and `pickUp`'s bodies (the
 * passerby or the draw, given the seats taken so far) between the two. The workers come with
 * their notes; the locals come back as `joined`, for the caller to name in its one run-into line.
 */
export function admitLocals(
  cast: readonly string[],
  location: string,
  {
    named,
    inPublic,
    shown = [],
    pickUp
  }: {
    named: boolean
    inPublic: boolean
    shown?: readonly string[]
    pickUp?: (seated: readonly string[]) => readonly string[]
  }
): { cast: string[]; notes: string[]; joined: string[]; jobId: string | null } {
  if (!inPublic) {
    return { cast: [...cast, ...(pickUp?.(cast) ?? [])], notes: [], joined: [], jobId: null }
  }

  const workers = workersAtLocation(location)
  const workerIds = workers.map((worker) => worker.charId)

  // Fixed before a single local is admitted: the pull does not chain, so a crasher who wins her
  // roll does not drag her own group in behind her.
  const invited = new Set([...cast, ...workerIds])
  const pulledIn = (charId: string): boolean => {
    const group = charOverlayGroupNow(charId)
    return group !== null && group.members.some((member) => invited.has(member))
  }

  // Companions ahead of crashers, and the cap admits bodies rather than groups: a crasher cannot
  // win the last slot from a girl the cast was already out with.
  const locals = localsAtLocation(location).filter((charId) => !workerIds.includes(charId))
  const crashers = locals.filter((charId) => !pulledIn(charId))
  const order = [...workerIds, ...locals.filter((charId) => !crashers.includes(charId)), ...crashers]

  const next = [...cast]
  const joined: string[] = []
  const seat = (ids: readonly string[]): void => {
    for (const charId of ids) {
      if (next.includes(charId)) continue
      if (next.length >= PORTRAIT_SLOTS) break
      if (named && crashers.includes(charId) && Math.random() >= LOCAL_INJECT_CHANCE) continue
      next.push(charId)
      if (!workerIds.includes(charId)) joined.push(charId)
    }
  }

  seat(order.filter((charId) => shown.includes(charId)))
  for (const charId of pickUp?.(next) ?? []) {
    if (!next.includes(charId)) next.push(charId)
  }
  seat(order.filter((charId) => !shown.includes(charId)))

  // Said for a worker the classifier named too: the note is what keeps her on the clock.
  const notes = workers
    .filter((worker) => next.includes(worker.charId))
    .map((worker) => workingHereNote(worker.charId, worker.jobId))
  return { cast: next, notes, joined, jobId: workers[0]?.jobId ?? null }
}

/**
 * The other half of `resolveAttendance`: a character nobody invited, walking into a public
 * scene.
 */
export function injectPasserby(
  cast: readonly string[],
  inPublic: boolean,
  location?: string | null
): string | null {
  if (!inPublic || cast.length >= PORTRAIT_SLOTS) return null
  if (Math.random() >= PUBLIC_INJECT_CHANCE) return null

  const pool = freeCharacters(location).filter((charId) => !cast.includes(charId))
  if (pool.length === 0) return null

  return pickEncounter(pool)
}
