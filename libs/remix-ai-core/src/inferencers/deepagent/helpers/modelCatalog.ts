import type { Plugin } from '@remixproject/engine'
import { remixAILogger } from '../../../helpers/logger'
import { AIModel, modelSupportsCodeGeneration, modelTransportProvider } from '../../../types/models'
import { ModelSelection } from '../../../types/deepagent'
import { setModelCatalog } from '../modelParams'

/**
 * Catalogue access for the agent runtime.
 *
 * Everything here reads the backend catalogue through `assistantState`.
 * No literal model ids: a hardcoded fallback goes stale the moment the
 * catalogue moves, and the stale id then fails for every user at once.
 */

/** Pull the live catalogue and mirror it into `modelParams` for param lookup. */
export async function syncModelCatalog(plugin: Plugin): Promise<AIModel[]> {
  try {
    const models = await (plugin as any).call?.('assistantState', 'getAvailableModels')
    if (Array.isArray(models)) {
      setModelCatalog(models)
      return models
    }
  } catch { /* assistantState not active — callers fall back to defaults */ }
  return []
}

function toSelection(model: AIModel): ModelSelection {
  return {
    provider: model.provider,
    modelId: model.id,
    routeProvider: model.routeProvider
  }
}

/** The backend's assignment for a named task, resolved against the catalogue. */
async function selectionForTask(plugin: Plugin, catalog: AIModel[], taskId: string): Promise<ModelSelection | null> {
  try {
    const modelId: string | null = await (plugin as any).call?.('assistantState', 'getModelForTask', taskId)
    if (!modelId) return null
    const row = catalog.find((m) => m.id === modelId && m.available)
    if (row) return toSelection(row)
    remixAILogger.warn(`[modelCatalog] task '${taskId}' names ${modelId}, which is not an available catalogue row`)
  } catch { /* task_models not advertised */ }
  return null
}

/**
 * A model fit to write code, for the subagents.
 *
 * Order: the backend's `code_generation` task assignment → the current
 * selection if it is itself code-capable → any available code-capable row,
 * preferring one on the same transport so the request path is unchanged.
 * Returns null when nothing qualifies; the caller then keeps its own model
 * rather than substituting a guess.
 */
export async function resolveCodeCapableSelection(
  plugin: Plugin,
  current: ModelSelection
): Promise<ModelSelection | null> {
  const catalog = await syncModelCatalog(plugin)
  if (!catalog.length) return null

  const assigned = await selectionForTask(plugin, catalog, 'code_generation')
  if (assigned) return assigned

  const currentRow = catalog.find((m) => m.id === current.modelId)
  if (currentRow && modelSupportsCodeGeneration(currentRow)) return null

  const currentTransport = current.routeProvider ?? current.provider
  const candidates = catalog.filter((m) => m.available && modelSupportsCodeGeneration(m))
  const sameTransport = candidates.find((m) => modelTransportProvider(m) === currentTransport)
  const chosen = sameTransport ?? candidates[0]
  return chosen ? toSelection(chosen) : null
}
