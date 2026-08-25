/**
 * Unit tests for backend-driven model selection — the replacement for the
 * hardcoded fallback ids and the client-side "unsuitable for code generation"
 * model-family blacklist.
 */

import tape from 'tape'
import {
  resolveCodeCapableSelection
} from '../src/inferencers/deepagent/helpers/modelCatalog'
import { resolveBedrockModelId, geoForRegion, ensureToolDescriptions } from '../src/inferencers/deepagent/providers/bedrock'
import { SUPPORTED_TRANSPORTS, isSupportedTransport, getProviderAdapter } from '../src/inferencers/deepagent/providers'
import { AIModel } from '../src/types/models'

function row(partial: Partial<AIModel>): AIModel {
  return {
    id: 'id',
    provider: 'openrouter',
    displayName: '',
    description: '',
    category: 'general',
    capabilities: ['chat', 'code'],
    isDefault: false,
    requiresAuth: false,
    requiredFeature: null,
    available: true,
    sortOrder: 0,
    ...partial
  }
}

/** Stands in for the assistantState plugin. */
function mockPlugin(models: AIModel[], taskModels: Record<string, string> = {}) {
  return {
    call: async (_module: string, method: string, arg?: string) => {
      if (method === 'getAvailableModels') return models
      if (method === 'getModelForTask') return taskModels[arg as string] ?? null
      return null
    }
  } as any
}

tape('resolveCodeCapableSelection: keeps the current model when it is code-capable', async (t) => {
  const plugin = mockPlugin([row({ id: 'good', capabilities: ['chat', 'code'] })])
  const result = await resolveCodeCapableSelection(plugin, { provider: 'openrouter', modelId: 'good' })
  t.equal(result, null, 'null means "no substitution needed"')
  t.end()
})

tape('resolveCodeCapableSelection: swaps out a model the backend says cannot code', async (t) => {
  const plugin = mockPlugin([
    row({ id: 'weak', capabilities: ['chat'] }),
    row({ id: 'strong', capabilities: ['chat', 'code'] })
  ])
  const result = await resolveCodeCapableSelection(plugin, { provider: 'openrouter', modelId: 'weak' })
  t.equal(result?.modelId, 'strong')
  t.end()
})

tape('resolveCodeCapableSelection: the backend task assignment wins', async (t) => {
  const plugin = mockPlugin(
    [row({ id: 'weak', capabilities: ['chat'] }), row({ id: 'assigned' }), row({ id: 'other' })],
    { code_generation: 'assigned' }
  )
  const result = await resolveCodeCapableSelection(plugin, { provider: 'openrouter', modelId: 'weak' })
  t.equal(result?.modelId, 'assigned')
  t.end()
})

tape('resolveCodeCapableSelection: prefers a candidate on the same transport', async (t) => {
  const plugin = mockPlugin([
    row({ id: 'weak', capabilities: ['chat'], provider: 'bedrock' }),
    row({ id: 'elsewhere', provider: 'openrouter', routeProvider: 'openrouter' }),
    row({ id: 'same-route', provider: 'bedrock', routeProvider: 'bedrock' })
  ])
  const result = await resolveCodeCapableSelection(plugin, { provider: 'bedrock', modelId: 'weak' })
  t.equal(result?.modelId, 'same-route', 'keeps the request path unchanged')
  t.equal(result?.routeProvider, 'bedrock')
  t.end()
})

tape('resolveCodeCapableSelection: returns null rather than guessing when the catalogue is empty', async (t) => {
  const result = await resolveCodeCapableSelection(mockPlugin([]), { provider: 'openrouter', modelId: 'x' })
  t.equal(result, null, 'the caller keeps its own model — no literal fallback id')
  t.end()
})

tape('resolveCodeCapableSelection: survives assistantState being unavailable', async (t) => {
  const broken = { call: async () => { throw new Error('plugin not active') } } as any
  const result = await resolveCodeCapableSelection(broken, { provider: 'openrouter', modelId: 'x' })
  t.equal(result, null)
  t.end()
})

tape('resolveBedrockModelId: rewrites the geo prefix to match the region', (t) => {
  t.equal(resolveBedrockModelId('us.anthropic.claude-sonnet-4', 'eu-west-1'), 'eu.anthropic.claude-sonnet-4')
  t.equal(resolveBedrockModelId('eu.anthropic.claude-sonnet-4', 'ap-southeast-2'), 'apac.anthropic.claude-sonnet-4')
  t.equal(resolveBedrockModelId('us.anthropic.claude-sonnet-4', 'us-east-1'), 'us.anthropic.claude-sonnet-4')
  t.equal(resolveBedrockModelId('anthropic.claude-v2', 'eu-west-1'), 'anthropic.claude-v2',
    'a plain model id has no inference profile to rewrite')
  t.end()
})

tape('geoForRegion: gov regions are not plain us', (t) => {
  t.equal(geoForRegion('us-gov-west-1'), 'us-gov')
  t.equal(geoForRegion('us-east-1'), 'us')
  t.equal(geoForRegion('eu-central-1'), 'eu')
  t.equal(geoForRegion('ap-northeast-1'), 'apac')
  t.equal(geoForRegion('sa-east-1'), 'us', 'unmapped regions fall back to us')
  t.end()
})

tape('ensureToolDescriptions: backfills the empty descriptions Bedrock rejects', (t) => {
  const tools: any[] = [
    { name: 'write_todos', description: '' },
    { name: 'ls', description: 'List files.' },
    { type: 'function', function: { name: 'task', description: '   ' } },
    null
  ]
  const out = ensureToolDescriptions(tools)
  t.equal(out[0].description, 'The write_todos tool.')
  t.equal(out[1].description, 'List files.', 'a real description is left alone')
  t.equal(out[2].function.description, 'The task tool.')
  t.equal(out[3], null, 'non-objects pass through')
  t.end()
})

tape('provider registry: exactly three transports, and brands are refused', (t) => {
  t.deepEqual([...SUPPORTED_TRANSPORTS].sort(), ['bedrock', 'ollama', 'openrouter'])
  for (const transport of SUPPORTED_TRANSPORTS) {
    t.equal(getProviderAdapter(transport).id, transport, `${transport} resolves to its own adapter`)
  }

  // The old registry defaulted anything unrecognised to an Anthropic adapter,
  // so a row with a stale transport quietly built a client for the wrong
  // provider and failed later with an unrelated message.
  for (const brand of ['anthropic', 'openai', 'mistralai', 'moonshot', undefined]) {
    t.throws(() => getProviderAdapter(brand as any), /is not a transport/, `${brand} is rejected by name`)
    t.equal(isSupportedTransport(brand as any), false)
  }
  t.end()
})

tape('the harness never substitutes the model the user picked', (t) => {
  // A run that fails is reported against the chosen model. Automatically
  // re-running on a different one silently overrode a deliberate choice —
  // and because the swap went through `updateAgentModel`, which reassigns
  // `this.modelSelection`, it persisted into every later turn while the
  // picker still displayed the original.
  const source = require('fs').readFileSync(
    require('path').join(__dirname, '../src/inferencers/deepagent/DeepAgentInferencer.ts'),
    'utf8'
  )
  t.equal(source.includes('tryDegradeAfterFailure'), false, 'no automatic degrade path')
  t.equal(source.includes('DEGRADABLE_ERRORS'), false, 'no degradable-error set')
  t.end()
})
