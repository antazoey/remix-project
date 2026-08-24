import { ChatOpenAI } from '@langchain/openai'
import { endpointUrls } from '@remix-endpoints-helper'
import { remixAILogger } from '../../../helpers/logger'
import { modelCallbacks } from '../../../helpers/modelTelemetry'
import { proxyFetch } from './authFetch'
import { ProviderAdapter } from './types'

export const openaiAdapter: ProviderAdapter = {
  id: 'openai',
  capabilities: { tools: true, streaming: true, reasoning: true, injectableFetch: true },
  async create({ selection, params, label }) {
    remixAILogger.log(`[ModelFactory] OpenAI ${selection.modelId} (proxy) maxTokens=${params.maxOutputTokens}`)
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
        baseURL: `${endpointUrls.langchain}/openai`,
        fetch: proxyFetch(label)
      }
    })
  }
}
