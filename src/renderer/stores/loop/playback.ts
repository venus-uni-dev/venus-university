import type { GameOverReason } from '@shared/gameOver'
import { READER_SPEAKER, type QuizState, type SceneLine, type TimeSlot } from '@shared/types'
import { isOrientationSlot } from '../../prompts/introScript'
import { lastReaderIndexOf, rewindTargetOf } from '../stageStep'
import { sceneOnScreenOf } from '../textingLoop'
import type { StatusModal } from './statusSteps'

/**
 * When the player may take playback into his own hands mid-reply — interject over the lines he
 * has not read, step back a line or read forward again — asked of one slice of the game store,
 * so the view's controls and the loop's guards read the same answer.
 */

/** The game store fields the playback controls are decided on. */
export interface PlaybackSlice {
  currentSceneTranscript: readonly SceneLine[]
  pendingLines: readonly SceneLine[]
  sceneLog: readonly SceneLine[]
  cast: readonly string[]
  sceneClass: string | null
  sceneQuiz: QuizState | null
  sceneEnding: boolean
  statusShown: boolean
  statusModal: StatusModal | null
  streaming: boolean
  awaitingInput: boolean
  busy: boolean
  activeGameOver: GameOverReason | null
  date: number
  time: TimeSlot
  sceneSummary: string | null
  reread: number
}

/** Whether a line is the reader's own action. */
function isReaderLine(line: SceneLine): boolean {
  return line.speaker === READER_SPEAKER
}

/**
 * The transcript up to the line on screen: everything the queue does not still hold, and nothing
 * when the queue holds more than the transcript, as an exam's and the orientation's can.
 */
function readPrefixOf(s: PlaybackSlice): readonly SceneLine[] {
  const transcript = s.currentSceneTranscript
  return transcript.slice(0, Math.max(0, transcript.length - s.pendingLines.length))
}

/** How many lines of the reply on screen playback has reached. */
export function replyReach(s: PlaybackSlice): number {
  const read = readPrefixOf(s)
  return read.length - (lastReaderIndexOf(read) + 1)
}

/**
 * Whether either control may be offered at all: a cast scene has spoken on screen, and no exam,
 * status sequence, game over or orientation opening owns the stage.
 */
export function playbackOffered(s: PlaybackSlice): boolean {
  return (
    sceneOnScreenOf(s) &&
    !s.statusShown &&
    s.statusModal === null &&
    s.sceneQuiz === null &&
    s.activeGameOver === null &&
    s.cast.length > 0 &&
    !(isOrientationSlot(s.date, s.time) && !s.currentSceneTranscript.some(isReaderLine))
  )
}

/**
 * Whether stepping back a line is open: a line of the reply on screen has been reached, and the
 * scene has an earlier line that says something. Closed while a turn is in flight before its
 * reply's first line shows, and at a decision point after a reply with no lines.
 */
export function rewindOpenOf(s: PlaybackSlice): boolean {
  return playbackOffered(s) && replyReach(s) >= 1 && rewindTargetOf(s.sceneLog) !== -1
}

/** Whether reading forward again is open: a rewind has left beats ahead that were already read. */
export function forwardOpenOf(s: PlaybackSlice): boolean {
  return playbackOffered(s) && s.reread > 0
}

/** Whether interjecting is offered, and if so whether the scene lets it through. */
export type InterjectOffer = 'none' | 'open' | 'locked'

/**
 * Whether the scene lets the reader through: locked in a class scene while the line on screen
 * is no later than the reply to the action that opened it.
 */
function lockOf(s: PlaybackSlice): 'locked' | 'open' {
  const acted = readPrefixOf(s).filter(isReaderLine).length
  return s.sceneClass !== null && acted <= 1 ? 'locked' : 'open'
}

/**
 * The interjection on offer: none unless there is something to interrupt — lines unread, a reply
 * still arriving, or an ending under way — and otherwise as the scene's lock has it.
 */
export function interjectOfferOf(s: PlaybackSlice): InterjectOffer {
  if (!playbackOffered(s)) return 'none'
  const tail = s.currentSceneTranscript[s.currentSceneTranscript.length - 1]
  const interruptible =
    s.pendingLines.length > 0 ||
    s.sceneEnding ||
    (s.streaming && tail !== undefined && !isReaderLine(tail))
  if (!interruptible) return 'none'
  return lockOf(s)
}

/**
 * The row's offer while a reply is on screen: the interjection's, extended over a resolved
 * reply's last line until that line is turned — so the row stands over the whole reply and hands
 * over to the turn's own well only on the click past it.
 */
export function replyRowOfferOf(s: PlaybackSlice): InterjectOffer {
  const offer = interjectOfferOf(s)
  if (offer !== 'none') return offer
  const lastLineUnturned =
    playbackOffered(s) &&
    !s.awaitingInput &&
    !s.busy &&
    !s.streaming &&
    s.pendingLines.length === 0 &&
    replyReach(s) >= 1
  return lastLineUnturned ? lockOf(s) : 'none'
}
