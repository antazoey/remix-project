/**
 * localStorage settings that travel with a migration archive.
 *
 * This is an allow-list on purpose. A deny-list would leak any future key that
 * happens to hold a credential, so anything not named here simply stays behind.
 */

const ALLOWED_PREFIXES = ['config-v0.8:', 'providerExternals:']

const ALLOWED_KEYS = [
  'panelStates',
  'currentWorkspace',
  'lastLocalWorkspace',
  'recentWorkspaces',
  'networkDetails',
  'plugins/local',
  'remix-ai-history-sidebar-visible',
  'deepagent_enabled',
  'deepagent_memory_backend'
]

/**
 * Applied on top of the allow-list. Credentials must never cross an origin
 * boundary, even if a key is accidentally added above.
 */
const DENY_PATTERNS = [/token/i, /secret/i, /password/i, /passphrase/i, /private[-_]?key/i, /remix_user/i, /auth/i, /session/i]

export function isMigratableConfigKey(key: string): boolean {
  if (DENY_PATTERNS.some((p) => p.test(key))) return false
  if (ALLOWED_KEYS.includes(key)) return true
  return ALLOWED_PREFIXES.some((prefix) => key.startsWith(prefix))
}

export function collectConfig(): Record<string, string> {
  const out: Record<string, string> = {}
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key || !isMigratableConfigKey(key)) continue
      const value = localStorage.getItem(key)
      if (value !== null) out[key] = value
    }
  } catch {
    // private mode / storage disabled: settings are optional
  }
  return out
}

/**
 * Write imported settings, re-checking the allow-list because the archive is
 * user-supplied and may have been edited between export and import.
 *
 * Existing local values win so a re-import never clobbers newer preferences.
 */
export function applyConfig(config: Record<string, string>, overwrite = false): number {
  let applied = 0
  for (const [key, value] of Object.entries(config || {})) {
    if (!isMigratableConfigKey(key)) continue
    try {
      if (!overwrite && localStorage.getItem(key) !== null) continue
      localStorage.setItem(key, value)
      applied++
    } catch {
      // quota or disabled storage: settings are best effort
    }
  }
  return applied
}
