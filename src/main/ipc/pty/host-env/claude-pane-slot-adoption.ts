import { getClaudeAuthProxy } from '../../../claude-accounts/claude-auth-proxy/claude-auth-proxy-host'
import { claudeAuthProxySlotsForPty } from '../../../claude-accounts/claude-auth-proxy/claude-auth-proxy-slot-owners'
import {
  getClaudePaneAccount,
  recordClaudePaneAccount,
  type ClaudePaneAccountRecord
} from '../../../claude-accounts/claude-pane-account-registry'
import { listRegisteredPtys } from '../../../memory/pty-registry'
import {
  proxySlotFromUrl,
  readProcessAnthropicBaseUrl,
  recoverReattachedProxySlot,
  type ReattachSlotProxy
} from './claude-pane-proxy-slot-recovery'

export type ClaudePaneSlotAdoptionSources = {
  pid?: number | null
  /** Defaults to the live listener. Tests pass a fake. */
  proxy?: ReattachSlotProxy | null
  /** Defaults to reading the process environment. Tests pass a fake. */
  readBaseUrl?: (pid: number | null | undefined) => Promise<string | null>
}

function adoptionProxy(sources: ClaudePaneSlotAdoptionSources): ReattachSlotProxy | null {
  return sources.proxy === undefined ? getClaudeAuthProxy() : sources.proxy
}

/**
 * The slot the owner table already binds to this PTY and the listener still maps: the shell's own
 * `terminalEnv` slot, bound when the spawn committed. Known synchronously, so a record can carry it
 * from the start.
 */
export function boundClaudePaneProxySlot(
  ptyId: string,
  proxy: ReattachSlotProxy | null
): string | undefined {
  if (!proxy) {
    return undefined
  }
  return claudeAuthProxySlotsForPty(ptyId).find((slot) => proxy.accountIdForSlot(slot) !== null)
}

/**
 * Record a slot into a row that has none. The row that exists now wins: one that gained a slot or
 * vanished meanwhile is left alone, and the listener never adopts a slot for a missing row (an
 * adopted slot with no row would bill the account until the next prune).
 */
function recordAdoptedSlot(ptyId: string, slot: string, proxy: ReattachSlotProxy | null): boolean {
  const current = getClaudePaneAccount(ptyId)
  if (!current || current.proxySlot) {
    return false
  }
  // Why the listener's account: the slot bills whoever the listener maps it to; the row says so.
  const billed = proxy?.accountIdForSlot(slot) ?? current.assignedAccountId ?? current.accountId
  recordClaudePaneAccount({ ...current, proxySlot: slot, assignedAccountId: billed })
  return true
}

/**
 * Fill in the slot a recorded pane already runs on. First the owner table (synchronous), then the
 * process environment (asynchronous, once the read lands). A pane evaluated in between is treated
 * as slotless, as before this fix. Returns the slot the synchronous step recorded, if any.
 */
export function adoptClaudePaneProxySlot(
  ptyId: string,
  accountId: string,
  sources: ClaudePaneSlotAdoptionSources = {}
): string | undefined {
  const proxy = adoptionProxy(sources)
  const bound = boundClaudePaneProxySlot(ptyId, proxy)
  if (bound && recordAdoptedSlot(ptyId, bound, proxy)) {
    return bound
  }
  const read = sources.readBaseUrl ?? readProcessAnthropicBaseUrl
  void read(sources.pid).then(
    (url) => {
      // Row first: recovery may adopt the slot into the listener, and only a row can carry it.
      const current = getClaudePaneAccount(ptyId)
      if (!current || current.proxySlot) {
        return
      }
      const slot = recoverReattachedProxySlot({
        recovered: proxySlotFromUrl(url),
        accountId,
        proxy: adoptionProxy(sources)
      })
      if (slot) {
        recordAdoptedSlot(ptyId, slot, adoptionProxy(sources))
      }
    },
    () => {}
  )
  return undefined
}

/**
 * The session mover's `recordInferred`: a pane Orca did not launch (a typed `claude --resume` in a
 * shell) is learned from its transcript. Its shell still carries the slot `terminalEnv` minted, so
 * the row records that slot instead of leaving it for the prune to drop.
 */
export function recordInferredClaudePaneAccount(record: ClaudePaneAccountRecord): void {
  const proxy = getClaudeAuthProxy()
  const bound = record.proxySlot ?? boundClaudePaneProxySlot(record.ptyId, proxy)
  const billed = bound ? proxy?.accountIdForSlot(bound) : null
  recordClaudePaneAccount(
    bound ? { ...record, proxySlot: bound, assignedAccountId: billed ?? record.accountId } : record
  )
  if (bound) {
    return
  }
  adoptClaudePaneProxySlot(record.ptyId, record.accountId, {
    pid: listRegisteredPtys().find((pty) => pty.ptyId === record.ptyId)?.pid ?? null
  })
}
