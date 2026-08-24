import { ChatOpenAI } from '@langchain/openai'
import { ChatOpenRouter } from '@langchain/openrouter'
import { endpointUrls } from '@remix-endpoints-helper'
import { remixAILogger } from '../../../helpers/logger'
import { modelCallbacks } from '../../../helpers/modelTelemetry'
import { SDK_MAX_RETRIES } from '../retryTransport'
import { proxyFetch } from './authFetch'
import { ProviderAdapter } from './types'

export const openrouterAdapter: ProviderAdapter = {
  id: 'openrouter',
  capabilities: { tools: true, streaming: true, reasoning: true, injectableFetch: true },
  async create({ selection, params, userApiKeys, label }) {
    const useDirectApi = !!(userApiKeys?.useOwnKeys && userApiKeys?.openrouterApiKey)
    remixAILogger.log(`[ModelFactory] OpenRouter ${selection.modelId}${useDirectApi ? ' (direct API)' : ' (proxy)'} maxTokens=${params.maxOutputTokens}`)

    // Own key → talk to OpenRouter directly through its dedicated SDK. It
    // takes no custom fetch, so the SDK carries the retry budget instead.
    if (useDirectApi) {
      return new ChatOpenRouter({
        apiKey: userApiKeys!.openrouterApiKey as string,
        model: selection.modelId,
        temperature: params.temperature,
        topP: params.topP,
        maxTokens: params.maxOutputTokens,
        maxRetries: SDK_MAX_RETRIES,
        callbacks: modelCallbacks(label),
        modelKwargs: {
          usage: { include: true },
          include_reasoning: true
        }
      })
    }

    // No key → route through the Remix proxy (OpenAI-compatible endpoint).
    return new ChatOpenAI({
      apiKey: 'proxy-handled',
      model: selection.modelId,
      temperature: params.temperature,
      topP: params.topP,
      maxTokens: params.maxOutputTokens,
      streaming: true,
      maxRetries: 0,
      callbacks: modelCallbacks(label),
      configuration: {
        baseURL: `${endpointUrls.langchain}/openrouter`,
        fetch: proxyFetch(label)
      }
    })
  }
}
