import { normalizeEndpoint } from './endpoint'
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

/** Which inference queue serves a request, cheapest first. */
const SERVICE_TIERS = ['standard', 'priority'] as const
export type ServiceTier = (typeof SERVICE_TIERS)[number]

function isServiceTier(value: unknown): value is ServiceTier {
  return SERVICE_TIERS.includes(value as ServiceTier)
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
  /** Tiers this provider's text models accept. */
  serviceTiers: readonly ServiceTier[]
  /** Where to get a key; the custom endpoint has no one place. */
  keyUrl?: string
}

/**
 * The resolutions an image model will answer at. Absent from a request
 * means the model's own default, which is what every room background gets.
 */
const IMAGE_SIZES = ['1K', '2K', '4K'] as const
export type ImageSize = (typeof IMAGE_SIZES)[number]

/** The image model behind room backgrounds. */
export const IMAGE_MODEL_ID = 'gemini-3.1-flash-image'

/** The image model behind the graduation picture. `3`, not `3.1`: the vendor versions the pro image model separately. */
export const ENDING_IMAGE_MODEL_ID = 'gemini-3-pro-image'

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
    // The custom adapter sends no tier field, so only the tier that sends nothing is offered.
    serviceTiers: ['standard'],
    defaultModel: '',
    defaultSecondaryModel: '',
    // Model ids are free text: `modelFor` answers any id with `customModel`.
    models: []
  }
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

/**
 * The level a call names. Gemini reads its own setting, a custom endpoint the reasoning effort
 * beside it — an absent one reading as minimal — and either is resolved against the model that
 * will run, with a floor raising it.
 */
export function reasoningToSend(
  settings: Settings,
  modelId: string,
  floor?: ThinkingLevel
): ThinkingLevel {
  const stored =
    settings.apiProvider === 'openai' ? (settings.reasoningEffort ?? '') : settings.thinkingLevel
  return thinkingLevelFor(settings.apiProvider, modelId, stored, floor)
}

/**
 * Resolves a stored service tier against the provider that will run, the way
 * `thinkingLevelFor` resolves a level against its model.
 */
export function serviceTierFor(apiProvider: ProviderApi, stored: string): ServiceTier {
  const provider = providerFor(apiProvider)
  return isServiceTier(stored) && provider.serviceTiers.includes(stored) ? stored : 'standard'
}
