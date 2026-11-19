import { normalizeEndpoint, sameEndpointHost } from './endpoint'
import type { Settings } from './types'

/** Cloud LLM provider table shared with Settings; main adapters key off `api`. */

/** Request/response shape a provider speaks. One adapter exists per value. */
export type ProviderApi = 'gemini' | 'openai'

/** How hard the model reasons before answering, cheapest first. */
export const THINKING_LEVELS = ['minimal', 'low', 'medium', 'high'] as const
export type ThinkingLevel = (typeof THINKING_LEVELS)[number]

function isThinkingLevel(value: unknown): value is ThinkingLevel {
  return THINKING_LEVELS.includes(value as ThinkingLevel)
}

/** Shown in the Settings dropdown. */
export const THINKING_LEVEL_LABELS: Record<ThinkingLevel, string> = {
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High'
}

/** Which inference queue serves a request, in the order Settings lists them, the default first. */
const SERVICE_TIERS = ['priority', 'standard', 'flex'] as const
export type ServiceTier = (typeof SERVICE_TIERS)[number]

function isServiceTier(value: unknown): value is ServiceTier {
  return SERVICE_TIERS.includes(value as ServiceTier)
}

/** Shown in the Settings dropdown. */
export const SERVICE_TIER_LABELS: Record<ServiceTier, string> = {
  priority: 'Priority (default)',
  standard: 'Standard',
  flex: 'Flex'
}

/**
 * What a custom endpoint may be sent as `service_tier`, in the order Settings lists them after
 * None. `default` and `standard` are one tier spelled two ways: OpenAI's and Google's.
 */
export const ENDPOINT_SERVICE_TIERS = ['auto', 'priority', 'default', 'standard', 'flex'] as const
export type EndpointServiceTier = (typeof ENDPOINT_SERVICE_TIERS)[number]

/** Shown in the Settings dropdown. */
export const ENDPOINT_SERVICE_TIER_LABELS: Record<EndpointServiceTier, string> = {
  auto: 'Auto',
  priority: 'Priority',
  default: 'Default',
  standard: 'Standard',
  flex: 'Flex'
}

/** A stored custom-endpoint tier, or undefined for none or anything this build does not offer. */
export function endpointServiceTierFor(stored: unknown): EndpointServiceTier | undefined {
  return ENDPOINT_SERVICE_TIERS.includes(stored as EndpointServiceTier)
    ? (stored as EndpointServiceTier)
    : undefined
}

/** One selectable model with per-model request tuning. */
export interface ModelConfig {
  /** Sent as the request's `model` field. Use the canonical id, not an alias. */
  id: string
  /** Shown in the Settings dropdown. */
  label: string
  /** Which levels this model accepts — a value it does not is a permanent 400. */
  thinkingLevels: readonly ThinkingLevel[]
  /** Used when the stored setting names a level this model does not accept. */
  defaultThinkingLevel: ThinkingLevel
  /** Extra fields this model accepts, merged by its adapter. */
  extraBody?: Record<string, unknown>
}

export interface ProviderConfig {
  label: string
  /** Which adapter speaks to this provider. */
  api: ProviderApi
  /** API root, including the version segment. The adapter appends the rest. */
  baseUrl: string
  /** Every model offered in Settings, in the order the dropdown lists them. */
  models: ModelConfig[]
  /**
   * The model a fresh `settings.json` runs on, by id. **Named rather than the
   * first entry**: the list is ordered newest-first for the player reading it, and which of
   * them is worth its price is a separate judgement that would otherwise have to reorder it.
   */
  defaultModel: string
  /** The second model a fresh file routes the routable kinds to, by id. */
  defaultSecondaryModel: string
  /** Tiers this provider's text models accept; the first is what an absent setting runs on. */
  serviceTiers: readonly ServiceTier[]
  /** Where to get a key; the custom endpoint has no one place. */
  keyUrl?: string
}

/**
 * The resolutions an image model will answer at, smallest first, as both wire formats spell
 * them. Absent from a request means the model's own default, which is what every room
 * background gets.
 */
export const IMAGE_SIZES = ['512', '1K', '2K', '4K'] as const
export type ImageSize = (typeof IMAGE_SIZES)[number]

/** Type guard narrowing an arbitrary value to {@link ImageSize}. */
export function isImageSize(value: unknown): value is ImageSize {
  return IMAGE_SIZES.includes(value as ImageSize)
}

/** The image model behind Gemini's room backgrounds, and a custom endpoint's images model until it names another. */
export const IMAGE_MODEL_ID = 'gemini-3.1-flash-image'

/** The image model behind Gemini's graduation picture. `3`, not `3.1`: the vendor versions the pro image model separately. */
export const ENDING_IMAGE_MODEL_ID = 'gemini-3-pro-image'

/**
 * What one image model takes, as the Create Photo modal offers it: an empty list is a field the
 * model is never sent, and `maxReferences` is how many input images it accepts.
 */
export interface ImageModelCaps {
  /** Sent as the request's model. */
  id: string
  label: string
  sizes: readonly ImageSize[]
  aspectRatios: readonly string[]
  thinkingLevels: readonly ThinkingLevel[]
  qualities: readonly string[]
  maxReferences: number
}

/** Every ratio Gemini's pro image model draws at, the set most image models share. */
const GEMINI_RATIOS = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9']

/** The 3.1 flash image models' ratios: the common set, and the tall and wide extremes beside it. */
const GEMINI_FLASH_RATIOS = [...GEMINI_RATIOS, '1:4', '4:1', '1:8', '8:1']

/**
 * The Gemini image models a photo may be drawn on, the default first. 2.5 is left out: it is
 * retired in October 2026.
 */
export const GEMINI_IMAGE_MODELS: readonly ImageModelCaps[] = [
  {
    id: IMAGE_MODEL_ID,
    label: 'Gemini 3.1 Flash Image',
    sizes: IMAGE_SIZES,
    aspectRatios: GEMINI_FLASH_RATIOS,
    // The only levels it takes; it always thinks, so there is no off.
    thinkingLevels: ['minimal', 'high'],
    qualities: [],
    maxReferences: 14
  },
  {
    id: 'gemini-3.1-flash-lite-image',
    label: 'Gemini 3.1 Flash Lite Image',
    // It draws at 1K alone.
    sizes: ['1K'],
    aspectRatios: GEMINI_FLASH_RATIOS,
    thinkingLevels: ['minimal', 'high'],
    qualities: [],
    maxReferences: 14
  },
  {
    id: ENDING_IMAGE_MODEL_ID,
    label: 'Gemini 3 Pro Image',
    sizes: ['1K', '2K', '4K'],
    aspectRatios: GEMINI_RATIOS,
    // It always thinks, at a level nobody may set.
    thinkingLevels: [],
    qualities: [],
    maxReferences: 14
  }
]

/** What an image model this app has no table entry for is assumed to take, on Google's host. */
export function genericGeminiCaps(id: string): ImageModelCaps {
  return {
    id,
    label: id,
    sizes: ['1K', '2K', '4K'],
    aspectRatios: GEMINI_RATIOS,
    thinkingLevels: [],
    qualities: [],
    maxReferences: 1
  }
}

/** What a model on a host that publishes no model list is assumed to take. */
export function genericImageCaps(id: string): ImageModelCaps {
  return {
    id,
    label: id,
    sizes: ['1K', '2K', '4K'],
    aspectRatios: ['1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9'],
    thinkingLevels: [],
    qualities: [],
    maxReferences: 1
  }
}

const PROVIDERS: Record<ProviderApi, ProviderConfig> = {
  gemini: {
    label: 'Google (Gemini)',
    api: 'gemini',
    // Gemini native REST; every call carries `safetySettings` with the four adjustable
    // categories switched off explicitly.
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    // Text models only: `IMAGE_MODEL_ID` rejects the field with a permanent 400.
    serviceTiers: SERVICE_TIERS,
    keyUrl: 'https://aistudio.google.com/apikey',
    defaultModel: 'gemini-3.6-flash',
    defaultSecondaryModel: 'gemini-3.5-flash-lite',
    models: [
      {
        id: 'gemini-3.8-flash',
        label: 'Gemini 3.8 Flash',
        // 'minimal' is a 400 on 3.8, as on 3.7.
        thinkingLevels: ['low', 'medium', 'high'],
        defaultThinkingLevel: 'low'
      },
      {
        id: 'gemini-3.7-flash',
        label: 'Gemini 3.7 Flash',
        // 'minimal' is a 400 on 3.7.
        thinkingLevels: ['low', 'medium', 'high'],
        defaultThinkingLevel: 'low'
      },
      {
        id: 'gemini-3.6-flash',
        label: 'Gemini 3.6 Flash',
        // 'minimal' is the 3.x floor.
        thinkingLevels: THINKING_LEVELS,
        defaultThinkingLevel: 'minimal'
      },
      {
        id: 'gemini-3.5-flash',
        label: 'Gemini 3.5 Flash',
        thinkingLevels: THINKING_LEVELS,
        defaultThinkingLevel: 'minimal'
      },
      {
        id: 'gemini-3.5-flash-lite',
        label: 'Gemini 3.5 Flash Lite',
        thinkingLevels: THINKING_LEVELS,
        defaultThinkingLevel: 'minimal'
      }
    ]
  },
  openai: {
    label: 'Custom endpoint',
    api: 'openai',
    // The root is the player's, read off the settings at call time by `providerToRun`.
    baseUrl: '',
    // Gemini's queues are not resolved here: a custom endpoint's tier is its own
    // `endpointServiceTier`, which `serviceTierToSend` reads in their place.
    serviceTiers: ['standard'],
    defaultModel: '',
    defaultSecondaryModel: '',
    // Model ids are free text: `modelFor` answers any id with `customModel`.
    models: []
  }
}

/** The wire formats a picture is asked for in: Gemini's native call, or OpenRouter's Images API. */
export type ImageApi = 'gemini' | 'images'

/** The root a custom provider's pictures are asked at until the player names another: Gemini's own. */
export const DEFAULT_IMAGE_ENDPOINT = PROVIDERS.gemini.baseUrl

/** Which format an images URL speaks: Gemini's native call on Google's own host, the Images API anywhere else. */
export function imageApiFor(imageEndpointUrl: string): ImageApi {
  return sameEndpointHost(imageEndpointUrl, DEFAULT_IMAGE_ENDPOINT) ? 'gemini' : 'images'
}

/** The config a custom endpoint's model id runs under: every level accepted, minimal by default. */
function customModel(id: string): ModelConfig {
  return { id, label: id, thinkingLevels: THINKING_LEVELS, defaultThinkingLevel: 'minimal' }
}

/** The config for the configured provider, falling back to the default. */
export function providerFor(apiProvider: ProviderApi): ProviderConfig {
  return PROVIDERS[apiProvider] ?? PROVIDERS.gemini
}

/**
 * The provider a call runs against: the table entry, with the custom endpoint's root taken
 * off the settings. `providerFor` is what Settings reads; this is what the transports read.
 */
export function providerToRun(settings: Settings): ProviderConfig {
  const provider = providerFor(settings.apiProvider)
  if (provider.api !== 'openai') return provider
  return { ...provider, baseUrl: normalizeEndpoint(settings.endpointUrl ?? '') }
}

/** A provider's default model — the one it names, or its first entry; any id off an empty table. */
export function defaultModelFor(apiProvider: ProviderApi): ModelConfig {
  const provider = providerFor(apiProvider)
  if (provider.models.length === 0) return customModel(provider.defaultModel)
  return provider.models.find((model) => model.id === provider.defaultModel) ?? provider.models[0]
}

/** Its default *secondary* model, resolved the same way. */
export function defaultSecondaryModelFor(apiProvider: ProviderApi): ModelConfig {
  const provider = providerFor(apiProvider)
  if (provider.models.length === 0) return customModel(provider.defaultSecondaryModel)
  return (
    provider.models.find((model) => model.id === provider.defaultSecondaryModel) ??
    defaultModelFor(apiProvider)
  )
}

/** A stored model config, falling back to the provider default; an empty table takes the id as it is. */
export function modelFor(apiProvider: ProviderApi, modelId: string): ModelConfig {
  const provider = providerFor(apiProvider)
  if (provider.models.length === 0) return customModel(modelId)
  return provider.models.find((model) => model.id === modelId) ?? defaultModelFor(apiProvider)
}

/**
 * Resolves a stored thinking level against the model that will run, falling back to its default
 * the way `modelFor` falls back to the provider's. An optional `floor` raises the result to the
 * lowest accepted level at or above it, or leaves it if the model accepts none such.
 */
export function thinkingLevelFor(
  apiProvider: ProviderApi,
  modelId: string,
  stored: string,
  floor?: ThinkingLevel
): ThinkingLevel {
  const model = modelFor(apiProvider, modelId)
  const resolved = isThinkingLevel(stored) && model.thinkingLevels.includes(stored)
    ? stored
    : model.defaultThinkingLevel
  return raiseTo(resolved, floor, model.thinkingLevels)
}

/**
 * `level` raised to the lowest of `accepted` at or above `floor`, or left where it is when it
 * already clears the floor, there is no floor, or nothing accepted clears it.
 */
export function raiseTo(
  level: ThinkingLevel,
  floor: ThinkingLevel | undefined,
  accepted: readonly ThinkingLevel[]
): ThinkingLevel {
  if (!floor) return level
  const floorIndex = THINKING_LEVELS.indexOf(floor)
  if (THINKING_LEVELS.indexOf(level) >= floorIndex) return level
  return THINKING_LEVELS.slice(floorIndex).find((candidate) => accepted.includes(candidate)) ?? level
}

/** The next of `accepted` above `level`, or `level` itself where none is. */
export function stepUp(level: ThinkingLevel, accepted: readonly ThinkingLevel[]): ThinkingLevel {
  const above = THINKING_LEVELS.slice(THINKING_LEVELS.indexOf(level) + 1)
  return above.find((candidate) => accepted.includes(candidate)) ?? level
}

/**
 * The level a call names. Gemini reads its own setting, a custom endpoint the reasoning effort
 * beside it — an absent one reading as minimal — and either is resolved against the model that
 * will run, with a floor raising it and `raise` then taking it one accepted level higher.
 */
export function reasoningToSend(
  settings: Settings,
  modelId: string,
  floor?: ThinkingLevel,
  raise?: boolean
): ThinkingLevel {
  const stored =
    settings.apiProvider === 'openai' ? (settings.reasoningEffort ?? '') : settings.thinkingLevel
  const level = thinkingLevelFor(settings.apiProvider, modelId, stored, floor)
  return raise ? stepUp(level, modelFor(settings.apiProvider, modelId).thinkingLevels) : level
}

/**
 * Resolves a stored service tier against the provider that will run, the way
 * `thinkingLevelFor` resolves a level against its model: one it does not offer, or none at all,
 * falls to the provider's first.
 */
export function serviceTierFor(apiProvider: ProviderApi, stored: string | undefined): ServiceTier {
  const provider = providerFor(apiProvider)
  return isServiceTier(stored) && provider.serviceTiers.includes(stored)
    ? stored
    : provider.serviceTiers[0]
}

/**
 * The tier a call names. Gemini resolves its own setting, absent reading as priority; a custom
 * endpoint reads the tier beside its effort, absent or unknown naming none, so a call sends none.
 */
export function serviceTierToSend(
  settings: Settings
): ServiceTier | EndpointServiceTier | undefined {
  if (settings.apiProvider === 'openai') return endpointServiceTierFor(settings.endpointServiceTier)
  return serviceTierFor(settings.apiProvider, settings.serviceTier)
}
