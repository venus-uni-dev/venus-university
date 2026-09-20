import {
  examIntroLine,
  QUIZ_CORRECT_LINE,
  QUIZ_IMPERFECT_LINE,
  QUIZ_NO_FAMILIAR_LINE,
  QUIZ_PERFECT_LINE,
  QUIZ_RECALL_LINE,
  QUIZ_SKIPPED_LINE,
  QUIZ_TIME_UP_LINE,
  QUIZ_WRONG_LINE,
  type ExamPeriod
} from '@shared/academics'
import type { ClassEntry, QuizQuestion, QuizState } from '@shared/types'
import { skippedFactMeetings } from '../../prompts/classProgress'
import { buildQuizPrompt, normalizeQuiz, pickQuizFacts, type QuizDraft } from '../../prompts/quizPrompt'
import { useGameStore } from '../gameStore'
import { revealSceneOpening } from '../slotCrossing'
import { advance, claimTextLedger, fetchEndingOpening } from './hooks'
import { writeAutosave } from './saves'
import { currentRun, loopState, runStale, type TurnSnapshot } from './state'
import { queueLines, unpark } from './stream'
import { failTurn } from './turn'

/** The exam. */

/** The lines that put one question on screen. Its answers are the row's buttons, not lines. */
function questionLines(quiz: QuizState): string[] {
  const question = quiz.questions[quiz.index]
  return question ? [QUIZ_RECALL_LINE, question.question] : []
}

/**
 * The ditched factoid meetings this paper charges for, off the same inputs
 * `freezeDueScores` reads at the boundary so the two cannot disagree.
 */
function skippedNow(code: string): number {
  const game = useGameStore.getState()
  const entry = game.classes[code]
  if (!entry) return 0
  return skippedFactMeetings(entry, game.date, game.classRecords[code], game.occasions)
}

/** Opens an exam in place of a scene. */
export async function startExam(
  entry: ClassEntry,
  exam: ExamPeriod,
  snapshot: TurnSnapshot
): Promise<void> {
  const run = currentRun()
  const game = useGameStore.getState()
  const facts = (game.classRecords[entry.code]?.meetings ?? [])
    .map((meeting) => meeting.factoid)
    .filter((factoid): factoid is string => Boolean(factoid))
  const picked = pickQuizFacts(facts)

  let questions: QuizQuestion[] = []
  if (picked.length > 0) {
    const result = await window.api.llm.generateQuiz<QuizDraft>(
      buildQuizPrompt(entry.name, picked)
    )
    // The paper belongs to a run the player has left.
    if (runStale(run)) return
    if (!result.ok) {
      // The ordinary turn failure.
      failTurn(result.error, snapshot)
      return
    }
    questions = normalizeQuiz(result.data, picked.length)
  }

  // The exam counts as attending the class: what `classOutcomeNow` reads, and what the score's
  // `present` test is written from at the boundary.
  useGameStore.getState().setCast([], { classCode: entry.code })
  // An opening, not a continuation: the exam starts here in place of a scene.
  useGameStore.getState().logPlayerAction(snapshot.action, false)
  const quiz: QuizState = { code: entry.code, exam, questions, index: 0, correct: 0 }
  useGameStore.getState().setSceneQuiz(quiz)
  // The slot's history entry, and `sceneInProgress()`'s marker.
  useGameStore
    .getState()
    .setSceneSummary(
      `The reader sat the ${exam === 'midterm' ? 'midterm' : 'final'} exam for ${entry.name}.`
    )

  // The exam's ending, fired as the paper lands so it runs under the questions: the
  // texting ledger, final once the composer closed above, and the opening off it.
  const textCall = claimTextLedger(game.date, game.time)
  loopState.examTextLedger = textCall
  loopState.examOpening = textCall.then((ledger) =>
    ledger === null ? null : fetchEndingOpening(ledger)
  )

  queueLines([
    // The one authored line naming a background: an exam is not a scene, so nothing else would.
    {
      speaker: '',
      bg: 'lecture_hall',
      text: examIntroLine(entry.name, exam, useGameStore.getState().time === 1)
    },
    // A paper with nothing he can answer says why.
    ...(questions.length > 0
      ? questionLines(quiz)
      : skippedNow(entry.code) > 0
        ? [QUIZ_NO_FAMILIAR_LINE]
        : [])
  ])

  // The reply is paid for; from here a crash costs the player only the clicks. It is also the
  // paper's decision point, so leaving or quitting mid-paper writes back this same start of it.
  const capture = useGameStore.getState().captureScene()
  loopState.decisionSave = capture
  await writeAutosave(capture)
  if (runStale(run)) return

  useGameStore.getState().setStreaming(false)
  useGameStore.getState().setBusy(false)
  // Lowered before either branch below: `advance()` is inert while it is up.
  useGameStore.getState().setWaitingForLine(false)

  // No questions: the paper is handed in on the same click that received it.
  if (questions.length === 0) finishExam()
  else advance()

  // The paper is on screen, which is what the cover raised on the reader's own turn was hiding
  // the arrival of: an exam is the one way a turn opens a screen that is not a scene.
  revealSceneOpening()
}

/**
 * Banks one answer and puts the next question up, or hands the paper in.
 * The Game View's A/B/C/D buttons are the only caller.
 */
export function submitQuizAnswer(letter: 'A' | 'B' | 'C' | 'D'): void {
  const game = useGameStore.getState()
  const quiz = game.sceneQuiz
  if (!quiz || game.busy || !game.awaitingInput) return
  const question = quiz.questions[quiz.index]
  if (!question) return

  game.setAwaitingInput(false)
  const right = question.correct === letter
  game.answerQuiz(right)

  const next = useGameStore.getState().sceneQuiz
  const more = next !== null && next.index < next.questions.length
  queueLines([right ? QUIZ_CORRECT_LINE : QUIZ_WRONG_LINE, ...(more && next ? questionLines(next) : [])])

  if (!more) {
    finishExam()
    return
  }
  advance()
}

/** Hands the paper in and ends the slot. */
function finishExam(): void {
  const quiz = useGameStore.getState().sceneQuiz
  if (!quiz) return

  const skipped = skippedNow(quiz.code)
  queueLines([
    // After the questions, before time is called: the charge for ditched lectures.
    ...(skipped > 0 && quiz.questions.length > 0 ? [QUIZ_SKIPPED_LINE] : []),
    QUIZ_TIME_UP_LINE,
    // Neither a blank paper nor one charged for skipped classes is perfect, whatever he answered.
    quiz.questions.length > 0 && quiz.correct === quiz.questions.length && skipped === 0
      ? QUIZ_PERFECT_LINE
      : QUIZ_IMPERFECT_LINE
  ])

  loopState.pendingEnd = true
  loopState.endingInFlight = true
  loopState.endingAbandoned = false
  loopState.endBase = null
  loopState.endLines = null
  void runExamEnding()
  advance()
}

/** The exam's ending: the texting ledger, the next slot's opening, one write. */
async function runExamEnding(): Promise<void> {
  const run = currentRun()
  const game = useGameStore.getState()
  // Both usually in flight since the questions landed; the direct calls below are the
  // backstop for a resume that did not re-fire them, and read the same slot.
  const prefetchedLedger = loopState.examTextLedger
  loopState.examTextLedger = null
  const prefetchedOpening = loopState.examOpening
  loopState.examOpening = null

  const ledger = await (prefetchedLedger ?? claimTextLedger(game.date, game.time))
  // Abandoned: nothing is written, exactly as an ordinary ending abandons.
  if (ledger === null) return
  if (runStale(run)) return
  // What the status lines and the boundary bank: text memories and milestones
  // file on an exam slot as on any other, and the rest reads nothing an exam lacks.
  loopState.pendingLedgerResult = ledger

  const opening = await (prefetchedOpening ?? fetchEndingOpening(ledger))
  if (!opening) return
  if (runStale(run)) return

  loopState.bankedOpening = opening
  // Off the live capture, not `queuedScene`, which replaces the queue wholesale: what is still
  // unread is already in the capture, and is what a resume replays.
  const scene = useGameStore.getState().captureScene()
  await writeAutosave(scene ? { ...scene, endPending: true, ledger, opening } : null)
  if (runStale(run)) return
  loopState.endingInFlight = false
  unpark()
}
