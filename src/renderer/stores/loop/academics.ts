import {
  acePerfectHeart,
  checkedGradeLine,
  ditchedAceLine,
  ditchedFlunkLine,
  EXAM_PERIODS,
  examScore,
  FAIL_SCORE,
  failedExamLine,
  FINALS_DONE_LINE,
  FINALS_POSTED_LINE,
  gradesStandingOf,
  gradedCourses,
  allScoresOf,
  isCourse,
  kindOf,
  PERFECT_SCORE,
  perfectScoreLine,
  projectScore,
  scoreLine,
  showcaseCharmLine,
  type ExamPeriod
} from '@shared/academics'
import { tierOf, type StatContext, type StatusText } from '@shared/playerStats'
import type { ClassEntry, CourseEntry, LedgerResponse } from '@shared/types'
import {
  examDateOf,
  examOn,
  handbackDateOf,
  projectPeriodOf,
  skippedFactMeetings,
  workedOn
} from '../../prompts/classProgress'
import { FINALS_WEEK } from '../../prompts/occasions'
import { useGameStore } from '../gameStore'
import { playerClassNow } from '../timetable'
import { loopState } from './state'

/**
 * Everything the reader's classes do to him and he to them: what a slot
 * spent in class is worth, when a score is frozen, and the two grade
 * notifications the slot opening carries.
 */

/**
 * Whether the player kept their own timetable this slot, and which stat pays for it.
 */
export function classOutcomeNow(): StatContext['classOutcome'] {
  const enrolled = playerClassNow()
  if (!enrolled) return null

  const game = useGameStore.getState()
  const entry = game.classes[enrolled]
  const attended = game.sceneClass === enrolled

  if (entry && examOn(entry, game.date, game.occasions) !== null) {
    return kindOf(entry) === 'project' && attended
      ? { stat: 'heart', attended, showcase: true }
      : null
  }

  const stat = entry?.category === 'pe' ? 'body' : 'brain'
  return { stat, attended }
}

/**
 * What a midterm result does to the reader's Heart, and the lines that say so. Null
 * unless his midterm came back this slot.
 */
export function gradeOutcomeNow(): StatContext['gradeOutcome'] {
  const game = useGameStore.getState()
  const code = playerClassNow()
  if (!code) return null
  const entry = game.classes[code]
  if (!entry || !isCourse(entry)) return null
  if (handbackDateOf(entry, game.occasions) !== game.date) return null

  const record = game.classRecords[code]
  const score = record?.midtermScore
  if (typeof score !== 'number') return null

  const difficulty = entry.difficulty
  const attended = game.sceneClass === code

  // What his charm bought at the showcase, in the tier it was frozen at. Always the last line:
  // it explains the grade the sentence before it reports. Carries no polarity of its own.
  const charm = record?.midtermHeartTier ? showcaseCharmLine(record.midtermHeartTier) : null
  const withCharm = (lines: StatusText[]): StatusText[] =>
    charm ? [...lines, { text: charm }] : lines

  if (attended) {
    if (score >= PERFECT_SCORE) {
      return {
        heart: acePerfectHeart(difficulty),
        lines: withCharm([{ text: perfectScoreLine(difficulty), polarity: 'positive' }])
      }
    }
    if (score < FAIL_SCORE) {
      return {
        heart: 0,
        lines: withCharm([{ text: failedExamLine(entry.name), polarity: 'negative' }])
      }
    }
    // A middling score handed to him in the room was already in the scene he read; only the
    // charm note, which that scene could not say, travels.
    return charm ? { heart: 0, lines: [{ text: charm }] } : null
  }

  const checked: StatusText = { text: checkedGradeLine(entry.name, score) }
  if (score >= PERFECT_SCORE) {
    return {
      heart: acePerfectHeart(difficulty),
      lines: withCharm([checked, { text: ditchedAceLine(difficulty), polarity: 'positive' }])
    }
  }
  if (score < FAIL_SCORE) {
    return {
      heart: 0,
      lines: withCharm([checked, { text: ditchedFlunkLine(), polarity: 'negative' }])
    }
  }
  return { heart: 0, lines: withCharm([checked]) }
}

/** Freezes every assessment whose slot has passed and has no score yet. */
function freezeDueScores(): void {
  const game = useGameStore.getState()
  for (const code of new Set(Object.values(game.playerSchedule))) {
    const entry = game.classes[code]
    if (!entry || !isCourse(entry)) continue

    for (const exam of EXAM_PERIODS) {
      const examDate = examDateOf(entry, exam, game.occasions)
      if (examDate === null || examDate > game.date) continue
      // Due once the exam's slot has finished, not its date: the boundary runs before the clock
      // moves, so a night class is still sitting its paper at the end of the day slot.
      if (examDate === game.date && entry.slot % 2 > game.time) continue

      const state = useGameStore.getState()
      const record = state.classRecords[code]
      if (typeof (exam === 'midterm' ? record?.midtermScore : record?.finalScore) === 'number') {
        continue
      }

      // Sat only if that meeting is on the record as attended; one spent elsewhere scores nothing.
      const present = record?.meetings.some((m) => m.date === examDate && m.attended) === true
      const difficulty = entry.difficulty

      if (entry.kind === 'lecture') {
        state.setClassScore(
          code,
          exam,
          examScore({
            present,
            correct: record?.[exam]?.correct ?? 0,
            asked: record?.[exam]?.asked ?? 0,
            skipped: skippedFactMeetings(entry, examDate, record, state.occasions),
            brain: state.stats.brain,
            difficulty,
            exam
          })
        )
        continue
      }

      const showcase = {
        present,
        worked: workedOn(record, exam),
        needed: projectPeriodOf(entry, examDate, state.occasions)?.needed ?? 1,
        brain: state.stats.brain,
        heart: state.stats.heart,
        difficulty,
        exam
      }
      const score = projectScore(showcase)
      // The tier is frozen with the score, and only where charm moved it — re-scored with no
      // Heart, which also stays quiet when the cap at 100 swallowed the bonus.
      const improved = score > projectScore({ ...showcase, heart: 0 })
      state.setClassScore(code, exam, score, improved ? tierOf(state.stats.heart) : undefined)
    }
  }
}

/** The reader's own non-PE classes, which are the ones that grade him. */
function gradedClasses(): CourseEntry[] {
  const game = useGameStore.getState()
  return gradedCourses(game.playerSchedule, game.classes)
}

/** What the two grade notifications leave for the slot opening to carry. */
export interface GradeNotices {
  /** The Saturday midterm standing, ahead of the narration. */
  standing: string[]
  /** The finals scroll, which lands just above the action prompt instead. */
  finals: string[]
}

/** The two grade notifications, checked at every slot opening. */
export function settleGrades(): GradeNotices {
  const game = useGameStore.getState()
  const notices: GradeNotices = { standing: [], finals: [] }
  const classes = gradedClasses()
  if (classes.length === 0) return notices

  const scoreOf = (entry: ClassEntry, exam: ExamPeriod): number | undefined =>
    exam === 'midterm'
      ? game.classRecords[entry.code]?.midtermScore
      : game.classRecords[entry.code]?.finalScore

  // The Monday after finals week, not "every final is scored": a score is frozen the moment
  // the paper is handed in, days before anybody could have marked it.
  const finalsMonday = game.date > FINALS_WEEK.endDate && game.date % 7 === 0
  if (finalsMonday && !game.finalsScoresShown) {
    useGameStore.getState().setFinalsScoresShown()
    const scored: string[] = []
    for (const entry of classes) {
      const score = scoreOf(entry, 'final')
      if (typeof score !== 'number') continue
      scored.push(scoreLine(entry.name, 'final', score))
      const tier = game.classRecords[entry.code]?.finalHeartTier
      const charm = tier ? showcaseCharmLine(tier) : null
      if (charm) scored.push(charm)
    }
    if (scored.length > 0) notices.finals = [FINALS_POSTED_LINE, ...scored, FINALS_DONE_LINE]
    // Over every assessment of the year, so the midterm standing can be overturned either way.
    const standing = gradesStandingOf(allScoresOf(useGameStore.getState().classRecords))
    useGameStore.getState().setGradesStanding(standing)
    return notices
  }

  // Received, not sat: nobody knows his grades until the papers come back.
  const midtermsIn = classes.every(
    (entry) =>
      typeof scoreOf(entry, 'midterm') === 'number' &&
      (handbackDateOf(entry, game.occasions) ?? Infinity) <= game.date
  )
  const saturday = game.date % 7 === 5
  if (midtermsIn && saturday && !game.midtermStandingDone) {
    useGameStore.getState().setMidtermStandingDone()
    const scores = classes.map((entry) => scoreOf(entry, 'midterm') as number)
    const standing = gradesStandingOf(scores)
    useGameStore.getState().setGradesStanding(standing)
    if (standing === 'good') {
      notices.standing.push('Word got around that you aced every one of your midterms.')
    } else if (standing === 'bad') {
      notices.standing.push(
        'You happened to check your grades and wow... you failed every single one of your midterms.'
      )
    }
  }

  return notices
}

/**
 * Everything the finished slot changed about the reader's classes, filed at the boundary in
 * one place.
 */
export function recordAcademics(ledger: LedgerResponse | null): void {
  const game = useGameStore.getState()
  const date = game.date

  const quiz = game.sceneQuiz
  if (quiz) {
    game.recordExam(quiz.code, quiz.exam, {
      asked: quiz.questions.length,
      correct: quiz.correct
    })
    game.recordClassMeeting(quiz.code, {
      date,
      attended: true,
      summary: `The reader sat the ${quiz.exam === 'midterm' ? 'midterm' : 'final'} exam.`
    })
  } else if (game.sceneClass) {
    const summary = ledger?.classSummary?.trim()
    const factoid = ledger?.classFactoid?.trim()
    game.recordClassMeeting(game.sceneClass, {
      date,
      attended: true,
      ...(summary ? { summary } : {}),
      ...(factoid ? { factoid } : {})
    })
  }

  // The class he was enrolled in and skipped, recorded so the next meeting's recap can say so.
  const enrolled = playerClassNow()
  if (enrolled && enrolled !== game.sceneClass) {
    useGameStore.getState().recordClassMeeting(enrolled, { date, attended: false })
  }

  // A work session records the scene's own summary, still on the store here because the
  // boundary clears it only after the history entry.
  if (loopState.projectWork) {
    const summary = useGameStore.getState().sceneSummary?.trim()
    useGameStore
      .getState()
      .recordProjectWork(
        loopState.projectWork.code,
        loopState.projectWork.exam,
        date,
        game.time,
        summary || undefined
      )
  }

  // After the meeting records above: whether he sat the exam is read back off them.
  freezeDueScores()
}
