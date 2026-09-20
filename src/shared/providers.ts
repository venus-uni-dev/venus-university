import type { Settings } from './types'

/** Cloud LLM provider table shared with Settings; main adapters key off `api`. */

/** Request/response shape a provider speaks. One adapter exists per value. */
export type ProviderApi = 'gemini'

/** How hard the model reasons before answering, cheapest first. */
const THINKING_LEVELS = ['minimal', 'low', 'medium', 'high'] as const
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
  /** Where to get a key, shown in Settings. */
  keyUrl: string
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

const PROVIDERS: Record<Settings['apiProvider'], ProviderConfig> = {
  gemini: {
    label: 'Google (Gemini)',
    api: 'gemini',
    // Gemini native REST, which can send `safetySettings`.
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
  }
}

/** The config for the configured provider, falling back to the default. */
export function providerFor(apiProvider: Settings['apiProvider']): ProviderConfig {
  return PROVIDERS[apiProvider] ?? PROVIDERS.gemini
}

/** A provider's default model — the one it names, or its first entry. */
export function defaultModelFor(apiProvider: Settings['apiProvider']): ModelConfig {
  const provider = providerFor(apiProvider)
  return provider.models.find((model) => model.id === provider.defaultModel) ?? provider.models[0]
}

/** Its default *secondary* model, resolved the same way. */
export function defaultSecondaryModelFor(apiProvider: Settings['apiProvider']): ModelConfig {
  const provider = providerFor(apiProvider)
  return (
    provider.models.find((model) => model.id === provider.defaultSecondaryModel) ??
    defaultModelFor(apiProvider)
  )
}

/** Returns a stored model config, falling back to the provider default. */
export function modelFor(apiProvider: Settings['apiProvider'], modelId: string): ModelConfig {
  const provider = providerFor(apiProvider)
  return provider.models.find((model) => model.id === modelId) ?? defaultModelFor(apiProvider)
}

/**
 * Resolves a stored thinking level against the model that will run, falling back to its default
 * the way `modelFor` falls back to the provider's. An optional `floor` raises the result to the
 * lowest accepted level at or above it, or leaves it if the model accepts none such.
 */
export function thinkingLevelFor(
  apiProvider: Settings['apiProvider'],
  modelId: string,
  stored: string,
  floor?: ThinkingLevel
): ThinkingLevel {
  const model = modelFor(apiProvider, modelId)
  const resolved = isThinkingLevel(stored) && model.thinkingLevels.includes(stored)
    ? stored
    : model.defaultThinkingLevel
  if (!floor) return resolved

  const floorIndex = THINKING_LEVELS.indexOf(floor)
  if (THINKING_LEVELS.indexOf(resolved) >= floorIndex) return resolved
  const raised = THINKING_LEVELS.slice(floorIndex).find((level) =>
    model.thinkingLevels.includes(level)
  )
  return raised ?? resolved
}

/**
 * Resolves a stored service tier against the provider that will run, the way
 * `thinkingLevelFor` resolves a level against its model.
 */
export function serviceTierFor(
  apiProvider: Settings['apiProvider'],
  stored: string
): ServiceTier {
  const provider = providerFor(apiProvider)
  return isServiceTier(stored) && provider.serviceTiers.includes(stored) ? stored : 'standard'
}
