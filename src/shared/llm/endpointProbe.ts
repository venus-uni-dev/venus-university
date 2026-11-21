import { endpointProblem, normalizeEndpoint } from '../endpoint'
import { appError, messageOf } from '../errors'
import type { PhotoModelChoice } from '../photos'
import {
  GEMINI_IMAGE_MODELS,
  genericGeminiCaps,
  genericImageCaps,
  imageApiFor,
  providerFor,
  type ImageModelCaps
} from '../providers'
import {
  imageEndpointOf,
  imageModelOf,
  pictureKeyOf,
  storedEndpointKeyFor,
  storedImageKeyFor
} from '../settingsRules'
import type { AppError, ImageCandidate, ImageEndpointCandidate, Settings } from '../types'
import type { ErrorContext } from './adapter'
import { generateImage } from './cloudImage'
import { completeStructured } from './cloudLlm'
import { imageAdapterFor } from './index'
import { imageCapsOf, imagesAdapter } from './imagesAdapter'
import { modelIdsOf, openaiAdapter } from './openaiAdapter'
import { readSettings } from './settingsPort'
import { imageLabelOf } from './transport'

/**
 * The questions the Settings form asks a custom endpoint before anything is saved: which models
 * it and its images URL list, whether one call on the typed writer fields comes back, and whether
 * one picture on the typed image fields does.
 */

/** What the images test draws: a room with nobody in it, like the pictures it stands for. */
const IMAGE_TEST_PROMPT = 'A tidy, sunlit dorm room with a bed, a desk and a window. Nobody in it.'

/**
 * One model listing's body, fetched with a GET; a non-2xx is the `AppError` `errorFor` makes of
 * it, and `label` names the service in both.
 */
async function fetchListing(
  url: string,
  headers: Record<string, string>,
  label: string,
  errorFor: (context: ErrorContext) => AppError
): Promise<string> {
  let response: Response
  try {
    response = await fetch(url, { headers })
  } catch (err) {
    throw appError('LLM_NETWORK', 'Could not reach the endpoint.', messageOf(err))
  }

  const body = await response.text()
  if (!response.ok) {
    throw errorFor({
      status: response.status,
      contentType: (response.headers.get('content-type') ?? '').toLowerCase(),
      body,
      label
    })
  }
  return body
}

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

  const body = await fetchListing(
    url,
    args.apiKey ? { Authorization: `Bearer ${args.apiKey}` } : {},
    label,
    openaiAdapter.errorFor
  )
  return modelIdsOf(body)
}

/**
 * The typed image fields over the stored settings, as a custom endpoint would draw on them. A key
 * field left blank tries the key stored for that origin, so a probe draws on the key a Save would
 * leave.
 */
function imageSettingsOf(stored: Settings, candidate: ImageEndpointCandidate): Settings {
  return {
    ...stored,
    // Named outright: the provider's own write may not have landed when the form asks.
    apiProvider: 'openai',
    imageEndpointUrl: candidate.imageEndpointUrl,
    imageApiKey: candidate.imageApiKey ?? storedImageKeyFor(stored, candidate.imageEndpointUrl),
    endpointUrl: candidate.endpointUrl,
    endpointApiKey:
      candidate.endpointApiKey ?? storedEndpointKeyFor(stored, candidate.endpointUrl ?? '')
  }
}

/**
 * The image model ids the typed images URL lists, on the key a picture there would be drawn
 * with. Google's own host lists nothing without one, so it is not asked.
 */
export async function listImageModels(
  stored: Settings,
  candidate: ImageEndpointCandidate
): Promise<string[]> {
  const settings = imageSettingsOf(stored, candidate)
  const baseUrl = imageEndpointOf(settings)
  const problem = endpointProblem(baseUrl, 'images endpoint URL')
  if (problem) throw appError('LLM_ENDPOINT_INVALID', problem)

  const api = imageApiFor(baseUrl)
  const apiKey = pictureKeyOf(settings)
  if (api === 'gemini' && !apiKey) return []

  const adapter = imageAdapterFor(api)
  const label = imageLabelOf(api)
  const call = adapter.modelsCall(baseUrl, apiKey)
  console.log(`[image] → ${label} models: ${call.url}`)
  return adapter.modelIdsOf(await fetchListing(call.url, call.headers, label, adapter.errorFor))
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
      thinking: 'scenes',
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

/**
 * Draws one picture on the image fields as typed, over the stored settings, and throws away what
 * comes back; the `AppError` it throws is the answer the form reports.
 */
export async function testImages(stored: Settings, candidate: ImageCandidate): Promise<void> {
  await generateImage(IMAGE_TEST_PROMPT, {}, {
    ...imageSettingsOf(stored, candidate),
    imageModel: candidate.imageModel
  })
}

/** Each images root's model listing, parsed, kept for the run so the Create Photo modal asks once per root. */
const photoListingCache = new Map<string, ImageModelCaps[]>()

/**
 * An images-model listing, every entry parsed into what it takes, or `null` for anything that
 * goes wrong reaching or reading it — a network failure here falls back to the generic guess
 * rather than failing the modal.
 */
async function probedImageListing(baseUrl: string, apiKey: string): Promise<ImageModelCaps[] | null> {
  try {
    const call = imagesAdapter.modelsCall(baseUrl, apiKey)
    const response = await fetch(call.url, {
      headers: call.headers,
      signal: AbortSignal.timeout(10_000)
    })
    if (!response.ok) return null
    const body = (await response.json()) as { data?: unknown }
    if (!Array.isArray(body.data)) return null
    const listing: ImageModelCaps[] = []
    for (const entry of body.data) {
      const id = (entry as { id?: unknown } | null)?.id
      if (typeof id === 'string' && id && !listing.some((caps) => caps.id === id)) {
        listing.push(imageCapsOf(entry, id))
      }
    }
    return listing.sort((a, b) => a.label.localeCompare(b.label))
  } catch {
    return null
  }
}

/** The stored model first, then every other one `offered` that can take a reference picture, in order. */
function storedFirst(stored: ImageModelCaps, offered: readonly ImageModelCaps[]): ImageModelCaps[] {
  return [stored, ...offered.filter((caps) => caps.id !== stored.id && caps.maxReferences > 0)]
}

/**
 * The image models a photo may be drawn on under the stored settings, and what each takes: every
 * Gemini image model under Gemini; under a custom endpoint its images model first, then Gemini's
 * own table on Google's host, or anywhere else every model the images host lists that can take a
 * reference picture, by name — a model nobody lists being given a generic guess. Never throws.
 */
export async function photoModelChoice(): Promise<PhotoModelChoice> {
  const settings = await readSettings()
  if (settings.apiProvider !== 'openai') {
    return { models: [...GEMINI_IMAGE_MODELS] }
  }

  const baseUrl = imageEndpointOf(settings)
  const modelId = imageModelOf(settings)
  const api = imageApiFor(baseUrl)

  if (api === 'gemini') {
    const known = GEMINI_IMAGE_MODELS.find((model) => model.id === modelId)
    return { models: storedFirst(known ?? genericGeminiCaps(modelId), GEMINI_IMAGE_MODELS) }
  }

  let listing = photoListingCache.get(baseUrl) ?? null
  if (!listing) {
    listing = await probedImageListing(baseUrl, pictureKeyOf(settings))
    if (listing) photoListingCache.set(baseUrl, listing)
  }
  const stored = listing?.find((caps) => caps.id === modelId) ?? genericImageCaps(modelId)
  return { models: storedFirst(stored, listing ?? []) }
}
