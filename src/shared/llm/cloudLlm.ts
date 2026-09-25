import { appError, isAppError, messageOf, tailOf, truncate } from '../errors'
import { modelFor, providerToRun, reasoningToSend, serviceTierFor } from '../providers'
import type { ModelConfig } from '../providers'
import { DEFAULT_SECONDARY_KINDS, isPromptKind, type PromptKind } from '../promptKinds'
import { maxOutputTokensOf, secondaryModelOf, writerKeyOf, writerModelOf } from '../settingsRules'
import type { Settings } from '../types'
import { MAX_OUTPUT_TOKENS } from './adapter'
import { adapterFor } from './index'
import type { LlmAdapter, StructuredRequest } from './index'
import { reportGeneratedTokens } from './tokenPort'
import { sendCall, startClock, writerSettings } from './transport'

/**
 * Cloud LLM transport; the provider-specific wire format lives in the adapter beside it,
 * and the settings it reads the key from come from the port each process wires.
 */

export type { StructuredRequest }

/** What a drained SSE body amounted to, beyond the text itself. */
interface StreamResult {
  content: string
  /** False when the body ended without any frame reporting a finish reason. */
  finished: boolean
  /** How many frames were unparseable, each one a hole in `content`. */
  skipped: number
  /** Lines neither SSE framing nor `data:` — a proxy's plain text over the stream. */
  ignored: number
  finishReason?: string
  usage?: Record<string, number>
}

/** How many foreign lines get quoted before the warning turns into a tally. */
const IGNORED_LINE_WARNINGS = 5

/**
 * Drains an SSE body, forwarding deltas while buffering partial lines; malformed frames are
 * skipped but adapter-recognized failures propagate, and each frame's token count reaches
 * `onUsage` even when the frame itself fails.
 */
export async function readStream(
  response: Response,
  adapter: LlmAdapter,
  label: string,
  onDelta: (delta: string) => void,
  onUsage?: (generated: number) => void
): Promise<StreamResult> {
  const result: StreamResult = { content: '', finished: false, skipped: 0, ignored: 0 }

  // A missing body is an empty reply, caught by the caller's `LLM_EMPTY` check.
  const body = response.body
  if (!body) return result

  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  // The `data:` values of the event being assembled, awaiting its blank line.
  let eventData: string[] = []

  /** Hands the assembled event to the adapter; false once the stream has ended. */
  const dispatch = (): boolean => {
    if (eventData.length === 0) return true
    const payload = eventData.join('\n')
    eventData = []

    if (adapter.isStreamEnd(payload)) {
      result.finished = true
      return false
    }

    // Read before the delta, so a block or truncation frame that throws still reports its cost.
    const generated = adapter.generatedTokensOf(payload)
    if (generated !== undefined) onUsage?.(generated)

    try {
      const delta = adapter.deltaOf(payload, label)
      if (delta.finished) {
        result.finished = true
        result.finishReason = delta.finishReason
      }
      // Usage can ride a frame that names no finish reason, so it is taken from any frame.
      if (delta.usage) result.usage = delta.usage
      if (delta.text) {
        result.content += delta.text
        onDelta(delta.text)
      }
    } catch (err) {
      // A block or error envelope that arrived mid-reply keeps its classification.
      if (isAppError(err)) throw err
      // A skipped frame is a hole in `content`, so its payload is logged with the warning.
      result.skipped += 1
      console.warn('[llm] skipped an unparseable stream chunk:', truncate(payload, 2000))
    }
    return true
  }

  /** Handles one complete line; returns false once the stream has ended. */
  const consume = (rawLine: string): boolean => {
    // Lines may end LF or CRLF; splitting on '\n' leaves the '\r' behind.
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine

    if (line === '') return dispatch()
    if (line.startsWith('data:')) {
      // SSE strips exactly one space after the colon; a trim would eat payload whitespace.
      eventData.push(line.startsWith('data: ') ? line.slice(6) : line.slice(5))
      return true
    }
    // SSE comments (keep-alives) and the unused fields are passed over.
    if (line.startsWith(':') || /^(event|id|retry):/.test(line)) return true

    // Anything else is foreign — a proxy's plain-text error, most likely.
    result.ignored += 1
    if (result.ignored <= IGNORED_LINE_WARNINGS) {
      console.warn('[llm] ignored a non-SSE stream line:', truncate(line, 500))
    }
    return true
  }

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    // The last element is the incomplete line after the final newline; the next read continues it.
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!consume(line)) return result
    }
  }

  // Flushes the decoder, so a body ending mid-codepoint keeps its last character.
  buffer += decoder.decode()
  if (buffer && !consume(buffer)) return result
  // An event the body ended without delimiting is still an event.
  dispatch()
  return result
}

/** Appends the stream's skipped-frame and ignored-line tallies to an error detail. */
function withSkipNote(detail: string, skipped: number, ignored = 0): string {
  const notes: string[] = []
  if (skipped) notes.push(`${skipped} stream frame${skipped === 1 ? '' : 's'} skipped`)
  if (ignored) notes.push(`${ignored} non-SSE line${ignored === 1 ? '' : 's'} ignored`)
  return notes.length ? `${detail} (${notes.join(', ')})` : detail
}

/** The response headers worth having on a failure record; absent ones are omitted. */
function headerNote(headers: Headers): string {
  const noted = ['content-type', 'x-request-id', 'x-goog-request-id', 'server-timing']
    .map((name) => [name, headers.get(name)] as const)
    .filter(([, value]) => value)
    .map(([name, value]) => `${name}=${value}`)
  return noted.length ? ` [${noted.join(', ')}]` : ''
}

/** True when `text` parses as a whole JSON object or array — the salvage test. */
function parsesAsJsonDocument(text: string): boolean {
  try {
    const parsed: unknown = JSON.parse(text)
    return typeof parsed === 'object' && parsed !== null
  } catch {
    return false
  }
}

/**
 * Which model writes this call: the secondary one if the player picked one and named this kind,
 * else the primary. **An untagged call is never routed** — most calls are untagged. An absent
 * `secondaryModelFor` means the default set, the same one the checkboxes open showing; a written
 * one is filtered, since the settings file is hand-editable and anything may be in the list.
 */
function modelToRun(settings: Settings, kind: PromptKind | undefined): ModelConfig {
  const kinds = settings.secondaryModelFor?.filter(isPromptKind) ?? DEFAULT_SECONDARY_KINDS
  const secondary = secondaryModelOf(settings)
  const routed = secondary !== '' && kind !== undefined && kinds.includes(kind)
  return modelFor(settings.apiProvider, routed ? secondary : writerModelOf(settings))
}

/**
 * Sends one provider-enforced structured-output request and returns parsed JSON;
 * `onDelta` is preview-only and the full response stays authoritative, and `override` sends
 * the call on candidate settings rather than the stored ones.
 */
export async function completeStructured<T>(
  request: StructuredRequest,
  signal?: AbortSignal,
  onDelta?: (delta: string) => void,
  override?: Settings
): Promise<T> {
  const settings = await writerSettings('generate characters', override)

  const provider = providerToRun(settings)
  const model = modelToRun(settings, request.kind)
  // Against the model that will actually run, so a secondary that takes fewer levels than the
  // primary falls to its own default rather than 400ing.
  const thinkingLevel = reasoningToSend(settings, model.id, request.minThinking)
  // Absent is `priority`: the tier is a hand-edited switch rather than a player setting.
  const serviceTier = serviceTierFor(settings.apiProvider, settings.serviceTier ?? 'priority')
  // The player's own cap where a custom endpoint names one, else the pinned ceiling.
  const maxOutputTokens = maxOutputTokensOf(settings) ?? MAX_OUTPUT_TOKENS
  const adapter = adapterFor(provider)

  // Carried out of the attempt so the `JSON.parse` failure can name the stream's holes.
  let skipped = 0
  let ignored = 0

  const log = { tag: 'llm', what: `${provider.label} ${model.id}`, label: provider.label }

  const attempt = async (): Promise<string> => {
    // Absent is on; off in the file sends the same call to the whole-reply endpoint.
    const streaming = Boolean(onDelta) && (settings.streamResponses ?? true)

    const call = adapter.buildCall({
      request,
      provider,
      model,
      apiKey: writerKeyOf(settings),
      thinkingLevel,
      serviceTier,
      maxOutputTokens,
      streaming
    })

    console.log(
      `[llm] → ${log.what} (thinking=${thinkingLevel}, tier=${serviceTier}` +
        `, maxTokens=${maxOutputTokens}` +
        `, schema=${request.schema.name}` +
        `${request.cacheKey ? `, cacheKey=${request.cacheKey}` : ''}` +
        `${request.kind ? `, kind=${request.kind}` : ''}` +
        `${streaming ? ', streaming' : ''})`
    )
    // The system prompt never varies while a playthrough runs, and a builder marks where its
    // user preamble ends: both stay out of the log, which says what it left out.
    console.log(`[llm] → system: (truncated, ${request.system.length} chars)`)
    const from = request.logFrom ?? 0
    console.log(
      `[llm] → user${from > 0 ? ` (${from} chars of preamble omitted)` : ''}:`,
      request.user.slice(from)
    )
    // One summary line per image, never the payload.
    for (const image of request.images ?? []) {
      console.log(
        `[llm] → image: ${image.mimeType}, ${Math.round((image.data.length * 3) / 4 / 1024)}KB`
      )
    }

    const elapsed = startClock()
    // The reply's output tokens, thinking included, once any part of it has reported them.
    let generated: number | undefined
    const response = await sendCall(call, adapter, log, elapsed, signal)

    // A reply that fails past this point was still billed, so its count is reported on every exit.
    try {
      // A priority request served as standard is logged as a downgrade.
      const servedTier = adapter.servedTierOf?.(response.headers)
      const downgrade = servedTier && servedTier !== serviceTier ? `, served=${servedTier}` : ''

      // Both modes converge on one `content` string.
      let content: string
      let raw: string
      // Appended to the response log line; only the streamed mode reports a terminal reason.
      let outcome = ''
      if (streaming) {
        let stream: StreamResult
        try {
          stream = await readStream(
            response,
            adapter,
            provider.label,
            onDelta as (delta: string) => void,
            (n) => {
              generated = n
            }
          )
        } catch (err) {
          console.log(`[llm] ✕ ${log.what} stream failed after ${elapsed()}ms`)
          if (signal?.aborted) throw appError('CANCELLED', 'The job was cancelled.')
          // An adapter-classified failure keeps its own code.
          if (isAppError(err)) throw err
          throw appError(
            'LLM_NETWORK',
            `The connection to ${provider.label} was lost mid-reply.`,
            messageOf(err)
          )
        }

        skipped = stream.skipped
        ignored = stream.ignored
        content = stream.content
        raw = content
        outcome = ` finishReason=${stream.finishReason ?? 'none'}${
          stream.usage ? ` usage=${JSON.stringify(stream.usage)}` : ''
        }`

        // EOF with no finish reason is a dropped connection unless the reply salvages.
        if (!stream.finished) {
          if (signal?.aborted) throw appError('CANCELLED', 'The job was cancelled.')

          // The salvage exception: zero skipped frames and a whole JSON document.
          if (skipped === 0 && parsesAsJsonDocument(content)) {
            console.warn(
              `[llm] ⚠ ${log.what} stream ended with no finish reason after ${elapsed()}ms, ` +
                `but the reply parses whole — accepting it (${content.length} chars)` +
                `${headerNote(response.headers)}`
            )
            outcome = ` finishReason=missing(salvaged)${
              stream.usage ? ` usage=${JSON.stringify(stream.usage)}` : ''
            }`
          } else {
            console.log(`[llm] ✕ ${log.what} stream ended early after ${elapsed()}ms`)
            // The whole body to the console, the tail to the modal.
            console.error(
              `[llm] ✕ stream ended without a finish reason (${content.length} chars)` +
                `${headerNote(response.headers)}:\n`,
              content
            )
            throw appError(
              'LLM_NETWORK',
              `The connection to ${provider.label} was lost mid-reply.`,
              withSkipNote(
                `the stream ended after ${content.length} chars without a finish reason` +
                  `${content ? ` — tail: ${tailOf(content, 500)}` : ''}`,
                skipped,
                ignored
              )
            )
          }
        }
      } else {
        raw = await response.text()
        generated = adapter.generatedTokensOf(raw)
        content = adapter.contentOf(raw, provider.label)
      }

      const responseMs = elapsed()

      if (!content) {
        throw appError(
          'LLM_EMPTY',
          'The model returned an empty response.',
          withSkipNote(truncate(raw, 2000), skipped, ignored)
        )
      }
      console.log(
        `[llm] ← ${log.what} (${content.length} chars, ${responseMs}ms${downgrade}${outcome}):`,
        content
      )
      return content
    } finally {
      if (generated !== undefined) reportGeneratedTokens(generated)
    }
  }

  const content = await attempt()
  try {
    return JSON.parse(content) as T
  } catch (err) {
    const reason = messageOf(err)
    // The whole body to the console; `detail` stays bounded because a modal renders it.
    console.error(
      `[llm] ✕ structured output was not valid JSON (${content.length} chars): ${reason}\n`,
      content
    )
    throw appError(
      'LLM_MALFORMED',
      'The model did not return valid JSON.',
      withSkipNote(`${reason} — content: ${truncate(content, 1000)}`, skipped, ignored)
    )
  }
}
