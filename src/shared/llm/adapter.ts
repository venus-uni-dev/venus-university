import type { ImageSize, ModelConfig, ProviderConfig, ServiceTier, ThinkingLevel } from '../providers'
import type { AppError, StructuredRequest } from '../types'

/**
 * Seam between the `cloudLlm` transport and a vendor's wire format; adding a
 * vendor means implementing this plus registering its provider.
 */

/** Re-exported so adapters can import their whole seam vocabulary from here. */
export type { StructuredRequest }

/** What one SSE frame contributed: its text, and whether it ended the reply. */
export interface StreamDelta {
  text: string
  /** True once the frame carries a `finishReason`; EOF without one is a cut-off reply. */
  finished: boolean
  /** The raw `finishReason`, kept for logging; `finished` is the decision. */
  finishReason?: string
  /** Token accounting, from whichever frame carries it, for the response log line. */
  usage?: Record<string, number>
}

/** The reply cap a call carries where the player named none, so a cut-off reply is unambiguous. */
export const MAX_OUTPUT_TOKENS = 65536

/** One fully-formed HTTP call, ready for the service to send. */
export interface LlmCall {
  url: string
  headers: Record<string, string>
  body: unknown
}

/** Everything an adapter needs to build one attempt. */
export interface BuildCallContext {
  request: StructuredRequest
  provider: ProviderConfig
  model: ModelConfig
  apiKey: string
  /** Already resolved against `model` by the service — never re-check it here. */
  thinkingLevel: ThinkingLevel
  /** Already resolved against `provider` by the service — never re-check it here. */
  serviceTier: ServiceTier
  /** The reply cap this call carries, already resolved by the service — send it as it is. */
  maxOutputTokens: number
  /** True when the caller passed an `onDelta` preview channel. */
  streaming: boolean
}

/** Everything an adapter needs to build one image call. */
export interface BuildImageCallContext {
  prompt: string
  provider: ProviderConfig
  /** Which image model — never one of the text models. There are two. */
  modelId: string
  apiKey: string
  /** How big the reply should be. */
  imageSize?: ImageSize
  /** An image to edit rather than start from nothing. */
  image?: GeneratedImage
}

/** Image bytes as the wire carries them: base64 plus the type they decode to. */
export interface GeneratedImage {
  mimeType: string
  data: string
}

/** Everything an adapter needs to classify a non-2xx response. */
export interface ErrorContext {
  status: number
  /** Raw `content-type` header, lowercased by the service. May be empty. */
  contentType: string
  /** Raw response body text. */
  body: string
  /** The provider's display label, for user-facing messages. */
  label: string
}

export interface LlmAdapter {
  /** Builds the HTTP call for one attempt. */
  buildCall(context: BuildCallContext): LlmCall

  /** Maps a non-2xx response to an `AppError`. Never throws. */
  errorFor(context: ErrorContext): AppError

  /** Pulls assistant text from a whole response, throwing `AppError` for 200-level blocks. */
  contentOf(rawBody: string, label: string): string

  /** Pulls one SSE text delta, throwing `AppError` for mid-stream errors or blocks. */
  deltaOf(payload: string, label: string): StreamDelta

  /** True when this payload terminates the stream (OpenAI's `[DONE]`). */
  isStreamEnd(payload: string): boolean

  /** Builds the image-model call; `image` makes it an edit rather than a render. */
  buildImageCall(context: BuildImageCallContext): LlmCall

  /** Pulls the generated image out of a whole response, throwing `AppError` for blocks. */
  imageOf(rawBody: string, label: string): GeneratedImage

  /** Which tier actually served a response, where the vendor reports one. */
  servedTierOf?(headers: Headers): string | undefined
}
