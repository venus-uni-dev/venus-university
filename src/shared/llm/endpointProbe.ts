import { endpointProblem, normalizeEndpoint } from '../endpoint'
import { appError, messageOf } from '../errors'
import { providerFor } from '../providers'
import type { Settings } from '../types'
import { completeStructured } from './cloudLlm'
import { modelIdsOf, openaiAdapter } from './openaiAdapter'

/**
 * The two questions the Settings form asks a custom endpoint before anything is saved:
 * which models it lists, and whether one call on the typed fields comes back.
 */

/** The model ids the endpoint lists, for the form's suggestions; a key rides only when set. */
export async function listModels(args: {
  endpointUrl: string
  apiKey?: string
}): Promise<string[]> {
  const problem = endpointProblem(args.endpointUrl)
  if (problem) throw appError('LLM_ENDPOINT_INVALID', problem)

  const label = providerFor('openai').label
  const url = `${normalizeEndpoint(args.endpointUrl)}/models`
  console.log(`[llm] → ${label} models: ${url}`)

  let response: Response
  try {
    response = await fetch(url, {
      headers: args.apiKey ? { Authorization: `Bearer ${args.apiKey}` } : {}
    })
  } catch (err) {
    throw appError('LLM_NETWORK', 'Could not reach the endpoint.', messageOf(err))
  }

  const body = await response.text()
  if (!response.ok) {
    throw openaiAdapter.errorFor({
      status: response.status,
      contentType: (response.headers.get('content-type') ?? '').toLowerCase(),
      body,
      label
    })
  }
  return modelIdsOf(body)
}

/**
 * Sends one tiny structured call on candidate settings; the `AppError` it throws is the answer
 * the form reports, and a resolved promise means the writer is connected.
 */
export async function testWriter(candidate: Settings): Promise<void> {
  await completeStructured<{ ok: boolean }>(
    {
      system: 'Answer with ok true.',
      user: 'Ping.',
      schema: {
        name: 'connection_test',
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['ok'],
          properties: { ok: { type: 'boolean' } }
        }
      }
    },
    undefined,
    undefined,
    candidate
  )
}
