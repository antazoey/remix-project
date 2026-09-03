/**
 * Closes the migration loop.
 *
 * After importing on the new domain the user follows a link back here, which
 * is caught before the IDE boots (see AppRenderer) and records that this
 * browser is done with this origin. Every later visit then redirects.
 *
 * The link carries no destination — the backend config is the only source for
 * that. Reading it from the URL would let a crafted link redirect Remix
 * anywhere, permanently.
 */

import {
  fetchRedirectConfig,
  isRedirectOptedOut,
  normalizeDomain,
  redirectTarget
} from './freshUserRedirect'

const COMPLETION_KEY = 'remix:migration-completed'
const CONFIRM_PARAM = 'migrated'

export interface MigrationCompletion {
  /** Host this browser was migrated to. */
  toDomain: string
  /** ISO timestamp of the confirmation. */
  at: string
}

/** True when this load is the "I'm done" link coming back from the new domain. */
export function isConfirmingMigration(
  hash: string = window.location.hash,
  search: string = window.location.search
): boolean {
  try {
    return (
      new URLSearchParams(hash.replace(/^#/, '')).has(CONFIRM_PARAM) ||
      new URLSearchParams(search).has(CONFIRM_PARAM)
    )
  } catch {
    return false
  }
}

export function readMigrationCompletion(): MigrationCompletion | null {
  try {
    const raw = localStorage.getItem(COMPLETION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    const toDomain = normalizeDomain(parsed?.toDomain)
    return toDomain ? { toDomain, at: String(parsed?.at || '') } : null
  } catch {
    return null
  }
}

function writeMigrationCompletion(toDomain: string): void {
  try {
    localStorage.setItem(COMPLETION_KEY, JSON.stringify({ toDomain, at: new Date().toISOString() }))
  } catch {
    // storage blocked — the user simply won't be redirected next time
  }
}

export function clearMigrationCompletion(): void {
  try {
    localStorage.removeItem(COMPLETION_KEY)
  } catch {
    // nothing to undo
  }
}

export type ConfirmOutcome =
  | { status: 'confirmed'; toDomain: string }
  /** Config unreachable or no destination set. Retryable, never assumed. */
  | { status: 'unavailable' }

/** Record the move against the destination the backend reports. */
export async function confirmMigration(): Promise<ConfirmOutcome> {
  const config = await fetchRedirectConfig()
  const toDomain = normalizeDomain(config?.toDomain)
  if (!toDomain) return { status: 'unavailable' }

  writeMigrationCompletion(toDomain)
  return { status: 'confirmed', toDomain }
}

/**
 * Send a confirmed user on to the new domain. Reads localStorage only, so
 * returning visitors pay nothing for it.
 *
 * Unlike the fresh-visitor redirect this repeats on every visit — the user has
 * said they are done here — with `?nomigrationredirect` as the way back.
 *
 * @returns true when a navigation was started, so the caller can stop booting.
 */
export function redirectConfirmedVisitor(onRedirect?: (toDomain: string) => void): boolean {
  const completion = readMigrationCompletion()
  if (!completion) return false
  if (isConfirmingMigration()) return false
  if (isRedirectOptedOut()) return false
  if (normalizeDomain(window.location.host) === completion.toDomain) return false

  onRedirect?.(completion.toDomain)
  window.location.replace(redirectTarget(completion.toDomain))
  return true
}
