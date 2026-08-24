/**
 * The transports that actually carry a request. Exactly three: OpenRouter
 * routes every hosted model, Bedrock is BYOK-direct, Ollama is local.
 */
export type ModelTransport = 'openrouter' | 'bedrock' | 'ollama'

/**
 * The brand a model is displayed under. A superset of `ModelTransport`: the
 * vendor brands below reach us through OpenRouter and exist only so the picker
 * can group by vendor rather than showing one enormous OpenRouter section.
 * Never switch on this to decide how to talk to a model — use
 * `modelTransportProvider()` and `ModelTransport` for that.
 */
export type ModelProvider = 'anthropic' | 'mistralai' | 'openai' | 'moonshot' | ModelTransport

export interface ModelSelection {
  /** Display brand. */
  provider: ModelProvider
  modelId: string
  /** The transport that carries the request; wins over `provider`. */
  routeProvider?: ModelTransport
}

/**
 * User API key configuration for direct API access
 */
export interface IUserApiKeyConfig {
  useOwnKeys: boolean
  openrouterApiKey?: string
  bedrockBearerToken?: string
}

export function isUsingOwnKeyForProvider(
  provider: ModelProvider | string,
  keys?: IUserApiKeyConfig
): boolean {
  if (!keys) return false
  switch (provider) {
  case 'bedrock':
    return !!keys.bedrockBearerToken
  case 'openrouter':
    return !!(keys.useOwnKeys && keys.openrouterApiKey)
  default:
    return false
  }
}

/**
 * Auto model selection configuration
 */
export interface IAutoModelConfig {
  enabled: boolean
  fallbackModel?: {
    provider: ModelProvider
    modelId: string
  }
  securityKeywords?: string[]
  complexityThreshold?: number
}

/**
 * DeepAgent configuration interface
 */
export interface IDeepAgentConfig {
  enabled: boolean
  apiKey: string // Automatically set to 'proxy-handled' - proxy server manages the real API key
  userApiKeys?: IUserApiKeyConfig // User-provided API keys for direct API access
  memoryBackend: 'state' | 'store'
  maxToolExecutions: number
  timeout: number
  enableSubagents: boolean
  enablePlanning: boolean
  autoMode?: IAutoModelConfig
}

/**
 * DeepAgent error types
 */
export enum DeepAgentErrorType {
  CONTEXT_LENGTH_EXCEEDED = 'context_length_exceeded',
  TOOL_EXECUTION_FAILED = 'tool_execution_failed',
  API_KEY_INVALID = 'api_key_invalid',
  INITIALIZATION_FAILED = 'initialization_failed',
  NETWORK_ERROR = 'network_error',
  RATE_LIMIT_EXCEEDED = 'rate_limit_exceeded',
  SERVER_ERROR = 'server_error',
  SERVICE_UNAVAILABLE = 'service_unavailable',
  REQUEST_TIMEOUT = 'request_timeout',
  INVALID_REQUEST = 'invalid_request',
  AUTHENTICATION_FAILED = 'authentication_failed',
  QUOTA_EXCEEDED = 'quota_exceeded',
  MODEL_OVERLOADED = 'model_overloaded',
  CONTENT_BLOCKED = 'content_blocked',
  UNKNOWN = 'unknown'
}

/**
 * DeepAgent error class
 */
export class DeepAgentError extends Error {
  type: DeepAgentErrorType
  details?: any

  constructor(message: string, type: DeepAgentErrorType, details?: any) {
    super(message)
    this.name = 'DeepAgentError'
    this.type = type
    this.details = details
  }
}

export interface ApiKeyErrorEvent {
  provider: ModelProvider
  errorType: 'invalid' | 'expired' | 'quota_exceeded' | 'rate_limited' | 'authentication_failed'
  message: string
  canFallbackToProxy: boolean
  originalError?: string
  timestamp: number
}
