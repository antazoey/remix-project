import { AIModel, findModel, modelTransportProvider } from '../../types/models'
import { ModelProvider, ModelSelection } from '../../types/deepagent'
import { remixAILogger } from '../../helpers/logger'

/**
 * How a model must be *driven* — the counterpart to the catalogue's
 * "may this model be used at all".
 *
 * Previously every provider was handed the same `DAPP_MAX_TOKENS` (65536)
 * and `temperature: 0.7`, which over-requests on models that cap output
 * far lower and was dropped entirely on the Bedrock path. These values now
 * come from the backend catalogue (`AIModel.maxOutputTokens` et al), with
 * per-provider fallbacks for older payloads that don't advertise them.
 */
export interface ResolvedModelParams {
  maxOutputTokens: number
  temperature: number
  topP?: number
  contextWindow?: number
  supportsReasoning?: boolean
}

/**
 * Per-provider fallbacks, used ONLY when the backend advertised nothing for
 * the model. Deliberately conservative: over-requesting output tokens is a
 * hard 400 on several providers, while under-requesting merely truncates a
 * response the agent can continue. Once `/permissions` carries
 * `max_output_tokens` these are never consulted.
 *
 * These are provider-level, not model-level — no model ids on the client.
 */
export const PROVIDER_PARAM_DEFAULTS: Record<ModelProvider, ResolvedModelParams> = {
  anthropic: { maxOutputTokens: 32768, temperature: 0.7 },
  openai: { maxOutputTokens: 32768, temperature: 0.7 },
  openrouter: { maxOutputTokens: 32768, temperature: 0.7 },
  mistralai: { maxOutputTokens: 16384, temperature: 0.7 },
  // Moonshot's own guidance is temperature 1 / top_p 0.95 — it degrades badly
  // at 0.7. This was already special-cased in ModelFactory.
  moonshot: { maxOutputTokens: 32768, temperature: 1, topP: 0.95 },
  // Bedrock Converse rejects a maxTokens above the model ceiling and the
  // ceilings vary widely by inference profile, so stay low until advertised.
  bedrock: { maxOutputTokens: 8192, temperature: 0.7 },
  // Local hardware — a 64k num_predict makes small models run for minutes.
  ollama: { maxOutputTokens: 8192, temperature: 0.7 }
}

/**
 * The live catalogue, mirrored from `assistantState` so that any code holding
 * only a `ModelSelection` can still resolve that model's parameters. Set by
 * whoever parses `/permissions`; empty until then, in which case
 * `resolveModelParams` uses provider defaults.
 */
let catalog: ReadonlyArray<AIModel> = []

export function setModelCatalog(models: ReadonlyArray<AIModel> | null | undefined): void {
  if (!Array.isArray(models)) return
  catalog = models
}

export function getModelCatalog(): ReadonlyArray<AIModel> {
  return catalog
}

/** The catalogue row backing a selection, if the catalogue has loaded. */
export function lookupCatalogEntry(selection: Pick<ModelSelection, 'provider' | 'modelId'>): AIModel | undefined {
  if (!catalog.length) return undefined
  return findModel(catalog, selection.modelId, selection.provider) ?? findModel(catalog, selection.modelId)
}

function clampToContext(maxOutputTokens: number, contextWindow?: number): number {
  if (!contextWindow || contextWindow <= 0) return maxOutputTokens
  // Never let the output budget eat the whole window — the prompt has to fit.
  return Math.min(maxOutputTokens, Math.floor(contextWindow / 2))
}

/**
 * Resolve the runtime parameters for a model selection.
 *
 * Precedence: backend catalogue value → per-provider default. The caller's
 * `requestedMaxTokens` acts as a *ceiling* only (e.g. the DApp generator
 * asking for a large budget) — it can lower the resolved value but never
 * raise it past what the model actually accepts.
 */
export function resolveModelParams(
  selection: ModelSelection,
  requestedMaxTokens?: number,
  entry: AIModel | undefined = lookupCatalogEntry(selection)
): ResolvedModelParams {
  const transport = entry
    ? modelTransportProvider(entry)
    : (selection.routeProvider ?? selection.provider)
  const defaults = PROVIDER_PARAM_DEFAULTS[transport] ?? PROVIDER_PARAM_DEFAULTS.anthropic

  const contextWindow = entry?.contextWindow ?? defaults.contextWindow
  let maxOutputTokens = entry?.maxOutputTokens ?? defaults.maxOutputTokens
  if (requestedMaxTokens && requestedMaxTokens > 0) {
    maxOutputTokens = Math.min(maxOutputTokens, requestedMaxTokens)
  }
  maxOutputTokens = clampToContext(maxOutputTokens, contextWindow)

  const resolved: ResolvedModelParams = {
    maxOutputTokens,
    temperature: entry?.temperature ?? defaults.temperature,
    topP: entry?.topP ?? defaults.topP,
    contextWindow,
    supportsReasoning: entry?.supportsReasoning ?? defaults.supportsReasoning
  }

  if (!entry) {
    remixAILogger.log(
      `[modelParams] no catalogue entry for ${selection.provider}:${selection.modelId} — using ${transport} defaults`,
      resolved
    )
  }
  return resolved
}
