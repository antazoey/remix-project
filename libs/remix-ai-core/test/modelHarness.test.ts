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
import { getProviderAdapter } from '../src/inferencers/deepagent/providers'
import {
  AIModel,
  isAutoModelId,
  modelSupportsCodeGeneration,
  parseAIModelsFromPermissions
} from '../src/types/models'

function model(partial: Partial<AIModel>): AIModel {
  return {
    id: 'test-model',
    provider: 'openrouter',
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
  setModelCatalog([model({ id: 'm1', provider: 'openrouter', maxOutputTokens: 4096, temperature: 0.2 })])
  const params = resolveModelParams({ provider: 'openrouter', modelId: 'm1' })
  t.equal(params.maxOutputTokens, 4096, 'uses the advertised output limit')
  t.equal(params.temperature, 0.2, 'uses the advertised temperature')
  setModelCatalog([])
  t.end()
})

tape('resolveModelParams: falls back to per-transport defaults when the catalogue is silent', (t) => {
  setModelCatalog([])
  const bedrock = resolveModelParams({ provider: 'bedrock', modelId: 'unknown' })
  t.equal(bedrock.maxOutputTokens, PROVIDER_PARAM_DEFAULTS.bedrock.maxOutputTokens, 'bedrock default')

  const ollama = resolveModelParams({ provider: 'ollama', modelId: 'unknown' })
  t.equal(ollama.maxOutputTokens, PROVIDER_PARAM_DEFAULTS.ollama.maxOutputTokens, 'local hardware default')
  t.end()
})

tape('resolveModelParams: there are exactly three transports', (t) => {
  t.deepEqual(Object.keys(PROVIDER_PARAM_DEFAULTS).sort(), ['bedrock', 'ollama', 'openrouter'],
    'the vendor brands route through OpenRouter and are not transports')
  t.end()
})

tape('resolveModelParams: a brand arriving as a transport falls back to OpenRouter defaults', (t) => {
  setModelCatalog([])
  // A row missing its `routeProvider`. ModelFactory reports the real problem;
  // the params resolver just must not crash picking a default.
  const params = resolveModelParams({ provider: 'openrouter', modelId: 'x' })
  t.equal(params.maxOutputTokens, PROVIDER_PARAM_DEFAULTS.openrouter.maxOutputTokens)
  t.end()
})

tape('resolveModelParams: routeProvider decides the transport defaults', (t) => {
  setModelCatalog([])
  const params = resolveModelParams({ provider: 'openrouter', modelId: 'x', routeProvider: 'ollama' })
  t.equal(params.maxOutputTokens, PROVIDER_PARAM_DEFAULTS.ollama.maxOutputTokens, 'routed through ollama')
  t.end()
})

tape('resolveModelParams: the caller budget is a ceiling, never a raise', (t) => {
  setModelCatalog([model({ id: 'm1', maxOutputTokens: 8192 })])
  t.equal(resolveModelParams({ provider: 'openrouter', modelId: 'm1' }, 1000).maxOutputTokens, 1000,
    'a smaller request lowers the budget')
  t.equal(resolveModelParams({ provider: 'openrouter', modelId: 'm1' }, 999999).maxOutputTokens, 8192,
    'a larger request cannot exceed what the model accepts')
  setModelCatalog([])
  t.end()
})

tape('resolveModelParams: output budget never eats more than half the context window', (t) => {
  setModelCatalog([model({ id: 'm1', maxOutputTokens: 100000, contextWindow: 8000 })])
  const params = resolveModelParams({ provider: 'openrouter', modelId: 'm1' })
  t.equal(params.maxOutputTokens, 4000, 'clamped so the prompt still fits')
  setModelCatalog([])
  t.end()
})

tape('parseAIModelsFromPermissions: reads the runtime params, ignoring junk', (t) => {
  const parsed = parseAIModelsFromPermissions({
    ai_models: [
      { id: 'a', provider: 'openrouter', max_output_tokens: 8192, context_window: 200000, temperature: 0.3, top_p: 0.9, supports_reasoning: true },
      { id: 'b', provider: 'bedrock', max_output_tokens: 0, context_window: -5, temperature: 'hot' }
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

tape('classifyApiError: socket-level failures are retryable network errors', (t) => {
  // These needles were previously tested in upper case against a lower-cased
  // message, so none of them ever matched and every one classified UNKNOWN.
  for (const message of ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'ENOTFOUND']) {
    const { retryable } = classifyApiError({ message })
    t.equal(retryable, true, `${message} is retryable`)
  }
  t.equal(classifyApiError({ code: 'ECONNRESET' }).type, DeepAgentErrorType.NETWORK_ERROR, 'by code too')
  t.end()
})

tape('classifyApiError: the SDK "Connection error." is a retryable network error', (t) => {
  // Seen repeatedly in production traces, previously classified UNKNOWN and
  // therefore never retried.
  const { type, retryable } = classifyApiError({ message: 'Connection error.' })
  t.equal(type, DeepAgentErrorType.NETWORK_ERROR)
  t.equal(retryable, true)
  t.equal(classifyApiError({ message: 'Failed to fetch' }).retryable, true)
  t.end()
})

tape('classifyApiError: a content-policy rejection is terminal, not unknown', (t) => {
  const { type, retryable } = classifyApiError({ message: 'PROHIBITED_CONTENT' })
  t.equal(type, DeepAgentErrorType.CONTENT_BLOCKED)
  t.equal(retryable, false, 'the same prompt gets the same answer — never retry or degrade')
  t.end()
})

tape('isAutoModelId: router pseudo-models are never a concrete selection', (t) => {
  // Selecting one as a static model produced
  // `403 Model 'openrouter/auto' is not available` on every request.
  t.equal(isAutoModelId('openrouter/auto'), true)
  t.equal(isAutoModelId('auto'), true)
  t.equal(isAutoModelId('OpenRouter/Auto'), true, 'case-insensitive')
  t.equal(isAutoModelId('anthropic/claude-sonnet-5'), false)
  t.equal(isAutoModelId('gpt-auto-tuner'), false, 'only a trailing /auto segment counts')
  t.equal(isAutoModelId(undefined), false)
  t.end()
})

tape('classifyApiError: a bare LangGraph "Abort" is not silently unknown-retryable', (t) => {
  // `Error("Abort")` escapes LangGraph whenever a node throws (the runner's
  // exception signal races the graph into an abort). It must never be retried
  // blindly — the underlying node failure decides that.
  const { retryable } = classifyApiError({ message: 'Abort' })
  t.equal(retryable, false)
  t.end()
})

tape('classifyApiError: a timeout abort is retryable, a user abort is not misread', (t) => {
  t.equal(classifyApiError({ name: 'TimeoutError', message: 'Agent run exceeded 300000ms.' }).type,
    DeepAgentErrorType.REQUEST_TIMEOUT)
  t.equal(classifyApiError({ name: 'TimeoutError', message: 'Agent run exceeded 300000ms.' }).retryable, true)
  t.end()
})

tape('parseAIModelsFromPermissions: a vendor brand from the backend is routed, never left as a transport', (t) => {
  // The wire field is a plain string, so the ModelTransport type does nothing
  // at runtime. A brand left untouched reaches getProviderAdapter and throws,
  // which fails every prompt — including a plain "hello".
  const parsed = parseAIModelsFromPermissions({
    ai_models: [
      { id: 'anthropic/claude-sonnet-5', provider: 'anthropic' },
      { id: 'gpt-5', provider: 'openai' },
      { id: 'kimi', provider: 'moonshot' },
      { id: 'weird', provider: 'some-new-vendor' }
    ]
  })!
  for (const row of parsed) {
    t.equal(row.provider, 'openrouter', `${row.id} is branded onto the router`)
    t.equal(row.routeProvider, 'openrouter', `${row.id} carries an explicit transport`)
  }
  t.end()
})

tape('parseAIModelsFromPermissions: real transports pass through untouched', (t) => {
  const parsed = parseAIModelsFromPermissions({
    ai_models: [
      { id: 'a', provider: 'openrouter' },
      { id: 'b', provider: 'bedrock' },
      { id: 'c', provider: 'ollama' }
    ]
  })!
  t.deepEqual(parsed.map((m) => m.provider), ['openrouter', 'bedrock', 'ollama'])
  t.equal(parsed[1].routeProvider, undefined, 'bedrock needs no route rewrite')
  t.end()
})

tape('parseAIModelsFromPermissions: an explicit backend route_provider wins', (t) => {
  const parsed = parseAIModelsFromPermissions({
    ai_models: [
      { id: 'x', provider: 'anthropic', route_provider: 'bedrock' },
      { id: 'y', provider: 'openrouter', route_provider: 'nonsense' }
    ]
  })!
  t.equal(parsed[0].routeProvider, 'bedrock', 'a valid explicit route is honoured')
  t.equal(parsed[0].provider, 'bedrock', 'and the brand follows it')
  t.equal(parsed[1].provider, 'openrouter', 'an invalid route falls back to the provider')
  t.end()
})

tape('every parsed row resolves to a real adapter', (t) => {
  // The end-to-end guarantee: whatever /permissions sends, ModelFactory can
  // build it. This is the invariant whose absence broke "hello".
  const parsed = parseAIModelsFromPermissions({
    ai_models: [
      { id: 'a', provider: 'anthropic' },
      { id: 'b', provider: 'mistralai' },
      { id: 'c', provider: 'bedrock' },
      { id: 'd', provider: 'ollama' },
      { id: 'e', provider: 'totally-unknown' }
    ]
  })!
  for (const row of parsed) {
    const transport = row.routeProvider ?? row.provider
    t.doesNotThrow(() => getProviderAdapter(transport), `${row.id} → ${transport} builds`)
  }
  t.end()
})
