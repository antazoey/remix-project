import { IParams } from './types';
import { Features } from '@remix-api';
import { ModelProvider, ModelTransport } from './deepagent';

/**
 * Model registry entry.
 *
 * The authoritative list lives on the backend (`/permissions` →
 * `ai_models[]`) and is fetched per-user. The fields below mirror that
 * payload one-for-one (snake_case → camelCase). For anonymous users we
 * use the small `ANONYMOUS_FALLBACK_MODELS` list further down.
 */
export interface AIModel {
  id: string
  /** Display brand — what the picker groups under. Not how we reach the model. */
  provider: ModelProvider
  /**
   * The transport that carries the request. Only the three real transports
   * are valid here; a vendor brand reaching us as a route is a backend bug,
   * and `getProviderAdapter` rejects it by name rather than guessing.
   */
  routeProvider?: ModelTransport
  /** Display name as the backend wants it shown. */
  displayName: string
  description: string
  category: 'coding' | 'general' | 'local'
  capabilities: string[]
  isDefault: boolean
  /** Informational; does NOT gate selection on its own — `available` does. */
  requiresAuth: boolean
  /** ai:* feature key that gates this model, or null when always allowed. */
  requiredFeature: string | null
  /** False → render greyed-out + lock icon; click opens planManager / sign-in. */
  available: boolean
  /** Backend-supplied reason when `available === false`. e.g. 'feature_required'. */
  reason?: string
  requireAPIKey?: boolean
  /** Backend ordering hint. */
  sortOrder: number

  // ── Runtime parameters ────────────────────────────────────────────────
  // The backend is the source of truth for how a model must be *driven*,
  // exactly as it is for whether the model may be used at all. Every field
  // below is optional: `resolveModelParams` falls back to a per-provider
  // default when the backend hasn't advertised one, so an older payload
  // keeps working. Never hardcode these per model id on the client.

  /** Max output tokens this model accepts. Backend `max_output_tokens`. */
  maxOutputTokens?: number
  /** Total context window in tokens. Backend `context_window`. */
  contextWindow?: number
  /** Sampling temperature this model should run at. Backend `temperature`. */
  temperature?: number
  /** Nucleus sampling. Backend `top_p`. */
  topP?: number
  /** Model emits reasoning/thinking content. Backend `supports_reasoning`. */
  supportsReasoning?: boolean
}

/** Backwards-compat alias — old code reads `model.name`. */
export type AIModelLegacy = AIModel & { name: string }

/** Always-on local entry — appended to every model list. */
export const OLLAMA_MODEL: AIModel = {
  id: 'ollama',
  provider: 'ollama',
  displayName: 'Local Models (Ollama)',
  description: 'Run AI models locally on your machine',
  category: 'local',
  capabilities: ['chat', 'code', 'completion'],
  isDefault: false,
  requiresAuth: false,
  requiredFeature: null,
  available: true,
  sortOrder: 1000
}

/**
 * Anonymous fallback. The picker shows a single placeholder row that
 * tells the user to sign in (clicking opens planManager(auth-required))
 * plus the always-available Ollama entry.
 *
 * Once `/permissions` resolves, the assistant-state plugin replaces
 * this list with the backend-provided `ai_models` array.
 */
export const ANONYMOUS_PLACEHOLDER_MODEL: AIModel = {
  id: '__signin__',
  provider: 'mistralai',
  displayName: 'Sign in to use AI models',
  description: 'Sign in to your Remix account to access AI features.',
  category: 'general',
  capabilities: [],
  isDefault: true,
  requiresAuth: true,
  requiredFeature: null,
  available: false,
  reason: 'auth_required',
  sortOrder: 0
}

/**
 * Anonymous users have no AI access — only the sign-in placeholder.
 * Ollama is gated by the `ai:ollama` feature; logged-out users don't
 * have any features, so they don't get Ollama either.
 */
export const ANONYMOUS_FALLBACK_MODELS: AIModel[] = [
  ANONYMOUS_PLACEHOLDER_MODEL
]

/**
 * NO bootstrap default model. The chat-default is whichever row the
 * backend marks `is_default: true` in `permissions.ai_models[]`. Read
 * it via `assistantState.getDefaultModel()` (or `selectDefaultModel(snap)`).
 *
 * If you find yourself wanting a literal model id here, you have a bug:
 *   - For "user just opened the app" → selectedModel should be `null`
 *     until /permissions resolves. Render a "Loading…" state.
 *   - For "task X needs model Y" → backend advertises that via
 *     `permissions.task_models[X]`. Read with `assistantState.getModelForTask('X')`.
 *   - For "Ollama / anonymous fallback" → ANONYMOUS_FALLBACK_MODELS.
 *
 * Anything else MUST throw rather than silently substitute.
 */
export function getModelById(id: string, list: ReadonlyArray<AIModel> = ANONYMOUS_FALLBACK_MODELS): AIModel | undefined {
  return list.find(m => m.id === id)
}

export function modelKey(model: Pick<AIModel, 'provider' | 'id'>): string {
  return `${model.provider}::${model.id}`
}

export function parseModelKey(key: string): { provider?: string; id: string } {
  const idx = key.indexOf('::')
  if (idx === -1) return { id: key }
  return { provider: key.slice(0, idx), id: key.slice(idx + 2) }
}

export function findModel(
  list: ReadonlyArray<AIModel>,
  id: string,
  provider?: string
): AIModel | undefined {
  if (provider) return list.find(m => m.id === id && m.provider === provider)
  return list.find(m => m.id === id)
}

/**
 * Parse the `ai_models` array from a /permissions response into the
 * client-side AIModel shape. Returns null when the field is missing.
 *
 *   {
 *     id, provider, display_name, description, category, capabilities,
 *     is_default, requires_auth, required_feature, available, reason,
 *     sort_order
 *   }
 */
function finiteNumber(value: any): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function positiveNumber(value: any): number | undefined {
  const n = finiteNumber(value)
  return n !== undefined && n > 0 ? n : undefined
}

export function parseAIModelsFromPermissions(permissions: any): AIModel[] | null {
  const raw = permissions?.ai_models
  if (!Array.isArray(raw)) return null
  const parsed: AIModel[] = raw
    .filter((m: any) => m && typeof m.id === 'string' && typeof m.provider === 'string')
    .map((m: any): AIModel => ({
      id: m.id,
      provider: m.provider,
      displayName: m.display_name ?? m.id,
      description: m.description ?? '',
      category: (m.category ?? 'general') as AIModel['category'],
      capabilities: Array.isArray(m.capabilities) ? m.capabilities : [],
      isDefault: !!m.is_default,
      requiresAuth: !!m.requires_auth,
      requiredFeature: typeof m.required_feature === 'string' ? m.required_feature : null,
      available: m.available !== false,
      reason: typeof m.reason === 'string' ? m.reason : undefined,
      requireAPIKey: !!(m.require_api_key ?? m.requireAPIKey),
      sortOrder: typeof m.sort_order === 'number' ? m.sort_order : 0,
      maxOutputTokens: positiveNumber(m.max_output_tokens ?? m.maxOutputTokens),
      contextWindow: positiveNumber(m.context_window ?? m.contextWindow),
      temperature: finiteNumber(m.temperature),
      topP: finiteNumber(m.top_p ?? m.topP),
      supportsReasoning: typeof (m.supports_reasoning ?? m.supportsReasoning) === 'boolean'
        ? !!(m.supports_reasoning ?? m.supportsReasoning)
        : undefined
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder)

  // Append the local Ollama option only when the user has the `ai:ollama`
  // feature. Every other provider (anthropic / openai / mistral / moonshot /
  // openrouter / bedrock) is advertised directly by the backend in `ai_models`.
  const features = permissions?.features as Record<string, { is_enabled?: boolean }> | undefined

  if (features && features[Features.AI_OLLAMA]?.is_enabled === true) {
    parsed.push(OLLAMA_MODEL)
  }
  return parsed
}

/** Settings key holding the user's own AWS Bedrock bearer token. */
export const BEDROCK_API_KEY_SETTING = 'deepagent-bedrock-bearer-token'

/** True when the model reaches AWS Bedrock, whichever brand it is shown under. */
export function isBedrockModel(model: Pick<AIModel, 'provider' | 'routeProvider'>): boolean {
  return model.routeProvider === 'bedrock' || model.provider === 'bedrock'
}

/**
 * AWS Bedrock is BYOK-only — the Remix proxy no longer fronts it. Without the
 * user's bearer token its rows stay in the catalogue but go unavailable with
 * `reason: 'api_key_required'`, so the picker can advertise Bedrock (and offer
 * the "Add API key" hand-off) instead of hiding a provider the user could use.
 */
export function applyBedrockByokPolicy(models: AIModel[], hasBedrockKey: boolean): AIModel[] {
  if (!Array.isArray(models)) return models
  return models.map((model) => {
    if (!isBedrockModel(model)) return model
    return hasBedrockKey
      ? { ...model, available: true, requiredFeature: null, requireAPIKey: true, reason: undefined }
      : { ...model, available: false, requiredFeature: null, requireAPIKey: true, reason: 'api_key_required' }
  })
}

/** Settings key holding the user's own OpenRouter API key. */
export const OPENROUTER_API_KEY_SETTING = 'deepagent-openrouter-api-key'

/** Keyed by transport: only Bedrock and OpenRouter can run on a user key. */
export const BYOK_API_KEY_SETTINGS: Partial<Record<ModelTransport, string>> = {
  bedrock: BEDROCK_API_KEY_SETTING,
  openrouter: OPENROUTER_API_KEY_SETTING
}

/**
 * The transport that actually carries the request (route wins over brand).
 *
 * The return type stays the brand union because a row whose backend payload
 * omits `routeProvider` yields its brand here; `getProviderAdapter` rejects
 * that explicitly rather than guessing a transport for it.
 */
export function modelTransportProvider(model: Pick<AIModel, 'provider' | 'routeProvider'>): AIModel['provider'] {
  return model.routeProvider ?? model.provider
}

/**
 * The catalogue's Auto Mode row, if the backend advertises one.
 *
 * `openrouter/auto` is a router pseudo-model, not something the proxy will
 * serve: selecting it as a static model produces
 * `403 Model 'openrouter/auto' is not available`. It means "let Auto Mode
 * pick", so callers must route it to the Auto Mode path instead of setting it
 * as the active model.
 */
export function isAutoModelId(id: string | undefined | null): boolean {
  if (!id) return false
  const normalized = id.toLowerCase()
  return normalized === 'auto' || normalized === 'openrouter/auto' || normalized.endsWith('/auto')
}

/**
 * Whether a model is fit to write code — the gate for subagent work.
 *
 * Read from the backend's `capabilities` array, never from a client-side
 * model-family list: those go stale the moment the catalogue moves, and a
 * new weak model ships as suitable until someone notices.
 *
 * A row with NO advertised capabilities is treated as suitable. Older
 * payloads send an empty array, and refusing every model there would break
 * subagents outright — the strictly worse failure.
 */
export function modelSupportsCodeGeneration(model: Pick<AIModel, 'capabilities'> | undefined): boolean {
  const caps = model?.capabilities
  if (!Array.isArray(caps) || caps.length === 0) return true
  return caps.includes('code')
}

/**
 * Applies the BYOK key policy over the whole catalogue: deleting a key must
 * invalidate the provider it belonged to.
 */
export function applyByokKeyPolicy(
  models: AIModel[],
  keyPresence: Partial<Record<AIModel['provider'], boolean>>
): AIModel[] {
  if (!Array.isArray(models)) return models
  return applyBedrockByokPolicy(models, !!keyPresence.bedrock).map((model) => {
    const provider = modelTransportProvider(model)
    // Bedrock rows were already normalized above.
    if (provider === 'bedrock') return model
    if (!BYOK_API_KEY_SETTINGS[provider]) return model
    if (!model.requireAPIKey || keyPresence[provider]) return model
    return { ...model, available: false, reason: 'api_key_required' }
  })
}

/** Whether a row runs on the user's own key, or is waiting for one. */
export type ByokKeyState = 'own-key' | 'needs-key'

/**
 * BYOK state of a single row, for display. A stored key is used for every row
 * on that transport (ModelFactory switches to the direct API as soon as one
 * exists), so key presence alone decides `own-key`. Rows the backend flagged
 * `require_api_key` have no proxy route, hence `needs-key` without one; the
 * rest keep running on the Remix proxy and get no badge at all.
 */
export function byokKeyState(
  model: Pick<AIModel, 'provider' | 'routeProvider' | 'requireAPIKey'>,
  keyPresence: Partial<Record<AIModel['provider'], boolean>>
): ByokKeyState | undefined {
  const provider = modelTransportProvider(model)
  if (!BYOK_API_KEY_SETTINGS[provider]) return undefined
  if (keyPresence[provider]) return 'own-key'
  return model.requireAPIKey ? 'needs-key' : undefined
}

/**
 * OpenRouter is the default router: a model is "routed" when it reaches the
 * vendor through another provider's transport. `curateOpenRouterBrandedModels`
 * is the only curation that sets one.
 *
 */
export function isOpenRouterRouted(model: AIModel): boolean {
  return model.routeProvider === 'openrouter' || model.provider === 'openrouter'
}

/**
 * OpenRouter ids are `vendor/slug` (e.g. `anthropic/claude-sonnet-5`). Map the
 * vendor segment onto the brand the picker groups under, so an OpenRouter-routed
 * Claude lands in the Anthropic section rather than a 400-row OpenRouter one.
 * Vendors absent from this map keep `provider: 'openrouter'` and stay grouped
 * under OpenRouter.
 */
const OPENROUTER_VENDOR_BRANDS: Record<string, AIModel['provider']> = {
  anthropic: 'anthropic',
  openai: 'openai',
  mistralai: 'mistralai',
  mistral: 'mistralai',
  moonshotai: 'moonshot',
  moonshot: 'moonshot'
}

/** `anthropic/claude-sonnet-5` → `Claude Sonnet 5`. Only used when the backend
 *  sent no display_name (parseAIModelsFromPermissions falls back to the id). */
function prettifyOpenRouterId(id: string): string {
  const slug = id.includes('/') ? id.slice(id.indexOf('/') + 1) : id
  return slug
    .replace(/:.*$/, '') // drop OpenRouter variant suffixes (`:batch`, `:free`, …)
    .split(/[-_]/)
    .map((part) => (/^\d/.test(part) ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join(' ')
}

/**
 * OpenRouter is the primary route: Anthropic / OpenAI / Mistral / Moonshot
 * models reach us as `provider: 'openrouter'` rows and are rebranded here to
 * their vendor so the picker groups them by brand, with `routeProvider:
 * 'openrouter'` carrying the actual transport (ModelFactory reads
 * `routeProvider ?? provider`). The model id is left untouched — OpenRouter
 * requires the full `vendor/slug`.
 *
 * Needs no per-model rule table: the vendor prefix is part of every
 * OpenRouter id.
 */
export function curateOpenRouterBrandedModels(models: AIModel[]): AIModel[] {
  if (!Array.isArray(models) || models.length === 0) return models
  return models.map((model) => {
    if (model.provider !== 'openrouter') return model
    // parseAIModelsFromPermissions falls back to the id when the backend sends
    // no display_name — never show a raw `vendor/slug` in the picker.
    const displayName = model.displayName && model.displayName !== model.id
      ? model.displayName
      : prettifyOpenRouterId(model.id)
    const vendor = model.id.includes('/') ? model.id.slice(0, model.id.indexOf('/')).toLowerCase() : ''
    const brand = OPENROUTER_VENDOR_BRANDS[vendor]
    // Unmapped vendor (x-ai, google, deepseek, …) — stays under OpenRouter.
    if (!brand) return { ...model, displayName }
    return {
      ...model, // preserves backend `isDefault`, `available`, `sortOrder`, etc.
      provider: brand,
      routeProvider: 'openrouter' as const,
      displayName
    }
  })
}

const CompletionParams:IParams = {
  temperature: 0.8,
  topK: 40,
  topP: 0.92,
  max_new_tokens: 15,
  stream_result: false,
  max_tokens: 200,
  version: '1.0.0'
}

const InsertionParams:IParams = {
  temperature: 0.8,
  topK: 40,
  topP: 0.92,
  max_new_tokens: 150,
  stream_result: false,
  stream: false,
  model: "",
  version: '1.0.0',
}

const GenerationParams:IParams = {
  temperature: 0.5,
  topK: 40,
  topP: 0.92,
  max_new_tokens: 20000,
  stream_result: false,
  stream: false,
  model: "",
  repeat_penalty: 1.2,
  terminal_output: false,
  version: '1.0.0',
}

const AssistantParams:IParams = GenerationParams
// Provider is set by ModelManager when the user's model is resolved
// from /permissions. No literal default \u2014 backend drives it.

export { CompletionParams, InsertionParams, GenerationParams, AssistantParams }
