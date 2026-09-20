import {
  buildClassifierPrompt,
  classCodeKey,
  type ClassifierPromptRequest
} from '@shared/classifier'
import { charKeyOf, fullNameOf, type AppError } from '@shared/types'
import { jobDefOf } from '@shared/jobs'
import type { DormId } from '@shared/dorms'
import { locationDefOf, LOWRISE_LOCATION, ROOM_LOCATION } from '@shared/locations'
import { useGameStore } from '../gameStore'
import { createRetryGate } from '../retryGate'
import { charHiddenLocationNow, charJobNow, charRoomDormNow, playerClassNow } from '../timetable'
import { classesNow, studentsHere } from './cast'
import { playerProjectClasses } from './jobs'
import { currentRun, runStale, LOOP_LLM_GROUP } from './state'

/**
 * The classifier: who the action names, what kind of action it is,
 * and whether the scene is somewhere public — plus the refusals the app
 * composes for itself rather than asking the model for.
 */

/** What the classifier's failure modal is waiting on, while a turn sits inside it. */
export const classifierGate = createRetryGate((error) =>
  useGameStore.getState().setClassifierError(error)
)

/** The failure modal's Retry — re-sends the identical request and resumes the turn. */
export function retryClassify(): void {
  classifierGate.answer(true)
}

/** The failure modal's way out — abandons the turn so the view can leave. */
export function abandonClassify(): void {
  classifierGate.answer(false)
}

/**
 * Asks the classifier who the action names, what kind of action it is, and whether the scene
 * is somewhere public.
 */
export async function classifyAction(
  action: string,
  prior?: ClassifyAttempt
): Promise<Verdict | null> {
  // A prefetched result stands in for the first send, so a failed hangout is not classified twice.
  const run = currentRun()
  const attempt = prior ?? buildClassifyAttempt(action)
  if (!attempt.request) return attempt.verdict ?? null

  // Taken, not read: a retry must re-send rather than replay the banked failure.
  const spent = attempt.result
  attempt.result = undefined
  let result = spent ?? (await classifyOnce(attempt))
  for (;;) {
    // Null is "the player left" to every caller.
    if (runStale(run)) return null
    if (result.ok) return result.verdict

    console.warn('[loop] classifier failed, waiting on the player:', result.error)
    if (!(await classifierGate.ask(result.error))) return null
    if (runStale(run)) return null
    result = await classifyOnce(attempt)
  }
}

/** The classifier's answer — who the action names and what kind of action it is. */
export interface Verdict {
  /** Who the action names *and* puts in the scene — the casting list. */
  mentioned: string[]
  /**
   * Who it names without bringing along. They cast nobody: the loop files them
   * as the scene's mentions, and the lorebook describes each as absent.
   */
  mentionedOnly: string[]
  actionType: string
  inPublic: boolean
  /** Where the action set the scene, in the model's words; matched locally. */
  sceneLocation: string
}

/** The verdict for a turn with nothing to ask about — an empty roster. */
const EMPTY_VERDICT: Verdict = {
  mentioned: [],
  mentionedOnly: [],
  actionType: '',
  inPublic: true,
  sceneLocation: ''
}

/**
 * One turn's classifier call, built once and re-sent verbatim by every retry — which is also
 * what keeps the Gemini adapter's cached prefix warm across the failure.
 */
export interface ClassifyAttempt {
  request: ClassifierPromptRequest | null
  charKeys: string[]
  verdict?: Verdict
  result?: { ok: true; verdict: Verdict } | { ok: false; error: AppError }
}

/** Prepares a turn's classifier call without sending it. */
export function buildClassifyAttempt(action: string): ClassifyAttempt {
  const game = useGameStore.getState()
  const charKeys = Object.keys(game.charKeyToId)
  if (charKeys.length === 0) {
    return { request: null, charKeys, verdict: EMPTY_VERDICT }
  }

  // Key and name both: the sentence says "Kira", the reply has to say `kira_weber`.
  const roster = Object.values(game.characters).map((character) => ({
    charKey: charKeyOf(character.firstName, character.lastName),
    name: fullNameOf(character)
  }))

  return {
    request: buildClassifierPrompt(
      action,
      roster,
      classesNow(),
      occupiedLocations(),
      playerProjectClasses()
    ),
    charKeys
  }
}

/**
 * Every place somebody is standing in this slot, deduplicated — behind a counter
 * or on her own hidden schedule, handed to the classifier as one list.
 */
function occupiedLocations(): { id: string; blurb: string }[] {
  const game = useGameStore.getState()
  const ids: string[] = []

  const add = (id: string | null | undefined): void => {
    if (id && !ids.includes(id)) ids.push(id)
  }

  for (const charId of game.chars) {
    const jobId = charJobNow(charId)
    if (jobId) {
      add(jobDefOf(jobId)?.locationId)
      continue
    }
    const location = charHiddenLocationNow(charId)
    if (location === ROOM_LOCATION) {
      const dorm = charRoomDormNow(charId)
      if (dorm !== undefined && isLowrise(dorm)) add(LOWRISE_LOCATION)
      continue
    }
    add(location)
  }

  return ids.flatMap((id) => {
    const def = locationDefOf(id)
    return def ? [{ id: def.id, blurb: def.blurb }] : []
  })
}

/** Whether a dorm is one of the shared Lowrises rather than an Elysium townhouse. */
function isLowrise(dorm: DormId): boolean {
  return dorm !== 'elysium'
}

/**
 * Sends a prepared classifier call once and returns what came back — no modal, no parking.
 */
export async function classifyOnce(
  attempt: ClassifyAttempt
): Promise<{ ok: true; verdict: Verdict } | { ok: false; error: AppError }> {
  if (!attempt.request) {
    return { ok: true, verdict: attempt.verdict ?? EMPTY_VERDICT }
  }

  const result = await window.api.llm.classify(attempt.request, attempt.charKeys, LOOP_LLM_GROUP)
  if (!result.ok) return { ok: false, error: result.error }

  const charKeyToId = useGameStore.getState().charKeyToId
  const toIds = (keys: readonly string[]): string[] =>
    keys.map((key) => charKeyToId[key]).filter((charId): charId is string => Boolean(charId))
  return {
    ok: true,
    verdict: {
      mentioned: toIds(result.data.characters),
      mentionedOnly: toIds(result.data.mentionedOnly),
      actionType: result.data.actionType,
      inPublic: result.data.inPublic,
      sceneLocation: result.data.sceneLocation
    }
  }
}

/** The player refused a turn: a rewording problem, never a retry. */
export function rejection(message: string): AppError {
  return { code: 'CLASSIFIER_REJECTED', message }
}

/** The player refuses to know a name until a scene has said it out loud. */
export function nameIsKnown(charId: string): boolean {
  return useGameStore.getState().charInfo[charId]?.nameKnown === true
}

/** Whether the reader has her number — the gate on naming her into a scene. */
export function isContact(charId: string): boolean {
  return useGameStore.getState().charInfo[charId]?.flags?.gaveContactInfo === true
}

/**
 * The refusal for naming someone the reader has never been introduced to — vague about
 * *who*, or it would hand over the very name it withholds.
 */
export const UNKNOWN_NAME_REJECTION = "You don't know anyone by that name yet."

/** First name for a message the player reads; falls back to the charId. */
export function firstNameOf(charId: string): string {
  return useGameStore.getState().characters[charId]?.firstName ?? charId
}

/**
 * Resolves a `goto_class:` action into its cast, or an error the player has to
 * answer.
 */
export function castForClass(
  code: string,
  mentionedIds: string[]
): { cast: string[]; classCode: string } | { error: AppError } {
  const enrolled = playerClassNow()
  if (!enrolled) {
    return { error: rejection("You don't have a class right now.") }
  }
  if (code && classCodeKey(code) !== classCodeKey(enrolled)) {
    return { error: rejection("You're not enrolled in this class.") }
  }

  const entry = useGameStore.getState().classes[enrolled]
  if (!entry) {
    return { error: rejection("You don't have a class right now.") }
  }

  const students = studentsHere(entry)
  const absent = mentionedIds.find((charId) => !students.includes(charId))
  if (absent) {
    return { error: rejection(`${firstNameOf(absent)} isn't in that class.`) }
  }

  return { cast: students, classCode: enrolled }
}
