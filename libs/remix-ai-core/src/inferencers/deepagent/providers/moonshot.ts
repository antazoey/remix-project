import { ChatOpenAI } from '@langchain/openai'
import { endpointUrls } from '@remix-endpoints-helper'
import { remixAILogger } from '../../../helpers/logger'
import { isModelDebugEnabled, modelCallbacks } from '../../../helpers/modelTelemetry'
import { getRemixAuthHeader } from '../../auth'
import { withRetryingFetch } from '../retryTransport'
import { ProviderAdapter } from './types'

/**
 * Moonshot validates that an assistant message carrying `tool_calls` also
 * carries `reasoning_content`, but the field never survives a round-trip
 * through LangChain's message types. We tee the response stream, cache the
 * reasoning against the tool-call ids it belonged to, and re-attach it on the
 * next request.
 */
const reasoningByToolCallKey = new Map<string, string>()
const REASONING_CACHE_MAX = 200

function toolCallKey(toolCalls: any[]): string {
  return toolCalls
    .map((tc) => tc?.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
    .sort()
    .join('|')
}

function cacheReasoning(key: string, reasoning: string): void {
  if (!key || !reasoning) return
  if (reasoningByToolCallKey.size >= REASONING_CACHE_MAX) {
    const firstKey = reasoningByToolCallKey.keys().next().value
    if (firstKey !== undefined) reasoningByToolCallKey.delete(firstKey)
  }
  reasoningByToolCallKey.set(key, reasoning)
}

async function captureReasoningFromSSE(stream: ReadableStream<Uint8Array>): Promise<void> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  let reasoning = ''
  const toolCallsByIndex: Record<number, { id?: string }> = {}
  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop() || ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data:')) continue
        const data = trimmed.slice(5).trim()
        if (!data || data === '[DONE]') continue
        try {
          const json = JSON.parse(data)
          const delta = json?.choices?.[0]?.delta
          if (!delta) continue
          if (typeof delta.reasoning_content === 'string') reasoning += delta.reasoning_content
          if (Array.isArray(delta.tool_calls)) {
            for (const tc of delta.tool_calls) {
              const idx = typeof tc?.index === 'number' ? tc.index : 0
              if (!toolCallsByIndex[idx]) toolCallsByIndex[idx] = {}
              if (typeof tc?.id === 'string' && tc.id) toolCallsByIndex[idx].id = tc.id
            }
          }
        } catch {
          /* not JSON, ignore */
        }
      }
    }
    const ids = Object.values(toolCallsByIndex)
      .map((t) => t.id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0)
    if (ids.length > 0 && reasoning.length > 0) {
      cacheReasoning(ids.sort().join('|'), reasoning)
      if (isModelDebugEnabled()) remixAILogger.log('[Moonshot←] cached reasoning_content for tool_calls', ids, `(${reasoning.length} chars)`)
    }
  } catch (e) {
    if (isModelDebugEnabled()) remixAILogger.warn('[Moonshot←] capture failed', e)
  }
}

function injectReasoning(bodyText: string): string {
  try {
    const body = JSON.parse(bodyText)
    if (!Array.isArray(body?.messages)) return bodyText
    let mutated = false
    for (const m of body.messages) {
      if (
        m &&
        m.role === 'assistant' &&
        Array.isArray(m.tool_calls) &&
        m.tool_calls.length > 0 &&
        (m.reasoning_content === undefined || m.reasoning_content === null)
      ) {
        const key = toolCallKey(m.tool_calls)
        const cached = key ? reasoningByToolCallKey.get(key) : undefined
        // Moonshot validates presence; supply a single-space fallback when we
        // don't have the original (e.g. cache miss across page reload).
        m.reasoning_content = cached ?? ' '
        mutated = true
        if (isModelDebugEnabled()) remixAILogger.log('[Moonshot→] injected reasoning_content', { key, fromCache: !!cached })
      }
    }
    return mutated ? JSON.stringify(body) : bodyText
  } catch {
    return bodyText
  }
}

const moonshotFetch: typeof fetch = async (input, init = {}) => {
  const headers = new Headers(init.headers || {})
  const auth = getRemixAuthHeader()
  if (auth.Authorization) headers.set('Authorization', auth.Authorization)

  let nextInit: RequestInit = { ...init, headers }
  if (typeof nextInit.body === 'string') {
    nextInit = { ...nextInit, body: injectReasoning(nextInit.body) }
  }

  const response = await fetch(input as any, nextInit)
  const ct = response.headers.get('content-type') || ''
  if (response.ok && response.body && ct.includes('event-stream')) {
    const [a, b] = response.body.tee()
    void captureReasoningFromSSE(b)
    return new Response(a, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers
    })
  }
  if (response.ok && ct.includes('application/json')) {
    response
      .clone()
      .json()
      .then((json) => {
        const msg = json?.choices?.[0]?.message
        if (msg?.tool_calls?.length && typeof msg.reasoning_content === 'string') {
          const key = toolCallKey(msg.tool_calls)
          if (key) cacheReasoning(key, msg.reasoning_content)
        }
      })
      .catch(() => {})
  }
  return response
}

export const moonshotAdapter: ProviderAdapter = {
  id: 'moonshot',
  capabilities: { tools: true, streaming: true, reasoning: true, injectableFetch: true },
  async create({ selection, params, label }) {
    remixAILogger.log(`[ModelFactory] Moonshot ${selection.modelId} (proxy) maxTokens=${params.maxOutputTokens}`)
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
        baseURL: `${endpointUrls.langchain}/moonshot/v1`,
        fetch: withRetryingFetch(moonshotFetch, label)
      }
    })
  }
}
