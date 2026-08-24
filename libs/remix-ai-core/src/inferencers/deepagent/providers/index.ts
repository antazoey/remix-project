import { ModelProvider } from '../../../types/deepagent'
import { anthropicAdapter } from './anthropic'
import { bedrockAdapter } from './bedrock'
import { mistralAdapter } from './mistral'
import { moonshotAdapter } from './moonshot'
import { ollamaAdapter } from './ollama'
import { openaiAdapter } from './openai'
import { openrouterAdapter } from './openrouter'
import { ProviderAdapter } from './types'

/**
 * The provider registry.
 *
 * Adding a provider is a new file plus one entry here — no edit to a shared
 * switch, and no risk of disturbing the other six while doing it.
 */
export const PROVIDER_ADAPTERS: Record<ModelProvider, ProviderAdapter> = {
  anthropic: anthropicAdapter,
  openai: openaiAdapter,
  openrouter: openrouterAdapter,
  mistralai: mistralAdapter,
  moonshot: moonshotAdapter,
  bedrock: bedrockAdapter,
  ollama: ollamaAdapter
}

export function getProviderAdapter(provider: ModelProvider | string | undefined): ProviderAdapter {
  const adapter = PROVIDER_ADAPTERS[provider as ModelProvider]
  // Anthropic remains the implicit default, as it was in the original switch.
  return adapter ?? PROVIDER_ADAPTERS.anthropic
}

export function getProviderCapabilities(provider: ModelProvider | string | undefined) {
  return getProviderAdapter(provider).capabilities
}

export * from './types'
export { resolveBedrockModelId, ensureToolDescriptions, geoForRegion, DEFAULT_BEDROCK_REGION } from './bedrock'
