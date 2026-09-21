import { describe, expect, it } from 'vitest'
import { isAppError } from '@shared/errors'
import type { AppError } from '@shared/types'
import { readStream } from '../src/shared/llm/cloudLlm'
import { modelIdsOf, openaiAdapter } from '../src/shared/llm/openaiAdapter'

/**
 * A custom endpoint is whatever the player typed a URL for, so every reply it can give —
 * a status, a mid-stream error frame, a finish reason, a refusal — has to land on the right
 * code: one the queue retries, one the player can act on, or neither.
 */

const LABEL = 'Custom endpoint'

/** A response whose body streams `chunks` as written. */
function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder()
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
        controller.close()
      }
    })
  )
}

/** One `data:`-framed SSE event, blank line and all. */
function frame(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`
}

/** One streamed chunk carrying `text`, optionally terminal. */
function deltaFrame(text: string, finishReason?: string): string {
  return frame({
    choices: [{ delta: { content: text }, finish_reason: finishReason ?? null }]
  })
}

/** Drains `chunks` through the custom-endpoint adapter. */
function read(chunks: string[]): Promise<Awaited<ReturnType<typeof readStream>>> {
  return readStream(sseResponse(chunks), openaiAdapter, LABEL, () => {})
}

/** The `AppError` a promise rejected with; fails the test if it resolved. */
async function errorOf(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise
  } catch (err) {
    if (isAppError(err)) return err
    throw err
  }
  throw new Error('expected a failure, but the call resolved')
}

/** The `AppError` a synchronous call threw; fails the test if it returned. */
function throwOf(call: () => unknown): AppError {
  try {
    call()
  } catch (err) {
    if (isAppError(err)) return err
    throw err
  }
  throw new Error('expected a failure, but the call returned')
}

/** One JSON error body, as the endpoints all shape it. */
function errorBody(error: Record<string, unknown>): string {
  return JSON.stringify({ error })
}

describe('openaiAdapter.errorFor', () => {
  it('names the key on a 401 and keeps it permanent', () => {
    const error = openaiAdapter.errorFor({
      status: 401,
      contentType: 'application/json',
      body: errorBody({ code: 401, message: 'No auth credentials found' }),
      label: LABEL
    })

    expect(error.code).toBe('LLM_REQUEST_REJECTED')
    expect(error.message).toContain('API key')
  })

  it('gives an empty balance its own code and the endpoint\'s own message', () => {
    const message = 'Insufficient credits. Add more at https://example.test/credits.'
    const error = openaiAdapter.errorFor({
      status: 402,
      contentType: 'application/json',
      body: errorBody({ code: 402, message }),
      label: LABEL
    })

    expect(error.code).toBe('LLM_CREDITS_DEPLETED')
    expect(error.message).toBe(message)
  })

  it('reads a 403 carrying moderation reasons as a content block', () => {
    const error = openaiAdapter.errorFor({
      status: 403,
      contentType: 'application/json',
      body: errorBody({
        code: 403,
        message: 'Input flagged',
        metadata: { reasons: ['sexual/minors'] }
      }),
      label: LABEL
    })

    expect(error.code).toBe('LLM_BLOCKED')
  })

  it('leaves a 403 with no reasons on the key', () => {
    const error = openaiAdapter.errorFor({
      status: 403,
      contentType: 'application/json',
      body: errorBody({ code: 403, message: 'Forbidden' }),
      label: LABEL
    })

    expect(error.code).toBe('LLM_REQUEST_REJECTED')
  })

  it('sends a 404 back to the endpoint URL rather than the request', () => {
    const error = openaiAdapter.errorFor({
      status: 404,
      contentType: 'application/json',
      body: errorBody({ code: 404, message: 'Not found' }),
      label: LABEL
    })

    expect(error.code).toBe('LLM_REQUEST_REJECTED')
    expect(error.message).toContain('endpoint URL')
  })

  it('keeps a 429 and a 503 retryable', () => {
    const rateLimited = openaiAdapter.errorFor({
      status: 429,
      contentType: 'application/json',
      body: errorBody({ code: 429, message: 'Rate limit exceeded' }),
      label: LABEL
    })
    const overloaded = openaiAdapter.errorFor({
      status: 503,
      contentType: 'application/json',
      body: errorBody({ code: 503, message: 'No instances available' }),
      label: LABEL
    })

    expect(rateLimited.code).toBe('LLM_RATE_LIMITED')
    expect(overloaded.code).toBe('LLM_OVERLOADED')
  })

  it('reduces an HTML error page to its gist', () => {
    // A base URL naming a web page rather than an API root answers HTML.
    const error = openaiAdapter.errorFor({
      status: 404,
      contentType: 'text/html; charset=utf-8',
      body: '<html><head><title>404 Not Found</title></head><body><h1>nginx</h1></body></html>',
      label: LABEL
    })

    expect(error.code).toBe('LLM_HTTP')
    expect(error.detail).toBe('404 Not Found')
  })
})

describe('openaiAdapter stream frames', () => {
  it('concatenates the deltas and ends on the sentinel', async () => {
    const result = await read([
      deltaFrame('{"lines":'),
      deltaFrame('["she waves"]}'),
      'data: [DONE]\n\n'
    ])

    expect(result.content).toBe('{"lines":["she waves"]}')
    expect(result.finished).toBe(true)
    expect(result.skipped).toBe(0)
  })

  it('classifies an error envelope that arrived over a 200 stream', async () => {
    const error = await errorOf(
      read([deltaFrame('half a '), frame({ error: { code: 429, message: 'Rate limit exceeded' } })])
    )

    expect(error.code).toBe('LLM_RATE_LIMITED')
  })

  it('reports a reply that ran out of room', async () => {
    const error = await errorOf(read([deltaFrame('and then', 'length')]))

    expect(error.code).toBe('LLM_TRUNCATED')
  })

  it('reports a reply the endpoint filtered', async () => {
    const error = await errorOf(read([deltaFrame('', 'content_filter')]))

    expect(error.code).toBe('LLM_BLOCKED')
  })

  it('passes over the usage chunk that carries no choice', async () => {
    const result = await read([
      deltaFrame('done'),
      frame({ choices: [], usage: { total_tokens: 12, prompt_tokens_details: { cached: 4 } } }),
      'data: [DONE]\n\n'
    ])

    expect(result.content).toBe('done')
    expect(result.skipped).toBe(0)
    expect(result.usage).toEqual({ total_tokens: 12 })
  })
})

describe('openaiAdapter.contentOf', () => {
  it('joins the text parts of an array-shaped message', () => {
    const body = JSON.stringify({
      choices: [
        {
          message: { content: [{ type: 'text', text: '{"lines":' }, { type: 'text', text: '[]}' }] },
          finish_reason: 'stop'
        }
      ]
    })

    expect(openaiAdapter.contentOf(body, LABEL)).toBe('{"lines":[]}')
  })

  it('treats a refusal as a content block', () => {
    const body = JSON.stringify({
      choices: [
        { message: { content: '', refusal: 'I cannot help with that.' }, finish_reason: 'stop' }
      ]
    })

    expect(throwOf(() => openaiAdapter.contentOf(body, LABEL)).code).toBe('LLM_BLOCKED')
  })
})

describe('modelIdsOf', () => {
  it('keeps only the models that can be held to a schema, sorted and unique', () => {
    const body = JSON.stringify({
      data: [
        { id: 'zeta/chat', supported_parameters: ['temperature', 'response_format'] },
        { id: 'alpha/chat', supported_parameters: ['structured_outputs'] },
        { id: 'beta/chat', supported_parameters: ['temperature'] },
        { id: 'gamma/chat' },
        { id: 'alpha/chat', supported_parameters: ['response_format'] },
        { name: 'no id at all' }
      ]
    })

    expect(modelIdsOf(body)).toEqual(['alpha/chat', 'gamma/chat', 'zeta/chat'])
  })

  it('answers nothing for a body that is not a listing', () => {
    expect(modelIdsOf('<html>not an API</html>')).toEqual([])
    expect(modelIdsOf(JSON.stringify({ models: ['a'] }))).toEqual([])
  })
})
