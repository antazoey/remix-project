import { ChatMistralAI } from '@langchain/mistralai'
import { HTTPClient } from '@mistralai/mistralai/lib/http.js'
import { endpointUrls } from '@remix-endpoints-helper'
import { remixAILogger } from '../../../helpers/logger'
import { isModelDebugEnabled, modelCallbacks } from '../../../helpers/modelTelemetry'
import { getRemixAuthHeader } from '../../auth'
import { SDK_MAX_RETRIES } from '../retryTransport'
import { ProviderAdapter } from './types'

/**
 * The Mistral SDK takes an HTTPClient rather than a fetch, so the shared
 * retrying transport does not apply — the SDK's own `maxRetries` carries the
 * same budget instead.
 */
async function dumpRequest(req: Request): Promise<void> {
  try {
    const cloned = req.clone()
    const text = await cloned.text()
    let parsed: any = text
    try { parsed = JSON.parse(text) } catch { /* not json */ }
    remixAILogger.groupCollapsed(`[Mistral→] ${req.method} ${req.url}`)
    remixAILogger.log('body:', parsed)
    remixAILogger.groupEnd()
  } catch (e) {
    remixAILogger.warn('[Mistral→] failed to dump request', e)
  }
}

function createAuthedHttpClient(): HTTPClient {
  const client = new HTTPClient()
  client.addHook('beforeRequest', (req) => {
    const auth = getRemixAuthHeader()
    let next: Request = req
    if (auth.Authorization) {
      // Always overwrite: the Mistral SDK stamps a placeholder
      // 'Authorization: Bearer proxy-handled' from the dummy apiKey, which
      // would shadow the real Remix bearer token if we only set-when-missing.
      next = new Request(req, { headers: new Headers(req.headers) })
      next.headers.set('Authorization', auth.Authorization)
    }
    if (isModelDebugEnabled()) void dumpRequest(next)
    return next
  })
  return client
}

export const mistralAdapter: ProviderAdapter = {
  id: 'mistralai',
  // Mistral's adapter rejects content blocks other than text / image_url —
  // the telemetry handler flags those before the conversion throws.
  capabilities: { tools: true, streaming: true, reasoning: false, injectableFetch: false },
  async create({ selection, params, label }) {
    remixAILogger.log(`[ModelFactory] MistralAI ${selection.modelId} (proxy) maxTokens=${params.maxOutputTokens}`)
    return new ChatMistralAI({
      apiKey: 'proxy-handled',
      model: selection.modelId,
      temperature: params.temperature,
      topP: params.topP,
      maxTokens: params.maxOutputTokens,
      streaming: true,
      maxRetries: SDK_MAX_RETRIES,
      callbacks: modelCallbacks(label),
      serverURL: `${endpointUrls.langchain}/mistral`,
      httpClient: createAuthedHttpClient()
    })
  }
}
