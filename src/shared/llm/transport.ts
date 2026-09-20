import { appError, messageOf } from '../errors'
import type { Settings } from '../types'
import type { LlmAdapter, LlmCall } from './adapter'
import { readSettings } from './settingsPort'

/**
 * The HTTP half both cloud services share: prove the key is there, time the round trip,
 * send the call, and hand a non-2xx to the adapter.
 */

/**
 * Settings with the API key proven present, or the permanent failure saying how to add one;
 * `purpose` completes that message (Add one in Settings to …).
 */
export async function keyedSettings(purpose: string): Promise<Settings & { apiKey: string }> {
  const settings = await readSettings()
  if (!settings.apiKey) {
    throw appError('API_KEY_MISSING', `No API key is configured. Add one in Settings to ${purpose}.`)
  }
  return settings as Settings & { apiKey: string }
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
