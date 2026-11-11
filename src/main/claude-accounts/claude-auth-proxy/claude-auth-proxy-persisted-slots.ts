import type { PersistedClaudePaneAccount } from '../claude-pane-account-persistence'
import type { ClaudeAuthProxy } from './claude-auth-proxy'

/** The listener calls a start needs. `createClaudeAuthProxy` satisfies it. */
export type PersistedSlotProxy = Pick<ClaudeAuthProxy, 'port' | 'adoptSlot' | 'endStartupGrace'>

export type PersistedSlotAdoption = {
  /** Slots re-registered for their billed account, in row order. */
  adopted: string[]
  /** PTYs with a persisted row that have not reattached yet. */
  pending: () => number
  /**
   * A persisted pane reattached (its row was read back into the registry). When the last one is
   * back every slot that can be known is known, and the listener's startup grace ends early.
   */
  reattached: (ptyId: string) => void
}

/**
 * Re-register, at listen time, every slot the previous listener minted on this port, for the
 * account its row bills. Daemon PTYs keep their baked `/p/<slot>/` URL across an app restart and
 * send before any renderer reattaches them; this is the first line, the per-PTY adoption on
 * reattach the second. A row on another port is unreachable through this listener and is left
 * to the resume strategy; a row without a slot gets one from its process environment on reattach.
 */
export function adoptPersistedClaudeAuthProxySlots(
  proxy: PersistedSlotProxy,
  rows: PersistedClaudePaneAccount[]
): PersistedSlotAdoption {
  const port = proxy.port()
  const adopted: string[] = []
  const pending = new Set<string>()
  for (const row of rows) {
    pending.add(row.ptyId)
    if (port === null || !row.proxySlot || row.proxyPort !== port) {
      continue
    }
    if (proxy.adoptSlot(row.proxySlot, row.assignedAccountId ?? row.accountId)) {
      adopted.push(row.proxySlot)
    }
  }
  // Why only a non-empty set ends it: with no rows, startup still has PTYs that may carry a slot in
  // their environment and no persisted row (an older row file); the cap bounds that case.
  const hadRows = pending.size > 0
  return {
    adopted,
    pending: () => pending.size,
    reattached(ptyId) {
      if (!pending.delete(ptyId)) {
        return
      }
      if (hadRows && pending.size === 0) {
        proxy.endStartupGrace()
      }
    }
  }
}
