/**
 * Reads the backend `migration.*` app-config values and decides whether the
 * current origin is one being retired.
 */

export interface MigrationConfig {
  enabled: boolean
  fromDomains: string[]
  toDomain: string
  deadline: string | null
}

/**
 * Strip protocol, path, trailing slash and case so `https://Remix.ethereum.org/`
 * and `remix.ethereum.org` compare equal. Port is significant (localhost:8080).
 */
export function normalizeDomain(value: string): string {
  return String(value || '')
    .trim()
    .replace(/^[a-z]+:\/\//i, '')
    .replace(/\/.*$/, '')
    .toLowerCase()
}

function toDomainList(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : String(value ?? '').split(',')
  return raw.map((entry) => normalizeDomain(String(entry))).filter(Boolean)
}

/** `read` takes a config key and returns the raw backend value. */
export function parseMigrationConfig(read: (key: string) => unknown): MigrationConfig {
  const enabled = read('migration.enabled')
  const deadline = read('migration.deadline')
  return {
    // The backend may serialise booleans as strings.
    enabled: enabled === true || enabled === 'true',
    fromDomains: toDomainList(read('migration.from_domains')),
    toDomain: normalizeDomain(String(read('migration.to_domain') ?? '')),
    deadline: deadline ? String(deadline) : null
  }
}

/**
 * True when this origin is being retired and there is somewhere to go.
 * Guards against prompting on the destination itself, which would otherwise
 * happen if the destination is left in `from_domains` by mistake.
 */
export function shouldPromptMigration(config: MigrationConfig, host: string = window.location.host): boolean {
  if (!config.enabled || !config.toDomain) return false
  const current = normalizeDomain(host)
  if (current === config.toDomain) return false
  return config.fromDomains.includes(current)
}

// ─── Prompt snoozing ─────────────────────────────────────────────

/** Keyed on the destination so a changed target re-opens the conversation. */
export const migrationDismissKey = (toDomain: string) => `remix:domain-migration:${toDomain}`

const REMIND_DELAY_MS = 3 * 24 * 60 * 60 * 1000

export type MigrationDismissKind = 'remind' | 'never'

export function isMigrationPromptSnoozed(toDomain: string): boolean {
  try {
    const value = localStorage.getItem(migrationDismissKey(toDomain))
    if (!value) return false
    if (value === 'never') return true
    const until = Date.parse(value)
    return !Number.isNaN(until) && Date.now() < until
  } catch {
    return false
  }
}

export function snoozeMigrationPrompt(toDomain: string, kind: MigrationDismissKind): void {
  try {
    localStorage.setItem(
      migrationDismissKey(toDomain),
      kind === 'never' ? 'never' : new Date(Date.now() + REMIND_DELAY_MS).toISOString()
    )
  } catch {
    // storage unavailable — the prompt simply reappears next session
  }
}
