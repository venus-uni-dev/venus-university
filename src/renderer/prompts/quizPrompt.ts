import { QUIZ_LETTERS } from '@shared/academics'
import type { QuizQuestion, StructuredRequest } from '@shared/types'
import { shuffle } from '@shared/shuffle'
import { objectSchema } from './schema'

/** The exam-question call; pure, no IO. */

/** The most questions one exam asks. */
const MAX_QUIZ_QUESTIONS = 3

/** Draws the facts this exam will be built from: up to three, at random. */
export function pickQuizFacts(facts: readonly string[]): string[] {
  return shuffle(facts).slice(0, MAX_QUIZ_QUESTIONS)
}

/** The reply shape. Normalized by {@link normalizeQuiz} before it reaches the player. */
export interface QuizDraft {
  questions: Array<{
    question: string
    a: string
    b: string
    c: string
    d: string
    correct: string
  }>
}

/** Builds the request for one exam. */
export function buildQuizPrompt(className: string, facts: readonly string[]): StructuredRequest {
  const system = [
    'You write multiple-choice exam questions for a university course.',
    'You return a single JSON object matching the provided schema exactly.',
    'Each question tests one fact. Exactly one option is correct.',
    'The three wrong options must seem plausible.',
    'Options are the answer itself, not "A) ..." — the letters are added elsewhere.',
    'Questions are one sentence and never refer to "the reading" or "the slides".'
  ].join('\n')

  const user = [
    `Write one exam question for each fact below, from ${className}.`,
    'Set "correct" to the letter of the option that is right.',
    '',
    'FACTS',
    ...facts.map((fact, index) => `${index + 1}. ${fact}`)
  ].join('\n')

  const option = { type: 'string' }
  return {
    system,
    user,
    schema: objectSchema('exam_quiz', ['questions'], {
      questions: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['question', 'a', 'b', 'c', 'd', 'correct'],
          properties: {
            question: { type: 'string' },
            a: option,
            b: option,
            c: option,
            d: option,
            // An enum, on the classifier's precedent.
            correct: { type: 'string', enum: ['A', 'B', 'C', 'D'] }
          }
        }
      }
    }),
    cacheKey: 'quiz',
    kind: 'examQuiz'
  }
}

/** Hardens a reply into questions the player can be shown. */
export function normalizeQuiz(draft: QuizDraft | undefined, max: number): QuizQuestion[] {
  const raw = Array.isArray(draft?.questions) ? draft.questions : []
  const questions: QuizQuestion[] = []

  for (const entry of raw) {
    if (questions.length >= max) break
    const question = (entry?.question ?? '').trim()
    const options = [entry?.a, entry?.b, entry?.c, entry?.d].map((v) => (v ?? '').trim())
    if (!question || options.some((option) => !option)) {
      console.warn('[quiz] dropping a question with a blank field.')
      continue
    }
    const letter = (entry?.correct ?? '').trim().toUpperCase()
    const right = Math.max(QUIZ_LETTERS.indexOf(letter as QuizQuestion['correct']), 0)
    // Carried on the option: two options with the same text would otherwise mark the wrong one.
    const dealt = shuffle(options.map((text, index) => ({ text, right: index === right })))
    const [a, b, c, d] = dealt.map((option) => option.text)
    questions.push({
      question,
      a,
      b,
      c,
      d,
      correct: QUIZ_LETTERS[dealt.findIndex((option) => option.right)]
    })
  }

  return questions
}
