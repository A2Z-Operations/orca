import { join } from 'node:path'
import type { ClaudeAuthProxyStatus } from '../../../shared/claude-auth-proxy-status'
import { getOrcaUserDataPath } from '../../codex/configuration/homes/codex-home-paths'
import {
  clearClaudeAuthProxyAccountDirs,
  readClaudeAuthProxyAccessToken,
  refreshClaudeAuthProxyAccessToken
} from './claude-auth-proxy-account-credentials'
export {
  bindClaudeAuthProxyAccountDir,
  readClaudeAuthProxyAccessToken
} from './claude-auth-proxy-account-credentials'
import { setClaudePaneProxySlotReleaser } from '../claude-pane-account-registry'
import {
  claudePaneAccountPersistence,
  createClaudePaneAccountFileStore,
  installClaudePaneAccountPersistence
} from '../claude-pane-account-persistence'
import { noteUserAnthropicBaseUrl } from './claude-auth-proxy-note'
import { createClaudeAuthProxy, type ClaudeAuthProxy } from './claude-auth-proxy'
import {
  adoptPersistedClaudeAuthProxySlots,
  type PersistedSlotAdoption
} from './claude-auth-proxy-persisted-slots'
import { createClaudeAuthProxyAccountLogObserver } from '../claude-account-log'
import { setClaudeAuthProxyStatusReader } from '../claude-account-list-extras'
import {
  claudeAuthProxySlotModel,
  forgetClaudeAuthProxySlotOwner,
  noteClaudeAuthProxySlotAllocated,
  resetClaudeAuthProxySlotOwners
} from './claude-auth-proxy-slot-owners'

export type ClaudeAuthSnapshotIdentity = {
  configDir: string | null
  provenance: string
}

let proxy: ClaudeAuthProxy | null = null
let pending: Promise<void> | null = null
/** The persisted panes this listener re-registered at start, until each has reattached. */
let persistedSlots: PersistedSlotAdoption | null = null
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
    refreshAccessToken: refreshClaudeAuthProxyAccessToken,
    log: (line) => console.info(`[claude-auth-proxy] ${line}`),
    modelForSlot: claudeAuthProxySlotModel,
    onRequest: createClaudeAuthProxyAccountLogObserver(),
    preferredPort: claudePaneAccountPersistence()?.proxyPort() ?? null
  })
  pending = created
    .start()
    .then(() => {
      proxy = created
      // Before any PTY reattach: a restored pane's first request must find its slot registered.
      persistedSlots = adoptPersistedClaudeAuthProxySlots(
        created,
        claudePaneAccountPersistence()?.rows() ?? []
      )
      if (persistedSlots.adopted.length > 0) {
        console.info(
          `[claude-auth-proxy] re-registered ${persistedSlots.adopted.length} persisted slot(s)`
        )
      }
      setClaudePaneProxySlotReleaser((slot) => releaseOwnClaudeAuthProxySlot(slot))
      setClaudeAuthProxyStatusReader(() => created.status())
      const port = created.port()
      if (port !== null) {
        claudePaneAccountPersistence()?.setProxyPort(port)
      }
    })
    .catch((error: unknown) => {
      pending = null
      console.warn('[claude-auth-proxy] failed to start', error)
    })
  return pending
}

/**
 * Pane rows and the listener port, under userData, so a PTY reattached after a restart keeps its
 * account and its slot. Called before {@link startClaudeAuthProxy} so the listener asks for its old port.
 */
export function installClaudePaneAccountFileStore(): void {
  installClaudePaneAccountPersistence(
    createClaudePaneAccountFileStore({
      filePath: join(getOrcaUserDataPath(), 'claude-pane-accounts.json'),
      listeningPort: claudeAuthProxyListeningPort
    })
  )
}

export async function stopClaudeAuthProxy(): Promise<void> {
  const starting = pending
  pending = null
  if (starting) {
    await starting.catch(() => {})
  }
  const current = proxy
  proxy = null
  persistedSlots = null
  // Teardown after this point must not erase the rows the next start reattaches from.
  installClaudePaneAccountPersistence(null)
  clearClaudeAuthProxyAccountDirs()
  resetClaudeAuthProxySlotOwners()
  setClaudePaneProxySlotReleaser(null)
  setClaudeAuthProxyStatusReader(null)
  if (current) {
    await current.stop()
  }
}

export function getClaudeAuthProxy(): ClaudeAuthProxy | null {
  return proxy
}

/**
 * A PTY with a persisted row reattached. Once every persisted pane is back, the listener's
 * startup grace ends and an unknown slot is answered as stale. No listener, or no persisted rows
 * for this listener: nothing to note.
 */
export function noteClaudePaneReattached(ptyId: string): void {
  persistedSlots?.reattached(ptyId)
}

export function releaseOwnClaudeAuthProxySlot(slot: string): void {
  forgetClaudeAuthProxySlotOwner(slot)
  getClaudeAuthProxy()?.releaseSlot(slot)
}

/** A pure read. Nothing here changes the slot table: pruning lives in claude-auth-proxy-prune.ts. */
export function claudeAuthProxyStatus(): ClaudeAuthProxyStatus {
  return (
    getClaudeAuthProxy()?.status() ?? {
      listening: false,
      host: '127.0.0.1',
      port: null,
      slots: [],
      requestsLastHour: [],
      unknownSlotRequests: 0,
      lastError: null
    }
  )
}

/** `profile:<accountId>` and `profile:<accountId>:wsl:<distro>`. Anything else is unnamed. */
export function claudeAccountIdFromAuthProvenance(provenance: string): string | undefined {
  if (!provenance.startsWith('profile:')) {
    return undefined
  }
  const rest = provenance.slice('profile:'.length)
  const wslAt = rest.indexOf(':wsl:')
  const accountId = wslAt === -1 ? rest : rest.slice(0, wslAt)
  if (accountId.length === 0 || accountId === 'unavailable') {
    return undefined
  }
  return accountId
}

export function invalidateClaudeAuthProxyToken(accountId?: string): void {
  getClaudeAuthProxy()?.invalidateToken(accountId)
}

/**
 * Drops cached bearer tokens when the rate-limit auth snapshot changes.
 * Returns whether a cache drop was requested. An unchanged snapshot keeps the 20s hit.
 */
export function noteClaudeAuthSnapshot(
  previous: ClaudeAuthSnapshotIdentity | null,
  next: ClaudeAuthSnapshotIdentity
): boolean {
  if (
    previous &&
    previous.configDir === next.configDir &&
    previous.provenance === next.provenance
  ) {
    return false
  }
  invalidateClaudeAuthProxyToken(claudeAccountIdFromAuthProvenance(next.provenance))
  return true
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
  const slot = current.allocateSlot(accountId)
  const url = current.slotBaseUrl(slot)
  if (!url) {
    current.releaseSlot(slot)
    return undefined
  }
  noteClaudeAuthProxySlotAllocated(slot)
  return url
}
