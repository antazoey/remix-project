/**
 * Unit tests for the model harness: parameter resolution, error
 * classification, transport retry, and the Bedrock request normalisation.
 *
 * These were previously untestable — the logic lived inside a 150-line switch
 * in ModelFactory and inside the inferencer — so none of it had coverage.
 */

import tape from 'tape'
import {
  resolveModelParams,
  setModelCatalog,
  PROVIDER_PARAM_DEFAULTS
} from '../src/inferencers/deepagent/modelParams'
import {
  classifyApiError,
  extractRetryAfter
} from '../src/inferencers/deepagent/ApiErrorHandler'
import {
  withRetryingFetch,
  parseRetryAfterHeader
} from '../src/inferencers/deepagent/retryTransport'
import { DeepAgentErrorType } from '../src/types/deepagent'
import {
  AIModel,
  modelSupportsCodeGeneration,
  parseAIModelsFromPermissions
} from '../src/types/models'

function model(partial: Partial<AIModel>): AIModel {
  return {
    id: 'test-model',
    provider: 'anthropic',
    displayName: 'Test',
    description: '',
    category: 'general',
    capabilities: [],
    isDefault: false,
    requiresAuth: false,
    requiredFeature: null,
    available: true,
    sortOrder: 0,
    ...partial
  }
}

tape('resolveModelParams: backend catalogue value wins over the provider default', (t) => {
  setModelCatalog([model({ id: 'm1', provider: 'anthropic', maxOutputTokens: 4096, temperature: 0.2 })])
  const params = resolveModelParams({ provider: 'anthropic', modelId: 'm1' })
  t.equal(params.maxOutputTokens, 4096, 'uses the advertised output limit')
  t.equal(params.temperature, 0.2, 'uses the advertised temperature')
  setModelCatalog([])
  t.end()
})

tape('resolveModelParams: falls back to per-provider defaults when the catalogue is silent', (t) => {
  setModelCatalog([])
  const bedrock = resolveModelParams({ provider: 'bedrock', modelId: 'unknown' })
  t.equal(bedrock.maxOutputTokens, PROVIDER_PARAM_DEFAULTS.bedrock.maxOutputTokens, 'bedrock default')

  const moonshot = resolveModelParams({ provider: 'moonshot', modelId: 'unknown' })
  t.equal(moonshot.temperature, 1, 'moonshot keeps its own temperature')
  t.equal(moonshot.topP, 0.95, 'moonshot keeps its own top_p')
  t.end()
})

tape('resolveModelParams: routeProvider decides the transport defaults', (t) => {
  setModelCatalog([])
  const params = resolveModelParams({ provider: 'anthropic', modelId: 'x', routeProvider: 'ollama' })
  t.equal(params.maxOutputTokens, PROVIDER_PARAM_DEFAULTS.ollama.maxOutputTokens, 'routed through ollama')
  t.end()
})

tape('resolveModelParams: the caller budget is a ceiling, never a raise', (t) => {
  setModelCatalog([model({ id: 'm1', maxOutputTokens: 8192 })])
  t.equal(resolveModelParams({ provider: 'anthropic', modelId: 'm1' }, 1000).maxOutputTokens, 1000,
    'a smaller request lowers the budget')
  t.equal(resolveModelParams({ provider: 'anthropic', modelId: 'm1' }, 999999).maxOutputTokens, 8192,
    'a larger request cannot exceed what the model accepts')
  setModelCatalog([])
  t.end()
})

tape('resolveModelParams: output budget never eats more than half the context window', (t) => {
  setModelCatalog([model({ id: 'm1', maxOutputTokens: 100000, contextWindow: 8000 })])
  const params = resolveModelParams({ provider: 'anthropic', modelId: 'm1' })
  t.equal(params.maxOutputTokens, 4000, 'clamped so the prompt still fits')
  setModelCatalog([])
  t.end()
})

tape('parseAIModelsFromPermissions: reads the runtime params, ignoring junk', (t) => {
  const parsed = parseAIModelsFromPermissions({
    ai_models: [
      { id: 'a', provider: 'anthropic', max_output_tokens: 8192, context_window: 200000, temperature: 0.3, top_p: 0.9, supports_reasoning: true },
      { id: 'b', provider: 'openai', max_output_tokens: 0, context_window: -5, temperature: 'hot' }
    ]
  })
  t.equal(parsed![0].maxOutputTokens, 8192)
  t.equal(parsed![0].contextWindow, 200000)
  t.equal(parsed![0].temperature, 0.3)
  t.equal(parsed![0].topP, 0.9)
  t.equal(parsed![0].supportsReasoning, true)
  t.equal(parsed![1].maxOutputTokens, undefined, 'zero is not a valid limit')
  t.equal(parsed![1].contextWindow, undefined, 'negative is not a valid window')
  t.equal(parsed![1].temperature, undefined, 'non-numeric temperature is dropped')
  t.end()
})

tape('modelSupportsCodeGeneration: reads capabilities, defaults to permissive', (t) => {
  t.equal(modelSupportsCodeGeneration(model({ capabilities: ['chat', 'code'] })), true)
  t.equal(modelSupportsCodeGeneration(model({ capabilities: ['chat'] })), false)
  t.equal(modelSupportsCodeGeneration(model({ capabilities: [] })), true,
    'an empty list means the backend said nothing — do not break subagents')
  t.equal(modelSupportsCodeGeneration(undefined), true)
  t.end()
})

tape('classifyApiError: retryable vs terminal', (t) => {
  t.equal(classifyApiError({ status: 429 }).type, DeepAgentErrorType.RATE_LIMIT_EXCEEDED)
  t.equal(classifyApiError({ status: 429 }).retryable, true)
  t.equal(classifyApiError({ status: 500 }).retryable, true)
  t.equal(classifyApiError({ status: 401 }).retryable, false, 'auth is the user to fix')
  t.equal(classifyApiError({ status: 400 }).retryable, false, 'a bad request fails identically on retry')
  t.equal(classifyApiError({ message: 'insufficient_quota' }).type, DeepAgentErrorType.QUOTA_EXCEEDED)
  t.equal(classifyApiError({ message: 'overloaded' }).type, DeepAgentErrorType.MODEL_OVERLOADED)
  t.end()
})

tape('extractRetryAfter: header wins, else a one-minute default', (t) => {
  t.equal(extractRetryAfter({ headers: { 'retry-after': '12' } }), 12)
  t.equal(extractRetryAfter({}), 60)
  t.end()
})

tape('parseRetryAfterHeader: seconds and HTTP dates', (t) => {
  t.equal(parseRetryAfterHeader('5'), 5000)
  t.equal(parseRetryAfterHeader(null), undefined)
  t.equal(parseRetryAfterHeader('nonsense'), undefined)
  const future = new Date(Date.now() + 10000).toUTCString()
  const parsed = parseRetryAfterHeader(future)
  t.ok(parsed !== undefined && parsed > 5000 && parsed <= 11000, 'HTTP date becomes a delay')
  t.end()
})

tape('withRetryingFetch: retries a 503 and returns the eventual success', async (t) => {
  let calls = 0
  const fake = (async () => {
    calls++
    if (calls < 3) return new Response('overloaded', { status: 503 })
    return new Response('ok', { status: 200 })
  }) as unknown as typeof fetch

  const retrying = withRetryingFetch(fake, 'test', {
    maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 2, maxRetryAfterMs: 30000
  })
  const response = await retrying('https://example.test')
  t.equal(calls, 3, 'retried twice before succeeding')
  t.equal(response.status, 200)
  t.end()
})

tape('withRetryingFetch: does not retry a terminal 400', async (t) => {
  let calls = 0
  const fake = (async () => {
    calls++
    return new Response('bad request', { status: 400 })
  }) as unknown as typeof fetch

  const retrying = withRetryingFetch(fake, 'test', {
    maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 2, maxRetryAfterMs: 30000
  })
  const response = await retrying('https://example.test')
  t.equal(calls, 1, 'called once')
  t.equal(response.status, 400, 'the original response is returned untouched')
  t.end()
})

tape('withRetryingFetch: surfaces a cooldown longer than the policy allows', async (t) => {
  let calls = 0
  const fake = (async () => {
    calls++
    return new Response('slow down', { status: 429, headers: { 'retry-after': '600' } })
  }) as unknown as typeof fetch

  const retrying = withRetryingFetch(fake, 'test', {
    maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 2, maxRetryAfterMs: 30000
  })
  const response = await retrying('https://example.test')
  t.equal(calls, 1, 'a 10-minute cooldown is reported, not waited out')
  t.equal(response.status, 429)
  t.end()
})

tape('withRetryingFetch: gives up after the attempt budget and returns the failure', async (t) => {
  let calls = 0
  const fake = (async () => {
    calls++
    return new Response('nope', { status: 503 })
  }) as unknown as typeof fetch

  const retrying = withRetryingFetch(fake, 'test', {
    maxAttempts: 2, baseDelayMs: 1, maxDelayMs: 2, maxRetryAfterMs: 30000
  })
  const response = await retrying('https://example.test')
  t.equal(calls, 2, 'exactly the attempt budget')
  t.equal(response.status, 503)
  t.end()
})

tape('withRetryingFetch: retries a thrown network error', async (t) => {
  let calls = 0
  const fake = (async () => {
    calls++
    if (calls === 1) throw Object.assign(new Error('ECONNRESET'), { code: 'ECONNRESET' })
    return new Response('ok', { status: 200 })
  }) as unknown as typeof fetch

  const retrying = withRetryingFetch(fake, 'test', {
    maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 2, maxRetryAfterMs: 30000
  })
  const response = await retrying('https://example.test')
  t.equal(calls, 2)
  t.equal(response.status, 200)
  t.end()
})

tape('withRetryingFetch: an abort is never retried', async (t) => {
  let calls = 0
  const fake = (async () => {
    calls++
    throw Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })
  }) as unknown as typeof fetch

  const retrying = withRetryingFetch(fake, 'test', {
    maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 2, maxRetryAfterMs: 30000
  })
  try {
    await retrying('https://example.test')
    t.fail('should have rethrown')
  } catch (e: any) {
    t.equal(e.name, 'AbortError')
    t.equal(calls, 1, 'the user cancelled — do not call again')
  }
  t.end()
})
