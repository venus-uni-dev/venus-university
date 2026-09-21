import { endpointProblem } from '../endpoint'
import { appError, messageOf } from '../errors'
import { pictureKeyOf, writerReady } from '../settingsRules'
import type { Settings } from '../types'
import type { LlmAdapter, LlmCall } from './adapter'
import { readSettings } from './settingsPort'

/**
 * The HTTP half both cloud services share: prove the call can be made, time the round trip,
 * send it, and hand a non-2xx to the adapter.
 */

/**
 * Settings the writer can run on, or the permanent failure naming what is missing; `purpose`
 * completes that message (… in Settings to …). `override` runs candidate settings instead of
 * the stored ones.
 */
export async function writerSettings(purpose: string, override?: Settings): Promise<Settings> {
  const settings = override ?? (await readSettings())
  if (writerReady(settings, Boolean(settings.apiKey))) return settings

  if (settings.apiProvider === 'openai') {
    const problem = endpointProblem(settings.endpointUrl ?? '')
    if (problem) {
      throw appError('LLM_ENDPOINT_INVALID', `${problem} Fix the endpoint in Settings to ${purpose}.`)
    }
    throw appError(
      'API_KEY_MISSING',
      `No model is set for the custom endpoint. Name one in Settings to ${purpose}.`
    )
  }
  throw appError('API_KEY_MISSING', `No API key is configured. Add one in Settings to ${purpose}.`)
}

/**
 * Settings with the Gemini key the pictures are drawn with proven present, or the permanent
 * failure saying how to add one. The pictures never run on a custom endpoint.
 */
export async function pictureSettings(
  purpose: string
): Promise<Settings & { pictureKey: string }> {
  const settings = await readSettings()
  const pictureKey = pictureKeyOf(settings)
  if (!pictureKey) {
    throw appError(
      'API_KEY_MISSING',
      settings.apiProvider === 'openai'
        ? `No Gemini key is set. Add one in Settings to ${purpose}.`
        : `No API key is configured. Add one in Settings to ${purpose}.`
    )
  }
  return { ...settings, pictureKey }
}

/** Wall clock for a round trip, in ms; read on every exit path. */
export function startClock(): () => number {
  const startedAt = performance.now()
  return () => Math.round(performance.now() - startedAt)
}

/** What the console lines this call writes are tagged and titled with. */
export interface CallLog {
  /** `'llm'` or `'image'` — the bracketed prefix on every line. */
  tag: string
  /** `"Gemini gemini-3-pro"` — the provider and model, for the failure lines. */
  what: string
  /** The provider's display label on its own, for user-facing messages. */
  label: string
}

/** Sends one built call and answers with a response already known to be 2xx. */
export async function sendCall(
  call: LlmCall,
  adapter: Pick<LlmAdapter, 'errorFor'>,
  log: CallLog,
  elapsed: () => number,
  signal?: AbortSignal
): Promise<Response> {
  let response: Response
  try {
    response = await fetch(call.url, {
      method: 'POST',
      headers: call.headers,
      body: JSON.stringify(call.body),
      signal
    })
  } catch (err) {
    console.log(`[${log.tag}] ✕ ${log.what} failed after ${elapsed()}ms`)
    // An abort arrives here as a network failure.
    if (signal?.aborted) throw appError('CANCELLED', 'The job was cancelled.')
    throw appError('LLM_NETWORK', `Could not reach ${log.label}.`, messageOf(err))
  }

  // A failure body is plain text in both modes, so the ok-check comes before any draining.
  if (!response.ok) {
    const text = await response.text()
    console.log(`[${log.tag}] ✕ ${log.what} HTTP ${response.status} after ${elapsed()}ms`)
    throw adapter.errorFor({
      status: response.status,
      contentType: (response.headers.get('content-type') ?? '').toLowerCase(),
      body: text,
      label: log.label
    })
  }

  return response
}
