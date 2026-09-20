import { describe, expect, it, vi } from 'vitest'
import { QUIZ_LETTERS } from '@shared/academics'
import { normalizeQuiz, type QuizDraft } from '../src/renderer/prompts/quizPrompt'

/**
 * The exam reply's hardening, and the shuffle the grade depends on: the app deals the letters
 * itself, and a paper whose `correct` no longer points at the option the model marked scores
 * the reader on the wrong thing — a score frozen write-once.
 */

/** One question whose options are distinguishable, so a shuffle is readable. */
function draft(correct: string): QuizDraft {
  return {
    questions: [{ question: 'Q?', a: 'alpha', b: 'beta', c: 'gamma', d: 'delta', correct }]
  }
}

/** The option `correct` points at, however the four ended up ordered. */
function answerOf(q: { a: string; b: string; c: string; d: string; correct: string }): string {
  return [q.a, q.b, q.c, q.d][QUIZ_LETTERS.indexOf(q.correct as 'A')]
}

describe('normalizeQuiz — the shuffle', () => {
  it('keeps the four options and keeps the answer pointing at the same one', () => {
    for (const letter of QUIZ_LETTERS) {
      const marked = { A: 'alpha', B: 'beta', C: 'gamma', D: 'delta' }[letter]
      for (let attempt = 0; attempt < 25; attempt++) {
        const [question] = normalizeQuiz(draft(letter), 3)
        expect([question.a, question.b, question.c, question.d].sort()).toEqual([
          'alpha',
          'beta',
          'delta',
          'gamma'
        ])
        expect(answerOf(question)).toBe(marked)
      }
    }
  })

  // A letter outside A-D would index to -1 and store an undefined `correct`.
  it('marks the option a junk `correct` was meant to name', () => {
    const [question] = normalizeQuiz(draft('E'), 3)
    expect(answerOf(question)).toBe('alpha')
  })
})

describe('normalizeQuiz — hardening', () => {
  it('drops a question with a blank field rather than showing an empty option', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const blank: QuizDraft = {
      questions: [{ question: 'Q?', a: 'alpha', b: '', c: 'gamma', d: 'delta', correct: 'A' }]
    }
    expect(normalizeQuiz(blank, 3)).toEqual([])
    vi.restoreAllMocks()
  })

  it('never returns more questions than the paper was drawn for', () => {
    const many: QuizDraft = {
      questions: Array.from({ length: 5 }, () => draft('A').questions[0])
    }
    expect(normalizeQuiz(many, 2)).toHaveLength(2)
  })
})
