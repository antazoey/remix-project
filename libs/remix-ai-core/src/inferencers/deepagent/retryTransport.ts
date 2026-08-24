import EventEmitter from 'events'
import { remixAILogger } from '../../helpers/logger'
import { DeepAgentErrorType } from '../../types/deepagent'
import { classifyApiError } from './ApiErrorHandler'

/**
 * Retry for model transports.
 *
 * `classifyApiError` has always computed `retryable` / `retryAfter`, but every
 * call site forwarded that straight to the user as a failed turn while the
 * SDKs were constructed with `maxRetries: 0`. A single 429 or a transient
 * `overloaded` therefore killed the run. This wraps `fetch` so the retry
 * decision is taken in exactly one place, using that same classification.
 *
 * Retry lives at the transport rather than in each SDK so that:
 *   - the model stays a real `BaseChatModel` (deepagents needs `bindTools`,
 *     which `Runnable.withRetry()` would strip), and
 *   - every provider gets identical semantics, including retry-after honouring.
 *
 * Providers with no injectable fetch (Bedrock, Ollama) get the SDK's own
 * `maxRetries` set to the same attempt budget instead.
 */

export interface RetryPolicy {
  /** Total attempts including the first. 3 → one initial call + 2 retries. */
  maxAttempts: number
  /** Exponential backoff base. */
  baseDelayMs: number
  /** Ceiling for computed backoff. */
  maxDelayMs: number
  /** Ceiling for a server-supplied Retry-After; beyond this we give up now
   *  rather than freeze the UI waiting out a long cooldown. */
  maxRetryAfterMs: number
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  baseDelayMs: 500,
  maxDelayMs: 8000,
  maxRetryAfterMs: 30000
}

export interface RetryAttemptInfo {
  label: string
  attempt: number
  maxAttempts: number
  delayMs: number
  errorType: DeepAgentErrorType
  status?: number
}

/** Emits `retry` with a RetryAttemptInfo, so the UI can say "retrying…". */
export const retryEvents = new EventEmitter()

/**
 * Error classes that are worth another attempt but which the *client* should
 * not sit on for long. Quota / auth / invalid-request are never retried —
 * `classifyApiError` already marks them non-retryable.
 */
function isRetryableType(type: DeepAgentErrorType): boolean {
  switch (type) {
  case DeepAgentErrorType.RATE_LIMIT_EXCEEDED:
  case DeepAgentErrorType.MODEL_OVERLOADED:
  case DeepAgentErrorType.SERVICE_UNAVAILABLE:
  case DeepAgentErrorType.SERVER_ERROR:
  case DeepAgentErrorType.REQUEST_TIMEOUT:
  case DeepAgentErrorType.NETWORK_ERROR:
    return true
  default:
    return false
  }
}

function backoffDelay(attempt: number, policy: RetryPolicy): number {
  const exponential = Math.min(policy.baseDelayMs * Math.pow(2, attempt - 1), policy.maxDelayMs)
  // Full jitter — several parallel subagents hitting the same 429 must not
  // all wake up together and re-trigger it.
  return Math.round(exponential * (0.5 + Math.random() * 0.5))
}

/** Retry-After may be seconds or an HTTP date. Returns ms, or undefined. */
export function parseRetryAfterHeader(value: string | null): number | undefined {
  if (!value) return undefined
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000
  const date = Date.parse(value)
  if (!Number.isNaN(date)) {
    const delta = date - Date.now()
    return delta > 0 ? delta : 0
  }
  return undefined
}

function sleep(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'))
    const timer = setTimeout(() => {
      signal?.removeEventListener?.('abort', onAbort)
      resolve()
    }, ms)
    function onAbort() {
      clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    }
    signal?.addEventListener?.('abort', onAbort, { once: true })
  })
}

function isAbort(error: any): boolean {
  return error?.name === 'AbortError' || error?.code === 20 || /abort/i.test(error?.message || '')
}

/**
 * Build a pseudo-error from a failed response so the *same* classifier that
 * drives the user-facing message drives the retry decision. The body is read
 * from a clone, leaving the original response intact for the caller.
 */
async function classifyResponse(response: Response) {
  let body = ''
  try {
    body = await response.clone().text()
  } catch { /* body already consumed or not text — status alone will do */ }
  const pseudoError: any = {
    status: response.status,
    message: `${response.status} ${response.statusText} ${body}`.trim(),
    headers: { 'retry-after': response.headers.get('retry-after') }
  }
  return classifyApiError(pseudoError)
}

/**
 * Wrap a fetch implementation with classification-driven retry.
 * Only failed responses and thrown network errors are retried; a successful
 * (including streaming) response is passed straight through untouched.
 */
export function withRetryingFetch(
  fetchImpl: typeof fetch,
  label: string,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY
): typeof fetch {
  const retryingFetch: typeof fetch = async (input, init) => {
    const signal = (init as RequestInit | undefined)?.signal as AbortSignal | undefined

    for (let attempt = 1; ; attempt++) {
      const isLast = attempt >= policy.maxAttempts
      let response: Response
      try {
        response = await fetchImpl(input as any, init)
      } catch (error: any) {
        if (isAbort(error) || isLast) throw error
        const { type } = classifyApiError(error)
        if (!isRetryableType(type)) throw error
        const delayMs = backoffDelay(attempt, policy)
        announce({ label, attempt, maxAttempts: policy.maxAttempts, delayMs, errorType: type })
        await sleep(delayMs, signal)
        continue
      }

      if (response.ok || isLast) return response

      const { type, retryable } = await classifyResponse(response)
      if (!retryable || !isRetryableType(type)) return response

      const headerDelay = parseRetryAfterHeader(response.headers.get('retry-after'))
      const delayMs = headerDelay ?? backoffDelay(attempt, policy)
      if (delayMs > policy.maxRetryAfterMs) {
        // A long server-mandated cooldown is not something to block on —
        // surface it so the UI can show the real wait.
        remixAILogger.warn(`[retry ${label}] server asked for ${Math.round(delayMs / 1000)}s — surfacing instead of waiting`)
        return response
      }
      announce({ label, attempt, maxAttempts: policy.maxAttempts, delayMs, errorType: type, status: response.status })
      await sleep(delayMs, signal)
    }
  }
  return retryingFetch
}

function announce(info: RetryAttemptInfo): void {
  remixAILogger.warn(
    `[retry ${info.label}] attempt ${info.attempt}/${info.maxAttempts} failed (${info.errorType}` +
    `${info.status ? ` ${info.status}` : ''}) — retrying in ${info.delayMs}ms`
  )
  try {
    retryEvents.emit('retry', info)
  } catch { /* listener threw — never let telemetry break a request */ }
}

/** Exported for the providers that cannot take a custom fetch. */
export const SDK_MAX_RETRIES = DEFAULT_RETRY_POLICY.maxAttempts - 1
