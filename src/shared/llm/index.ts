import type { ProviderApi, ProviderConfig } from '../providers'
import type { LlmAdapter } from './adapter'
import { geminiAdapter } from './geminiAdapter'
import { openaiAdapter } from './openaiAdapter'

/** Adapter registry keyed by `ProviderApi`; `Record` makes missing adapters compile-time errors. */
const ADAPTERS: Record<ProviderApi, LlmAdapter> = {
  gemini: geminiAdapter,
  openai: openaiAdapter
}

/** The adapter that speaks a provider's API shape. */
export function adapterFor(provider: ProviderConfig): LlmAdapter {
  return ADAPTERS[provider.api]
}

export type { LlmAdapter, StructuredRequest } from './adapter'
