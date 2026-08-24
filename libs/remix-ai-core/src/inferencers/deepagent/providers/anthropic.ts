import { ChatAnthropic } from '@langchain/anthropic'
import { endpointUrls } from '@remix-endpoints-helper'
import { remixAILogger } from '../../../helpers/logger'
import { modelCallbacks } from '../../../helpers/modelTelemetry'
import { proxyFetch } from './authFetch'
import { ProviderAdapter } from './types'

export const anthropicAdapter: ProviderAdapter = {
  id: 'anthropic',
  capabilities: { tools: true, streaming: true, reasoning: true, injectableFetch: true },
  async create({ selection, params, label }) {
    remixAILogger.log(`[ModelFactory] Anthropic ${selection.modelId} (proxy) maxTokens=${params.maxOutputTokens}`)
    return new ChatAnthropic({
      apiKey: 'proxy-handled',
      model: selection.modelId,
      temperature: params.temperature,
      topP: params.topP,
      maxTokens: params.maxOutputTokens,
      streaming: true,
      // Retry lives in the transport (see retryTransport) so every provider
      // shares one policy — the SDK must not add a second layer.
      maxRetries: 0,
      callbacks: modelCallbacks(label),
      clientOptions: {
        baseURL: endpointUrls.langchain,
        fetch: proxyFetch(label)
      }
    })
  }
}

