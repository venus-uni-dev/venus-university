import { describe, expect, it } from 'vitest'
import { geminiAdapter } from '../src/shared/llm/geminiAdapter'

/**
 * Gemini's 429 covers two different failures: a plan's request-rate limit, which a
 * resend can outlast, and an empty prepayment balance, which it cannot. `errorFor`
 * has to tell them apart from the envelope's message, not just the status code.
 */
describe('geminiAdapter.errorFor 429 classification', () => {
  it('gives a depleted prepayment balance its own code and Google\'s own message', () => {
    const message =
      'Your prepayment credits are depleted. Please go to AI Studio at https://ai.studio/projects to manage your project and billing. Learn more at https://ai.google.dev/gemini-api/docs/billing#prepay.'
    const error = geminiAdapter.errorFor({
      status: 429,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 429, message, status: 'RESOURCE_EXHAUSTED' } }),
      label: 'Google (Gemini)'
    })

    expect(error.code).toBe('LLM_CREDITS_DEPLETED')
    expect(error.message).toBe(message)
    expect(error.detail?.startsWith('RESOURCE_EXHAUSTED')).toBe(true)
  })

  it('leaves an ordinary rate limit as LLM_RATE_LIMITED', () => {
    const message = 'You exceeded your current quota, please check your plan and billing details. Please retry in 32.5s.'
    const error = geminiAdapter.errorFor({
      status: 429,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 429, message, status: 'RESOURCE_EXHAUSTED' } }),
      label: 'Google (Gemini)'
    })

    expect(error.code).toBe('LLM_RATE_LIMITED')
  })
})
