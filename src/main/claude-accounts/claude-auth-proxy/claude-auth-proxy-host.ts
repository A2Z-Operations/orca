import { readClaudeOAuthCredentials } from '../../rate-limits/claude-oauth-credentials'
import { getClaudeProfileRouter } from '../claude-profile-installed-router'
import { setClaudePaneProxySlotReleaser } from '../claude-pane-account-registry'
import { noteUserAnthropicBaseUrl } from './claude-auth-proxy-note'
import { createClaudeAuthProxy, type ClaudeAuthProxy } from './claude-auth-proxy'

let proxy: ClaudeAuthProxy | null = null
let pending: Promise<void> | null = null
/** Account id → folder, for a host whose profile router is not installed (the WSL guest). */
const accountConfigDirs = new Map<string, string>()

/** Remember which folder a slot's account id reads. The router path ignores this map. */
export function bindClaudeAuthProxyAccountDir(accountId: string, configDir: string): void {
  if (accountId && configDir) {
    accountConfigDirs.set(accountId, configDir)
  }
}

export function claudeAuthProxyListeningPort(): number | null {
  return proxy?.port() ?? null
}

/** Wait out an in-flight start so a spawn does not miss the listener. */
export async function claudeAuthProxyReady(): Promise<ClaudeAuthProxy | null> {
  if (pending) {
    await pending.catch(() => {})
  }
  return proxy
}

/** One loopback listener for this execution host. Safe to call more than once. */
export function startClaudeAuthProxy(): Promise<void> {
  if (proxy) {
    return Promise.resolve()
  }
  if (pending) {
    return pending
  }
  const created = createClaudeAuthProxy({
    readToken: readClaudeAuthProxyAccessToken,
    log: (line) => console.info(`[claude-auth-proxy] ${line}`)
  })
  pending = created
    .start()
    .then(() => {
      proxy = created
      setClaudePaneProxySlotReleaser((slot) => getClaudeAuthProxy()?.releaseSlot(slot))
    })
    .catch((error: unknown) => {
      pending = null
      console.warn('[claude-auth-proxy] failed to start', error)
    })
  return pending
}

export async function stopClaudeAuthProxy(): Promise<void> {
  const starting = pending
  pending = null
  if (starting) {
    await starting.catch(() => {})
  }
  const current = proxy
  proxy = null
  accountConfigDirs.clear()
  setClaudePaneProxySlotReleaser(null)
  if (current) {
    await current.stop()
  }
}

export function getClaudeAuthProxy(): ClaudeAuthProxy | null {
  return proxy
}

/**
 * Slot URL for a launch, or undefined when the proxy is off, down, or the user already set a base URL.
 * Each call takes a new slot; the slot in the env that is actually applied is the one that matters.
 */
export function claudeAuthProxyBaseUrl(
  accountId: string | null | undefined,
  env: NodeJS.ProcessEnv,
  enabled: boolean
): string | undefined {
  if (!enabled || !accountId) {
    return undefined
  }
  if (env.ANTHROPIC_BASE_URL) {
    noteUserAnthropicBaseUrl()
    return undefined
  }
  const current = getClaudeAuthProxy()
  if (!current || current.port() === null) {
    return undefined
  }
  return current.slotBaseUrl(current.allocateSlot(accountId)) ?? undefined
}

/**
 * Re-read on each request. Never refresh: a refresh would rotate the token into the spawn folder.
 * Same reader as the rest of Orca: macOS keychain, then `.credentials.json`. No Windows Credential
 * Manager reader. A throw or an unreadable file returns null so the proxy forwards the incoming header.
 */
export async function readClaudeAuthProxyAccessToken(accountId: string): Promise<string | null> {
  const router = getClaudeProfileRouter()
  try {
    if (router) {
      const covered = router.coveredBySystemDefault(accountId)
      const userDir = router.userConfigDir()
      const configDir = covered
        ? (userDir ?? router.systemDefaultHome())
        : router.accountHome(accountId)
      const result = await readClaudeOAuthCredentials({
        credentialsFileConfigDir: configDir,
        keychainConfigDir: configDir,
        unsuffixedKeychainFallback: covered && !userDir
      })
      return result.token || null
    }
    const configDir = accountConfigDirs.get(accountId)
    if (!configDir) {
      return null
    }
    const result = await readClaudeOAuthCredentials({
      credentialsFileConfigDir: configDir,
      keychainConfigDir: configDir
    })
    return result.token || null
  } catch {
    return null
  }
}
