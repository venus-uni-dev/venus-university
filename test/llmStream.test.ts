import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isAppError } from '@shared/errors'
import type { AppError, StructuredRequest } from '@shared/types'

/**
 * The SSE reader and the salvage rule: a stream can end without saying so,
 * and only the accumulated bytes tell "cut off" from "arrived whole, terminal frame
 * lost". The transport module is mocked whole, which keeps `settingsService` out.
 */

/** What `writerSettings` answers with. */
let settings: Record<string, unknown> = {}
/** Responses `sendCall` hands back, in order; each call shifts one off. */
let responses: Response[] = []

vi.mock('../src/shared/llm/transport', () => ({
  writerSettings: async () => settings,
  startClock: () => () => 0,
  sendCall: async () => {
    const next = responses.shift()
    if (!next) throw new Error('the test queued no response for this call')
    return next
  }
}))

const { completeStructured, readStream } = await import('../src/shared/llm/cloudLlm')
const { geminiAdapter } = await import('../src/shared/llm/geminiAdapter')

const LABEL = 'Google (Gemini)'

/** A response whose body streams `chunks` as written — byte splits included. */
function sseResponse(chunks: Array<string | Uint8Array>): Response {
  const encoder = new TextEncoder()
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(typeof chunk === 'string' ? encoder.encode(chunk) : chunk)
        }
        controller.close()
      }
    })
  )
}

/** One `data:`-framed SSE event, blank line and all. */
function frame(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`
}

/** A Gemini response frame carrying `text`, optionally terminal. */
function textFrame(text: string, finishReason?: string): string {
  return frame({
    candidates: [{ content: { parts: [{ text }] }, ...(finishReason ? { finishReason } : {}) }]
  })
}

/** Drains `chunks` through the real Gemini adapter, collecting deltas. */
async function read(
  chunks: Array<string | Uint8Array>
): Promise<Awaited<ReturnType<typeof readStream>> & { deltas: string[] }> {
  const deltas: string[] = []
  const result = await readStream(sseResponse(chunks), geminiAdapter, LABEL, (delta) =>
    deltas.push(delta)
  )
  return { ...result, deltas }
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

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  responses = []
  settings = {
    apiProvider: 'gemini',
    apiModel: 'gemini-3.7-flash',
    apiKey: 'test-key',
    thinkingLevel: 'low',
    serviceTier: 'standard',
    streamResponses: true
  }
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('readStream', () => {
  it('keeps a character whose bytes straddle two chunks', async () => {
    // The decoder holds the partial code point until the next read, and is
    // flushed at EOF — without both, the é is lost or mangled.
    const whole = new TextEncoder().encode(textFrame('café'))
    const split = whole.indexOf(0xc3) + 1

    const result = await read([whole.slice(0, split), whole.slice(split)])
    expect(result.content).toBe('café')
  })

  // The EOF flush: a tail the body never delimited would otherwise drop the
  // finish reason and leave a short body the salvage rule accepts whole.
  it('dispatches a final event the body never delimited', async () => {
    const result = await read([`data: ${JSON.stringify({
      candidates: [{ content: { parts: [{ text: 'last' }] }, finishReason: 'STOP' }]
    })}`])

    expect(result.content).toBe('last')
    expect(result.finished).toBe(true)
  })
})

describe('completeStructured', () => {
  const request: StructuredRequest = {
    system: 'be brief',
    user: 'say something',
    schema: { name: 'scene', schema: { type: 'object' } }
  }

  /** One structured call with a preview channel attached. */
  function complete(deltas: string[] = []): Promise<{ lines: string[] }> {
    return completeStructured<{ lines: string[] }>(request, undefined, (delta) =>
      deltas.push(delta)
    )
  }

  it('accepts a whole reply whose terminal frame went missing', async () => {
    const reply = '{"lines":["she waves"]}'
    responses = [sseResponse([textFrame(reply)])]

    await expect(complete()).resolves.toEqual({ lines: ['she waves'] })
  })

  it('refuses to salvage a reply with a hole punched in it', async () => {
    // Parseable, but a frame between those two went unread — the parse
    // succeeding says nothing about what is missing from the middle.
    responses = [
      sseResponse(['data: {not json\n\n', textFrame('{"lines":["she waves"]}')])
    ]

    const error = await errorOf(complete())
    expect(error.code).toBe('LLM_NETWORK')
    expect(error.detail).toContain('1 stream frame skipped')
  })

  it('reports a genuinely cut reply with its tail on the record', async () => {
    responses = [sseResponse([textFrame('{"lines":["she wa')])]

    const error = await errorOf(complete())
    expect(error.code).toBe('LLM_NETWORK')
    expect(error.detail).toContain('she wa')
  })
})
