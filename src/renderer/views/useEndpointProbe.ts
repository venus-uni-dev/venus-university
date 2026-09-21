import { useRef, useState } from 'react'
import { endpointProblem, normalizeEndpoint } from '@shared/endpoint'

import type { ThinkingLevel } from '@shared/providers'
import type { AppError } from '@shared/types'
import { useSettingsStore } from '../stores/settingsStore'

/** What a probe of the custom endpoint has to say: nothing yet, in flight, reached, or why not. */
export type TestState = 'idle' | 'testing' | 'ok' | { error: AppError }

export interface EndpointProbeInput {
  /** Whether the fields describe a custom endpoint at all; nothing is sent while they do not. */
  enabled: boolean
  endpointUrl: string
  /** The endpoint's key as typed; blank sends none, so a stored key is tried. */
  endpointKey: string
  /** The model id as it would be saved (already trimmed). */
  modelId: string
  reasoningEffort: ThinkingLevel
  thinkingLevel: ThinkingLevel
  maxOutputTokens: number | undefined
}

export interface EndpointProbe {
  /** What the endpoint answered when asked which models it serves; empty where it was never asked or could not say. */
  modelIds: string[]
  test: TestState
  /** The one word beside the Test button, null until a probe has run: 'TESTING…' | 'CONNECTED' | 'FAILED'. */
  testWord: string | null
  /** Nothing to send: not a custom endpoint, a URL that cannot be sent to, no model id, or a probe in flight. */
  testDead: boolean
  /** Asks the endpoint which models it serves; a list it cannot give is simply no rows. Ignores stale answers (the URL changed while in flight). */
  refreshModels: () => Promise<void>
  /** Sends one tiny request on the fields as typed. */
  runTest: () => Promise<void>
  /** Forgets the rows and the last verdict — the endpoint they belonged to has been left. */
  reset: () => void
}

/** The one word a probe leaves beside the button, and nothing at all until one has been run. */
function testWordOf(test: TestState): string | null {
  if (test === 'idle') return null
  if (test === 'testing') return 'TESTING…'
  return test === 'ok' ? 'CONNECTED' : 'FAILED'
}

/**
 * The two questions a form asks a custom endpoint — which models it serves, and whether it
 * answers at all — held for whichever screen is asking them. Nothing is sent on its own: the
 * screen decides when a field it would be sent on has been left.
 */
export function useEndpointProbe(input: EndpointProbeInput): EndpointProbe {
  const listModels = useSettingsStore((s) => s.listModels)
  const testWriter = useSettingsStore((s) => s.testWriter)

  // What the endpoint answered when asked which models it serves — the rows under the id
  // fields, and empty wherever it was never asked or could not say.
  const [modelIds, setModelIds] = useState<string[]>([])
  const [test, setTest] = useState<TestState>('idle')

  // The URL the newest probe was sent to: an answer naming any other is stale, the player
  // having typed on while it was in flight.
  const probed = useRef('')

  /** Asks the endpoint which models it serves; a list it cannot give is simply no rows. */
  async function refreshModels(): Promise<void> {
    if (!input.enabled || endpointProblem(input.endpointUrl) !== null) return
    const url = normalizeEndpoint(input.endpointUrl)
    probed.current = url
    const result = await listModels(url, input.endpointKey.trim() || undefined)
    if (probed.current !== url) return
    if (!result.ok) {
      setModelIds([])
      console.warn(`Could not list the models at ${url}: ${result.error.message}`)
      return
    }
    setModelIds(result.data)
  }

  /** Sends one tiny request on the writer fields as typed; what comes back is the whole answer. */
  async function runTest(): Promise<void> {
    setTest('testing')
    const result = await testWriter({
      apiProvider: 'openai',
      apiModel: input.modelId,
      endpointUrl: normalizeEndpoint(input.endpointUrl),
      reasoningEffort: input.reasoningEffort,
      maxOutputTokens: input.maxOutputTokens,
      thinkingLevel: input.thinkingLevel,
      endpointApiKey: input.endpointKey.trim() || undefined
    })
    setTest(result.ok ? 'ok' : { error: result.error })
  }

  /** Forgets the rows and the last verdict, the endpoint they belonged to having been left. */
  function reset(): void {
    setModelIds([])
    setTest('idle')
  }

  return {
    modelIds,
    test,
    testWord: testWordOf(test),
    // Nothing to send while a field it would be sent on is missing, or while one is in flight.
    // An id the endpoint's list lacks is exactly what a probe should be allowed to try.
    testDead:
      !input.enabled ||
      endpointProblem(input.endpointUrl) !== null ||
      input.modelId === '' ||
      test === 'testing',
    refreshModels,
    runTest,
    reset
  }
}
