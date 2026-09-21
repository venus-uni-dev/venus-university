import { appError, isAppError, truncate } from '../errors'
import type { AppError } from '../types'
import type {
  BuildCallContext,
  BuildImageCallContext,
  ErrorContext,
  GeneratedImage,
  LlmAdapter,
  LlmCall,
  StreamDelta
} from './adapter'
import { htmlGist, isHtml, permanentStatus, retryableCode } from './httpStatus'

/**
 * Native Gemini `generateContent` adapter; every call it builds switches the four adjustable
 * harm categories off explicitly.
 */

/** The four adjustable harm categories at `BLOCK_NONE`; civic integrity is a 400. */
const SAFETY_OFF = [
  'HARM_CATEGORY_HARASSMENT',
  'HARM_CATEGORY_HATE_SPEECH',
  'HARM_CATEGORY_SEXUALLY_EXPLICIT',
  'HARM_CATEGORY_DANGEROUS_CONTENT'
].map((category) => ({ category, threshold: 'BLOCK_NONE' }))

/** `finishReason`s that mean a filter fired rather than the model stopping. */
const BLOCKED_FINISH_REASONS = new Set([
  'SAFETY',
  'PROHIBITED_CONTENT',
  'BLOCKLIST',
  'SPII',
  'RECITATION',
  'LANGUAGE',
  'IMAGE_SAFETY'
])

/** Minimal shape of Gemini's JSON error envelope. */
interface GeminiErrorBody {
  error?: { code?: number; message?: string; status?: string }
}

/** Minimal shape of a `GenerateContentResponse`, whole or streamed. */
interface GeminiResponse {
  candidates?: Array<{
    // `thought` marks a reasoning part: it is prose, never part of the answer.
    // `inlineData` is how the image model returns its picture — base64 bytes.
    content?: {
      parts?: Array<{
        text?: string
        thought?: boolean
        inlineData?: { mimeType?: string; data?: string }
      }>
    }
    finishReason?: string
  }>
  promptFeedback?: { blockReason?: string }
  usageMetadata?: Record<string, number>
  error?: GeminiErrorBody['error']
}

/** Throws when a parsed Gemini response is blocked, truncated or otherwise unusable. */
function assertUsable(parsed: GeminiResponse, label: string): void {
  if (parsed.error) {
    const code = permanentStatus(parsed.error.code ?? 0)
      ? 'LLM_REQUEST_REJECTED'
      : codeForStatus(parsed.error.code ?? 0, parsed.error.message)
    throw appError(
      code,
      // An empty prepayment balance gets Google's own sentence, as over HTTP.
      code === 'LLM_CREDITS_DEPLETED' && parsed.error.message
        ? parsed.error.message
        : `${label} reported an error mid-reply.`,
      `${parsed.error.status ?? ''} ${parsed.error.message ?? ''}`.trim()
    )
  }

  const blockReason = parsed.promptFeedback?.blockReason
  if (blockReason) {
    throw appError(
      'LLM_BLOCKED',
      `${label} refused the prompt (${blockReason}). Try wording the action differently.`,
      `promptFeedback.blockReason=${blockReason}`
    )
  }

  const finishReason = parsed.candidates?.[0]?.finishReason
  if (finishReason && BLOCKED_FINISH_REASONS.has(finishReason)) {
    throw appError(
      'LLM_BLOCKED',
      `${label} blocked the reply (${finishReason}). Try wording the action differently.`,
      `finishReason=${finishReason}`
    )
  }
  if (finishReason === 'MAX_TOKENS') {
    throw appError(
      'LLM_TRUNCATED',
      `${label} ran out of room before finishing the scene.`,
      'finishReason=MAX_TOKENS'
    )
  }
  // Anything not `STOP` — `OTHER`, or a value Google adds later — is a cut-off reply.
  if (finishReason && finishReason !== 'STOP') {
    throw appError(
      'LLM_TRUNCATED',
      `${label} stopped early before finishing the scene.`,
      `finishReason=${finishReason}`
    )
  }
}

/** True when a 429's message names Google's own prepayment-balance error. */
function creditsDepleted(message: string | undefined): boolean {
  return /prepayment credits|credits are depleted/i.test(message ?? '')
}

/** The retryable code a busy service's status earns; a 429 with an empty balance earns its own. */
function codeForStatus(status: number, message?: string): string {
  if (status === 429 && creditsDepleted(message)) return 'LLM_CREDITS_DEPLETED'
  return retryableCode(status)
}

/** Concatenates the first candidate's non-thought text parts. */
function textOf(parsed: GeminiResponse): string {
  return (parsed.candidates?.[0]?.content?.parts ?? [])
    .filter((part) => !part.thought)
    .map((part) => part.text ?? '')
    .join('')
}

/**
 * `generateContent` against the image model: no `thinkingConfig` or response schema (both
 * rejected), `responseModalities` naming TEXT beside IMAGE, and an edit's source before the text.
 */
function buildImageCall(args: BuildImageCallContext): LlmCall {
  const parts = args.image
    ? [{ inlineData: { mimeType: args.image.mimeType, data: args.image.data } }, { text: args.prompt }]
    : [{ text: args.prompt }]
  return {
    url: `${args.provider.baseUrl}/models/${args.modelId}:generateContent`,
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': args.apiKey
    },
    body: {
      contents: [{ role: 'user', parts }],
      generationConfig: {
        responseModalities: ['TEXT', 'IMAGE'],
        // Landscape, matching the shipped /assets/bg backgrounds; an absent `imageSize`
        // serializes away, so only the graduation picture asks for 4K.
        imageConfig: { aspectRatio: '16:9', imageSize: args.imageSize }
      },
      safetySettings: SAFETY_OFF
    }
  }
}

/** The first non-thought `inlineData` part of a reply body, vetted like a text reply. */
function imageOf(rawBody: string, label: string): GeneratedImage {
  let parsed: GeminiResponse
  try {
    parsed = JSON.parse(rawBody) as GeminiResponse
  } catch {
    throw appError('LLM_MALFORMED', 'The API response was not valid JSON.', truncate(rawBody, 2000))
  }

  assertUsable(parsed, label)
  for (const part of parsed.candidates?.[0]?.content?.parts ?? []) {
    if (!part.thought && part.inlineData?.data) {
      return { mimeType: part.inlineData.mimeType ?? 'image/png', data: part.inlineData.data }
    }
  }
  throw appError(
    'LLM_EMPTY',
    'The model returned no image.',
    truncate(textOf(parsed) || rawBody, 2000)
  )
}

export const geminiAdapter: LlmAdapter = {
  buildImageCall,
  imageOf,

  buildCall({
    request,
    provider,
    model,
    apiKey,
    thinkingLevel,
    serviceTier,
    maxOutputTokens,
    streaming
  }: BuildCallContext): LlmCall {
    // `?alt=sse` makes the stream `data:`-framed SSE rather than a growing JSON array.
    const method = streaming ? 'streamGenerateContent?alt=sse' : 'generateContent'

    return {
      url: `${provider.baseUrl}/models/${model.id}:${method}`,
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: {
        // Top level and snake_case; omitted on `standard`, which the API assumes.
        ...(serviceTier !== 'standard' ? { service_tier: serviceTier } : {}),
        // An empty system instruction is a 400; the hangout classifier sends none.
        ...(request.system ? { systemInstruction: { parts: [{ text: request.system }] } } : {}),
        contents: [
          {
            role: 'user',
            // Text first, images after.
            parts: [
              { text: request.user },
              ...(request.images ?? []).map((image) => ({
                inlineData: { mimeType: image.mimeType, data: image.data }
              }))
            ]
          }
        ],
        generationConfig: {
          responseMimeType: 'application/json',
          // Always the pinned ceiling here, the player's own cap being a custom endpoint's
          // alone, so a reply that ran out of room is unambiguous when read back.
          maxOutputTokens,
          // `responseJsonSchema`, never `responseSchema`.
          responseJsonSchema: request.schema.schema,
          // Never pair with the legacy `thinkingBudget`: sending both is a 400.
          thinkingConfig: { thinkingLevel },
          // Per model, not per provider — see `providers.ts`.
          ...model.extraBody
        },
        safetySettings: SAFETY_OFF
      }
    }
  },

  errorFor({ status, contentType, body, label }: ErrorContext): AppError {
    if (isHtml(contentType, body)) {
      // The HTML rule wins over the status code.
      return appError(
        'LLM_HTTP',
        `${label}'s front end returned an HTTP ${status} error page.`,
        htmlGist(body)
      )
    }

    let envelope: GeminiErrorBody['error']
    try {
      envelope = (JSON.parse(body) as GeminiErrorBody).error
    } catch {
      // A non-JSON, non-HTML body classifies by status alone.
    }

    const detail = envelope
      ? `${envelope.status ?? ''} ${envelope.message ?? ''}`.trim()
      : truncate(body, 2000)

    if (permanentStatus(status)) {
      return appError(
        'LLM_REQUEST_REJECTED',
        `${label} rejected the request (HTTP ${status}${envelope?.status ? ` ${envelope.status}` : ''}).`,
        detail
      )
    }

    const code = codeForStatus(status, envelope?.message)
    // An empty prepayment balance gets Google's own sentence; anything else gets ours.
    const message =
      code === 'LLM_CREDITS_DEPLETED' && envelope?.message
        ? envelope.message
        : `${label} returned HTTP ${status}.`
    return appError(code, message, detail)
  },

  contentOf(rawBody: string, label: string): string {
    let parsed: GeminiResponse
    try {
      parsed = JSON.parse(rawBody) as GeminiResponse
    } catch {
      throw appError('LLM_MALFORMED', 'The API response was not valid JSON.', truncate(rawBody, 2000))
    }

    assertUsable(parsed, label)
    return textOf(parsed)
  },

  deltaOf(payload: string, label: string): StreamDelta {
    let parsed: GeminiResponse
    try {
      parsed = JSON.parse(payload) as GeminiResponse
    } catch (err) {
      // Not a frame this adapter understands; the service logs and skips it.
      if (isAppError(err)) throw err
      throw new Error('unparseable frame')
    }

    assertUsable(parsed, label)
    // Past `assertUsable` the only surviving reason is `STOP`, so any reason means finished.
    const finishReason = parsed.candidates?.[0]?.finishReason
    return {
      text: textOf(parsed),
      finished: Boolean(finishReason),
      finishReason,
      usage: parsed.usageMetadata
    }
  },

  // Gemini's SSE stream ends at EOF; there is no sentinel frame.
  isStreamEnd(): boolean {
    return false
  },

  // The only place a priority request served as `standard` is reported.
  servedTierOf(headers: Headers): string | undefined {
    return headers.get('x-gemini-service-tier') ?? undefined
  }
}
