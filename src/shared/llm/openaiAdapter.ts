import { appError, truncate } from '../errors'
import type { AppError } from '../types'
import type { BuildCallContext, ErrorContext, LlmAdapter, LlmCall, StreamDelta } from './adapter'
import { htmlGist, isHtml, permanentStatus, retryableCode } from './httpStatus'

/**
 * Chat-completions adapter for whatever the player's endpoint URL answers: a hosted router,
 * a vendor's compatibility layer or a server on this machine. It writes scenes only.
 */

/** Minimal shape of the JSON error envelope these endpoints agree on. */
interface OpenAiError {
  code?: number | string
  message?: string
  type?: string
  metadata?: { reasons?: unknown }
}

/** Minimal shape of one chat completion, whole or streamed. */
interface OpenAiResponse {
  // `delta` carries a streamed chunk and `message` a whole reply; `choices` is empty on the
  // usage-only chunk that closes a stream.
  choices?: Array<{
    message?: { content?: unknown; refusal?: string }
    delta?: { content?: unknown }
    finish_reason?: string | null
    error?: OpenAiError
  }>
  usage?: unknown
  error?: OpenAiError
}

/** The HTTP-like status an error envelope names; an unnumbered code classifies as permanent. */
function statusOf(error: OpenAiError | undefined): number {
  const code = Number(error?.code)
  return Number.isFinite(code) ? code : 0
}

/**
 * The `AppError` a status and the endpoint's error envelope amount to; `bodyDetail` is what a
 * body carrying no envelope contributes in its place. Never throws.
 */
function classify(
  status: number,
  envelope: OpenAiError | undefined,
  label: string,
  bodyDetail = ''
): AppError {
  const detail = envelope
    ? `${envelope.type ?? ''} ${envelope.message ?? ''}`.trim()
    : bodyDetail

  if (status === 401) {
    return appError('LLM_REQUEST_REJECTED', `${label} rejected the API key (HTTP 401).`, detail)
  }
  const reasons = envelope?.metadata?.reasons
  if (status === 403 && Array.isArray(reasons)) {
    return appError(
      'LLM_BLOCKED',
      `${label} refused the prompt (${reasons.join(', ')}). Try wording the action differently.`,
      detail
    )
  }
  if (status === 403) {
    return appError('LLM_REQUEST_REJECTED', `${label} rejected the API key (HTTP 403).`, detail)
  }
  if (status === 402) {
    // An endpoint that bills the player says how much is left better than we can.
    return appError(
      'LLM_CREDITS_DEPLETED',
      envelope?.message ? envelope.message : `${label} reports no credits left (HTTP 402).`,
      detail
    )
  }
  if (status === 404) {
    return appError(
      'LLM_REQUEST_REJECTED',
      'No chat completions endpoint answered at this URL (HTTP 404). ' +
        'Check the endpoint URL in Settings.',
      detail
    )
  }
  if (permanentStatus(status)) {
    return appError(
      'LLM_REQUEST_REJECTED',
      status ? `${label} rejected the request (HTTP ${status}).` : `${label} rejected the request.`,
      detail
    )
  }
  return appError(retryableCode(status), `${label} returned HTTP ${status}.`, detail)
}

/**
 * Throws unless a finish reason means the model simply stopped; only `stop` does. `envelope` is
 * the error the choice carried, where one names the failure the reason only labels.
 */
function assertFinished(reason: string, envelope: OpenAiError | undefined, label: string): void {
  if (reason === 'stop') return
  if (reason === 'length') {
    throw appError(
      'LLM_TRUNCATED',
      `${label} ran out of room before finishing the scene.`,
      'finish_reason=length'
    )
  }
  if (reason === 'content_filter') {
    throw appError(
      'LLM_BLOCKED',
      `${label} blocked the reply (content_filter). Try wording the action differently.`,
      'finish_reason=content_filter'
    )
  }
  if (reason === 'error') {
    if (envelope) throw classify(statusOf(envelope), envelope, label)
    throw appError('LLM_HTTP', `${label} reported an error mid-reply.`, 'finish_reason=error')
  }
  throw appError(
    'LLM_TRUNCATED',
    `${label} stopped early before finishing the scene.`,
    `finish_reason=${reason}`
  )
}

/** The numeric fields of a usage object, dropping the breakdowns some endpoints nest inside it. */
function usageOf(usage: unknown): Record<string, number> | undefined {
  if (!usage || typeof usage !== 'object') return undefined
  const counts: Record<string, number> = {}
  for (const [key, value] of Object.entries(usage as Record<string, unknown>)) {
    if (typeof value === 'number') counts[key] = value
  }
  return Object.keys(counts).length > 0 ? counts : undefined
}

/** Assistant text off a message's content: the string form, or the text parts of the array form. */
function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => {
      const text = (part as { text?: unknown })?.text
      return typeof text === 'string' ? text : ''
    })
    .join('')
}

/** The custom endpoint draws nothing; the registry's type is what makes these two exist. */
function noPictures(): never {
  throw appError('LLM_REQUEST_REJECTED', 'The custom endpoint does not draw pictures.')
}

/**
 * The model ids a `/models` listing offers, keeping only those that say they can be held to a
 * schema when they say anything at all.
 */
export function modelIdsOf(rawBody: string): string[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(rawBody)
  } catch {
    return []
  }
  const data = (parsed as { data?: unknown } | null)?.data
  if (!Array.isArray(data)) return []

  const ids = new Set<string>()
  for (const entry of data) {
    const model = entry as { id?: unknown; supported_parameters?: unknown } | null
    if (typeof model?.id !== 'string' || !model.id) continue
    const supported = model.supported_parameters
    const structured =
      !Array.isArray(supported) ||
      supported.includes('response_format') ||
      supported.includes('structured_outputs')
    if (structured) ids.add(model.id)
  }
  return [...ids].sort()
}

export const openaiAdapter: LlmAdapter = {
  buildImageCall: noPictures,
  imageOf: noPictures,

  buildCall({
    request,
    provider,
    model,
    apiKey,
    thinkingLevel,
    maxOutputTokens,
    streaming
  }: BuildCallContext): LlmCall {
    const images = request.images ?? []
    // Plain text where there are no images: the oldest servers take nothing else.
    const content =
      images.length === 0
        ? request.user
        : [
            { type: 'text', text: request.user },
            ...images.map((image) => ({
              type: 'image_url',
              image_url: { url: `data:${image.mimeType};base64,${image.data}` }
            }))
          ]

    return {
      url: `${provider.baseUrl}/chat/completions`,
      headers: {
        'Content-Type': 'application/json',
        // A server on this machine takes no key, and an empty bearer is a 401 on some.
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
      },
      body: {
        model: model.id,
        messages: [
          ...(request.system ? [{ role: 'system', content: request.system }] : []),
          { role: 'user', content }
        ],
        // `strict` off: an endpoint that cannot enforce the schema still gets to try.
        response_format: {
          type: 'json_schema',
          json_schema: { name: request.schema.name, schema: request.schema.schema, strict: false }
        },
        reasoning_effort: thinkingLevel,
        // A chat-completions server that names no cap of its own answers in a few hundred
        // tokens; sent so a reply that ran out of room is unambiguous when read back, and the
        // player's own cap where one is set.
        max_tokens: maxOutputTokens,
        ...(streaming ? { stream: true, stream_options: { include_usage: true } } : {}),
        ...model.extraBody
      }
    }
  },

  errorFor({ status, contentType, body, label }: ErrorContext): AppError {
    if (isHtml(contentType, body)) {
      // A base URL naming a web page rather than an API root answers HTML.
      return appError(
        'LLM_HTTP',
        `${label} returned an HTTP ${status} error page rather than JSON. ` +
          'Check the endpoint URL in Settings.',
        htmlGist(body)
      )
    }

    let envelope: OpenAiError | undefined
    try {
      envelope = (JSON.parse(body) as { error?: OpenAiError }).error
    } catch {
      // A non-JSON, non-HTML body classifies by status alone.
    }
    return classify(status, envelope, label, truncate(body, 2000))
  },

  contentOf(rawBody: string, label: string): string {
    let parsed: OpenAiResponse
    try {
      parsed = JSON.parse(rawBody) as OpenAiResponse
    } catch {
      throw appError('LLM_MALFORMED', 'The API response was not valid JSON.', truncate(rawBody, 2000))
    }

    if (parsed.error) throw classify(statusOf(parsed.error), parsed.error, label)
    const choice = parsed.choices?.[0]
    if (choice?.finish_reason) assertFinished(choice.finish_reason, choice.error, label)
    if (choice?.message?.refusal) {
      throw appError(
        'LLM_BLOCKED',
        `${label} refused to answer. Try wording the action differently.`,
        truncate(choice.message.refusal, 2000)
      )
    }
    return textOf(choice?.message?.content)
  },

  deltaOf(payload: string, label: string): StreamDelta {
    let parsed: OpenAiResponse
    try {
      parsed = JSON.parse(payload) as OpenAiResponse
    } catch {
      // Not a frame this adapter understands; the service logs and skips it.
      throw new Error('unparseable frame')
    }

    if (parsed.error) throw classify(statusOf(parsed.error), parsed.error, label)
    const choice = parsed.choices?.[0]
    const finishReason = choice?.finish_reason ?? undefined
    if (finishReason) assertFinished(finishReason, choice?.error, label)
    // Reasoning fields ride the same delta and are prose, never part of the answer.
    const text = typeof choice?.delta?.content === 'string' ? choice.delta.content : ''
    return { text, finished: Boolean(finishReason), finishReason, usage: usageOf(parsed.usage) }
  },

  // The sentinel every chat-completions stream ends with.
  isStreamEnd(payload: string): boolean {
    return payload.trim() === '[DONE]'
  }
}
