import { dormBuildingOf } from '@shared/dorms'
import { affectionFor } from '@shared/relationship'
import { shuffle } from '@shared/shuffle'
import { PORTRAIT_SLOTS, useGameStore } from '../gameStore'
import {
  charAwayNow,
  charHiddenLocationNow,
  charJobNow,
  charOverlayGroupNow,
  charRoomDormNow,
  charStandingHauntAt,
  charUnavailableNow
} from '../timetable'
import { firstNameOf, nameIsKnown } from './classify'
import { jobDefOf, JOB_CATALOG } from '@shared/jobs'
import { ELYSIUM_LOCATION, LOWRISE_LOCATION, ROOM_LOCATION } from '@shared/locations'
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
    if (charUnavailableNow(charId)) return false
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

/** The odds of running into somebody while anyone on the roster is still unmet. */
const MEET_SOMEBODY_CHANCE = 0.75
/** The odds of any other body joining a nobody-named action. */
const EXTRA_CHARACTER_CHANCE = 0.25
/** The odds a public scene the reader cast by name is walked in on. */
const PUBLIC_INJECT_CHANCE = 0.1

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
 * Draws the scene's cast for an action that names nobody and is not about going to class.
 */
export function pickCast(inPublic: boolean, location?: string | null): string[] {
  if (!inPublic) return []

  let pool = freeCharacters(inPublic ? location : null)
  if (pool.length === 0) return []
  const game = useGameStore.getState()
  const anyUnmet = pool.some((charId) => game.charInfo[charId]?.flags?.hasMet !== true)

  const cast: string[] = []
  while (cast.length < PORTRAIT_SLOTS && pool.length > 0) {
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
 * met falls back to the ordinary draw.
 */
export function pickFirstNightCast(inPublic: boolean, location?: string | null): string[] {
  if (!inPublic) return []

  const game = useGameStore.getState()
  const unmet = freeCharacters(location).filter(
    (charId) => game.charInfo[charId]?.flags?.hasMet !== true
  )
  return unmet.length > 0 ? [anyOf(unmet)] : pickCast(inPublic, location)
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
  const roster = useGameStore.getState().chars
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

  const listed =
    items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}` : items[0]
  let note = `They happen to run into ${listed}.`

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
    if (charUnavailableNow(charId)) return false
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
  const who = nameIsKnown(charId) ? firstNameOf(charId) : "A girl they don't know"
  return `${who} is here, working a shift at ${employer}.`
}

/**
 * Puts whoever is working at the scene's location into it — the last casting step, run
 * after every other body has been drawn.
 */
export function admitWorkers(
  cast: readonly string[],
  location: string
): { cast: string[]; notes: string[]; jobId: string | null } {
  const workers = workersAtLocation(location)
  if (workers.length === 0) return { cast: [...cast], notes: [], jobId: null }

  const next = [...cast]
  const notes: string[] = []
  for (const worker of workers) {
    if (!next.includes(worker.charId)) {
      if (next.length >= PORTRAIT_SLOTS) continue
      next.push(worker.charId)
    }
    // Said for a worker the classifier named too: the note is what keeps her on the clock.
    notes.push(workingHereNote(worker.charId, worker.jobId))
  }
  return { cast: next, notes, jobId: workers[0].jobId }
}

/**
 * The odds a girl at her own haunt joins a scene the reader cast by name
 * holding nobody she is spending the slot with — the crash-the-party roll.
 */
const LOCAL_INJECT_CHANCE = 0.25

/**
 * Puts whoever the scene's location holds into it — the last casting step, where both
 * kinds of "she is already here" are settled together.
 */
export function admitLocals(
  cast: readonly string[],
  location: string,
  { named, inPublic }: { named: boolean; inPublic: boolean }
): { cast: string[]; notes: string[]; jobId: string | null } {
  if (!inPublic) return { cast: [...cast], notes: [], jobId: null }

  const workers = admitWorkers(cast, location)

  const next = [...workers.cast]
  const joined: string[] = []

  // Fixed before a single local is admitted: the pull does not chain, so a crasher who wins her
  // roll does not drag her own group in behind her.
  const invited = new Set(workers.cast)
  const pulledIn = (charId: string): boolean => {
    const group = charOverlayGroupNow(charId)
    return group !== null && group.members.some((member) => invited.has(member))
  }

  // Companions first, then crashers, and the cap admits bodies rather than groups: a
  // crasher cannot win the last slot from a girl the cast was already out with.
  const locals = localsAtLocation(location).map((charId) => ({
    charId,
    pulled: pulledIn(charId)
  }))
  for (const local of [...locals.filter((l) => l.pulled), ...locals.filter((l) => !l.pulled)]) {
    if (next.includes(local.charId)) continue
    if (next.length >= PORTRAIT_SLOTS) break
    if (named && !local.pulled && Math.random() >= LOCAL_INJECT_CHANCE) continue
    next.push(local.charId)
    joined.push(local.charId)
  }

  // One line for everybody who turned out to be here, in a random encounter's words.
  const notes =
    joined.length > 0 ? [...workers.notes, runIntoNote(joined, location)] : workers.notes
  return { cast: next, notes, jobId: workers.jobId }
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
