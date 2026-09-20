import { beforeEach, describe, expect, it } from 'vitest'
import type { ClassEntry, QuizQuestion } from '@shared/types'
import { recordAcademics } from '../src/renderer/stores/loop/academics'
import { loopState, resetLoopState } from '../src/renderer/stores/loop/state'
import { useGameStore } from '../src/renderer/stores/gameStore'
import { classEntry } from './fixtures'

/**
 * The boundary's academic filing, and above all *when* a score freezes: write-once, so a score
 * taken before the paper was sat is a flat zero that survives every later autosave. The
 * boundary runs before the clock moves, making a night class's exam day slot the trap.
 */

/** Monday Night and Tuesday Night — the two slots whose midterms are sat after dark. */
const MON_NIGHT = 1
const TUE_NIGHT = 3

/** The midterm meeting each of those slots holds (`examMeetingDateOf`). */
const MON_EXAM_DATE = 42
const TUE_EXAM_DATE = 43

/** One enrolled class, and the reader standing at a boundary inside its exam week. */
function enroll(entry: ClassEntry, at: { date: number; time: 0 | 1 }): void {
  useGameStore.setState({
    classes: { [entry.code]: entry },
    playerSchedule: { [entry.slot]: entry.code },
    classRecords: {},
    date: at.date,
    time: at.time,
    stats: { brain: 100, body: 0, heart: 0 }
  })
}

/** A paper of `asked` questions with every one of them answered right. */
function acedQuiz(code: string, asked: number) {
  const question: QuizQuestion = {
    question: 'Q',
    a: 'a',
    b: 'b',
    c: 'c',
    d: 'd',
    correct: 'A'
  }
  return {
    code,
    exam: 'midterm' as const,
    questions: Array.from({ length: asked }, () => ({ ...question })),
    index: asked,
    correct: asked
  }
}

function scoreOf(code: string): number | undefined {
  return useGameStore.getState().classRecords[code]?.midtermScore
}

beforeEach(() => {
  useGameStore.getState().reset()
  resetLoopState()
})

describe('recordAcademics — when a score freezes', () => {
  it('leaves a night class alone at the day slot of its own exam date', () => {
    const entry = classEntry({ slot: MON_NIGHT, difficulty: 'easy' })
    enroll(entry, { date: MON_EXAM_DATE, time: 0 })

    recordAcademics(null)

    // The paper is tonight. Freezing here would score the flat "not present"
    // zero and write-once would keep it forever.
    expect(scoreOf(entry.code)).toBeUndefined()
  })

  it('freezes the night class at the boundary of the slot it sat the paper in', () => {
    const entry = classEntry({ slot: MON_NIGHT, difficulty: 'easy' })
    enroll(entry, { date: MON_EXAM_DATE, time: 1 })
    useGameStore.setState({ sceneQuiz: acedQuiz(entry.code, 3) })

    recordAcademics(null)

    // Brain over an easy midterm's tier, and a perfect paper: both halves.
    expect(scoreOf(entry.code)).toBe(100)
  })

  it('still zeroes an exam the reader never sat, at the next boundary past it', () => {
    const entry = classEntry({ slot: MON_NIGHT, difficulty: 'easy' })
    enroll(entry, { date: MON_EXAM_DATE + 1, time: 0 })

    recordAcademics(null)

    expect(scoreOf(entry.code)).toBe(0)
  })

  it('leaves a night showcase alone at the day slot, then scores the work that night', () => {
    const entry = classEntry({
      code: 'CRW 101',
      slot: TUE_NIGHT,
      kind: 'project',
      difficulty: 'hard'
    })
    enroll(entry, { date: TUE_EXAM_DATE, time: 0 })
    // Seven sessions, which is what a hard project asks for by this showcase.
    useGameStore.setState({
      classRecords: {
        [entry.code]: {
          meetings: [],
          midtermProject: {
            sessions: Array.from({ length: 7 }, (_, i) => ({ date: i + 2, time: 0 as const }))
          }
        }
      }
    })

    recordAcademics(null)
    expect(scoreOf(entry.code)).toBeUndefined()

    useGameStore.setState({ time: 1, sceneClass: entry.code })
    recordAcademics(null)

    expect(scoreOf(entry.code)).toBe(100)
  })
})

describe('recordAcademics — what the boundary files', () => {
  it('files the exam tally and the meeting that proves he sat it', () => {
    const entry = classEntry({ slot: MON_NIGHT, difficulty: 'easy' })
    enroll(entry, { date: MON_EXAM_DATE, time: 1 })
    useGameStore.setState({ sceneQuiz: acedQuiz(entry.code, 3) })

    recordAcademics(null)

    const record = useGameStore.getState().classRecords[entry.code]
    expect(record.midterm).toEqual({ asked: 3, correct: 3 })
    expect(record.meetings).toEqual([
      { date: MON_EXAM_DATE, attended: true, summary: 'The reader sat the midterm exam.' }
    ])
  })

  it('credits a project session to the slot it was spent in', () => {
    const entry = classEntry({ code: 'CRW 101', slot: TUE_NIGHT, kind: 'project' })
    enroll(entry, { date: 10, time: 1 })
    useGameStore.setState({ sceneSummary: 'He wrote a chapter.' })
    loopState.projectWork = { code: entry.code, exam: 'midterm' }

    recordAcademics(null)
    recordAcademics(null)

    expect(useGameStore.getState().classRecords[entry.code].midtermProject?.sessions).toEqual([
      { date: 10, time: 1, summary: 'He wrote a chapter.' }
    ])
  })
})
