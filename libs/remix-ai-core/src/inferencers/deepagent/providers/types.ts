import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { IUserApiKeyConfig, ModelProvider, ModelSelection } from '../../../types/deepagent'
import { ResolvedModelParams } from '../modelParams'

/**
 * What a provider's transport can actually do.
 *
 * Previously this knowledge was scattered: Ollama probed at runtime, code
 * suitability came from a client-side model-family blacklist, and everything
 * else was implicit in the shape of a 150-line switch. One declaration per
 * provider means adding a provider is a new file, not a switch edit.
 */
export interface ProviderCapabilities {
  /** Tool calling — the agent cannot run without it. */
  tools: boolean
  streaming: boolean
  /** Emits reasoning / thinking content. */
  reasoning: boolean
  /**
   * A custom `fetch` can be injected, so transport-level retry applies.
   * When false the adapter must set the SDK's own `maxRetries` instead.
   */
  injectableFetch: boolean
}

export interface CreateModelArgs {
  selection: ModelSelection
  params: ResolvedModelParams
  userApiKeys?: IUserApiKeyConfig
  /** `provider/modelId`, used for logs and telemetry grouping. */
  label: string
}

export interface ProviderAdapter {
  id: ModelProvider
  capabilities: ProviderCapabilities
  create(args: CreateModelArgs): Promise<BaseChatModel>
}
