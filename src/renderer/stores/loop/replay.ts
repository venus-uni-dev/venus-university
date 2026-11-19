import { replayIdsOf, type SlotReplay } from '@shared/replays'
import { semesterChain, type ChainedSemester } from '@shared/semesters'
import {
  AUTOSAVE_ID,
  READER_SPEAKER,
  type BankedOpening,
  type Character,
  type GameSave,
  type LedgerResponse,
  type PlaythroughRecord,
  type SceneLine,
  type SceneState,
  type TimeSlot
} from '@shared/types'
import { useGameStore, type ReplayStayFields } from '../gameStore'
import { sceneActiveOf } from '../textingLoop'
import { useUiStore } from '../uiStore'
import {
  manualSaveDraft,
  manualSaveOffer,
  openingScene,
  replayOfferOf,
  type ReplayOffer
} from './saves'
import { currentRun, loopState, runStale } from './state'

/**
 * The calendar's replays from the game's side: the record a finished scene leaves, when one may
 * be played, the game held in memory while it is, and the reads and deletes the calendar asks for.
 */

/** The game a replay was opened from, held in memory until the replay ends. */
export interface HeldGame {
  /** The game as a load of it would find it: a manual save's draft, stamped as a save. */
  save: GameSave
  record: PlaythroughRecord
  characters: Record<string, Character>
  /** What the loop held besides the save, put back once the game is entered again. */
  decisionSave: SceneState | null
  slotSaveId: string | null
  examTextLedger: Promise<LedgerResponse | null> | null
  examOpening: Promise<BankedOpening | null> | null
  /** The words standing in the well. */
  inputDraft: string
  /** What the replay's stay reads off the game, its slot and keys aside. */
  stay: Omit<ReplayStayFields, 'date' | 'time'>
}

/** The game held while a replay is read; taken once, by the replay's end. */
let held: HeldGame | null = null

/** The calls whose settling has been seen, and those already being watched for it. */
const settled = new WeakSet<Promise<unknown>>()
const watched = new WeakSet<Promise<unknown>>()

/** Bumped as each watched call settles, for a view subscribed to the replay's offer. */
let settles = 0
const settleListeners = new Set<() => void>()

/** Whether `call` is absent or has settled; one not seen to settle yet is watched until it does. */
function settledOf(call: Promise<unknown> | null | undefined): boolean {
  if (!call || settled.has(call)) return true
  if (!watched.has(call)) {
    watched.add(call)
    const done = (): void => {
      settled.add(call)
      settles += 1
      for (const listener of settleListeners) listener()
    }
    call.then(done, done)
  }
  return false
}

/** Subscribes to the settling of the calls the replay's offer waits on. */
export function subscribeReplaySettles(listener: () => void): () => void {
  settleListeners.add(listener)
  return () => settleListeners.delete(listener)
}

/** How many of those calls have settled so far: the snapshot a subscription compares. */
export function replaySettleCount(): number {
  return settles
}

/**
 * What the calendar's Replay offers right now: dead through a scene, and otherwise Save Game's
 * offer, waiting as well while a call is out that leaving the game would cancel and entering it
 * again would pay for again — the slot's texting ledger not yet banked, an exam's ledger and
 * opening, the graduation picture and posts, a transfer student still being generated.
 */
export function replayOffer(): ReplayOffer {
  const game = useGameStore.getState()
  // Every call is watched, so whichever settles last still wakes the view.
  const calls = [
    loopState.textLedgerPrefetch?.promise,
    loopState.examTextLedger,
    loopState.examOpening,
    loopState.endingPostsCall
  ].map(settledOf)
  const callsOut =
    calls.includes(false) || game.endingArtPending || Object.keys(game.transferJobs).length > 0
  return replayOfferOf(manualSaveOffer(), sceneActiveOf(game), callsOut)
}

/**
 * The record a finished slot's scene leaves for the calendar, read before the scene is cleared:
 * its cast with the keys they were played under, and the transcript as delivered. Null where the
 * scene said nothing but the reader's own lines.
 */
export function slotReplayOf(date: number, time: TimeSlot): SlotReplay | null {
  const game = useGameStore.getState()
  const transcript = game.currentSceneTranscript
  if (!transcript.some((line) => line.speaker !== READER_SPEAKER)) return null
  const cast = [...game.cast]
  const keys = Object.fromEntries(
    Object.entries(game.charKeyToId).filter(([, charId]) => cast.includes(charId))
  )
  return {
    schemaVersion: 1,
    date,
    time,
    cast,
    keys,
    transcript: transcript.map((line) => ({ ...line }))
  }
}

/**
 * A replay's lines to queue, copied, the first of them shown — the reader's own are passed over —
 * given the first background any of them names, so the stage is set from the first line read
 * whichever line named it.
 */
export function replayLinesOf(transcript: readonly SceneLine[]): SceneLine[] {
  const lines = transcript.map((line) => ({ ...line }))
  const bg = lines.find((line) => line.bg !== undefined)?.bg
  const first = lines.findIndex((line) => line.speaker !== READER_SPEAKER)
  if (first !== -1 && bg !== undefined && lines[first].bg === undefined) {
    lines[first] = { ...lines[first], bg }
  }
  return lines
}

/**
 * Holds the game being played, as a load of it would find it, beside what the loop held for it;
 * null, holding nothing, where there is no playthrough to hold.
 */
export function holdGame(inputDraft: string): HeldGame | null {
  const game = useGameStore.getState()
  const record = loopState.record
  const playthroughId = game.playthroughId
  if (!record || !playthroughId) return null
  // A landing with nothing yet on screen is held as an empty one, so the return opens no slot.
  const draft = manualSaveDraft() ?? { ...game.toGameSave(), scene: openingScene([]) }
  held = {
    save: { ...draft, playthroughId, saveId: AUTOSAVE_ID, saveDate: Date.now() },
    record,
    // The waiting transfers' too, which the return's load sets apart again.
    characters: { ...game.characters, ...game.pendingCharacters },
    decisionSave: loopState.decisionSave,
    slotSaveId: loopState.slotSaveId,
    examTextLedger: loopState.examTextLedger,
    examOpening: loopState.examOpening,
    inputDraft,
    stay: {
      chars: game.chars,
      playerFirstName: game.playerFirstName,
      playerLastName: game.playerLastName,
      playerPronouns: game.playerPronouns,
      romance: game.romance,
      charInfo: game.charInfo,
      charKeyToId: game.charKeyToId,
      weather: game.weather,
      calendar: game.calendar,
      semesterIndex: game.semesterIndex
    }
  }
  return held
}

/** The game held for the replay being read, left where it is; null when none is. */
export function heldGame(): HeldGame | null {
  return held
}

/** Takes the held game for its return; null when it has already been taken. */
export function takeHeldGame(): HeldGame | null {
  const game = held
  held = null
  return game
}

/**
 * What the replay's stay holds, off the held game: its slot is the replay's own, and each key
 * names whoever the scene meant by it, even where a rename has since given the name to another.
 */
export function replayStayOf(game: HeldGame, replay: SlotReplay): ReplayStayFields {
  return {
    ...game.stay,
    date: replay.date,
    time: replay.time,
    charKeyToId: { ...game.stay.charKeyToId, ...replay.keys }
  }
}

/**
 * The semesters before the one being played, oldest first, each with the history, replays,
 * timetable and plans its ending left; none in a playthrough's first semester.
 */
export function earlierSemesters(): ChainedSemester[] {
  const record = loopState.record
  if (!record) return []
  return semesterChain(record, useGameStore.getState().semesterId ?? undefined).slice(0, -1)
}

/** Refused for a replay with somebody in it whose character is gone. */
const REPLAY_CAST_GONE = {
  code: 'REPLAY_CAST_GONE',
  message: "Somebody in this replay is no longer in the game, so it can't be played."
}

/**
 * Reads the replay kept for one finished slot — of the semester being played, or of the earlier
 * one `semesterIndex` names; null, having said why, where it cannot be read or staged.
 */
export async function readReplay(
  date: number,
  time: TimeSlot,
  semesterIndex?: number
): Promise<SlotReplay | null> {
  const run = currentRun()
  const game = useGameStore.getState()
  const replays =
    semesterIndex === undefined
      ? game.replays
      : earlierSemesters().find(({ view }) => view.index === semesterIndex)?.log?.replays
  const id = replays?.[date]?.[time]
  if (!game.playthroughId || !id) return null
  const result = await window.api.replays.read(game.playthroughId, id)
  if (runStale(run)) return null
  if (!result.ok) {
    useUiStore.getState().showError(result.error)
    return null
  }
  // A graduate whose character was deleted since is loaded no more, and has no sprite to stand.
  if (result.data.cast.some((charId) => !game.characters[charId])) {
    useUiStore.getState().showError(REPLAY_CAST_GONE)
    return null
  }
  return result.data
}

/** The ids of every replay kept beside the game being played; none outside a playthrough. */
export async function keptReplayIds(): Promise<ReadonlySet<string>> {
  const playthroughId = useGameStore.getState().playthroughId
  if (!playthroughId) return new Set()
  const result = await window.api.replays.list(playthroughId)
  if (!result.ok) {
    useUiStore.getState().showError(result.error)
    return new Set()
  }
  return new Set(result.data)
}

/**
 * Deletes the replay kept for one finished slot, whatever saves still name it, and forgets it on
 * the game being played. False where the delete was refused, which says why.
 */
export async function deleteReplay(date: number, time: TimeSlot): Promise<boolean> {
  const run = currentRun()
  const game = useGameStore.getState()
  const id = game.replays[date]?.[time]
  if (!game.playthroughId || !id) return false
  const result = await window.api.replays.delete(game.playthroughId, id)
  if (!result.ok) {
    useUiStore.getState().showError(result.error)
    return false
  }
  if (!runStale(run)) useGameStore.getState().dropReplay(date, time)
  return true
}

/**
 * The replays the game being played will name on its next write, kept from a delete of another
 * of its playthrough's saves; nothing for any other playthrough.
 */
export function runningReplayIds(playthroughId: string): string[] | undefined {
  const game = useGameStore.getState()
  if (game.playthroughId !== playthroughId) return undefined
  return [...replayIdsOf(game.replays)]
}
