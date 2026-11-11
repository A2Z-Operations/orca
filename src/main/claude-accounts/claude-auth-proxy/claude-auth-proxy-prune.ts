import { listRegisteredPtys } from '../../memory/pty-registry'
import {
  getClaudePaneAccount,
  listClaudePaneAccounts,
  recordClaudePaneAccount
} from '../claude-pane-account-registry'
import { getClaudeAuthProxy, releaseOwnClaudeAuthProxySlot } from './claude-auth-proxy-host'
import { readProcessAnthropicBaseUrls } from './claude-auth-proxy-process-env'
import {
  bindClaudeAuthProxySlotToPty,
  claudeAuthProxySlotShouldPrune,
  CLAUDE_AUTH_PROXY_UNBOUND_SLOT_GRACE_MS
} from './claude-auth-proxy-slot-owners'
import { claudeAuthProxySlotId, isForeignClaudeAuthProxyUrl } from './claude-auth-proxy-url'

/**
 * Slot hygiene for the auth proxy. No read path calls anything here: `--status`, the Accounts
 * settings page and the plugin accounts API are pure reads. The prune runs once, a little after
 * the event that can make a slot droppable (a slot minted, a PTY gone), and stops when idle.
 */

function liveClaudeAuthProxyPtyIds(): Set<string> {
  const live = new Set<string>()
  for (const pty of listRegisteredPtys()) {
    live.add(pty.ptyId)
  }
  for (const record of listClaudePaneAccounts()) {
    live.add(record.ptyId)
  }
  return live
}

/** Slot → PTY of every pane record that names a slot. */
function referencedClaudeAuthProxySlots(): Map<string, string> {
  const referenced = new Map<string, string>()
  for (const record of listClaudePaneAccounts()) {
    if (record.proxySlot) {
      referenced.set(record.proxySlot, record.ptyId)
    }
  }
  return referenced
}

/**
 * Slot → PTY for every registered PTY whose process environment still carries one of this
 * listener's `/p/<slot>/` URLs. A shell that minted a slot at spawn keeps it in its environment
 * for its whole life, whether or not any pane record names it.
 */
async function claudeAuthProxySlotsCarriedByLivePtys(
  listeningPort: number | null,
  readEnvs: ClaudeAuthProxyEnvReader
): Promise<Map<string, string>> {
  const ptyByPid = new Map<number, string>()
  for (const pty of listRegisteredPtys()) {
    if (pty.pid !== null) {
      ptyByPid.set(pty.pid, pty.ptyId)
    }
  }
  const carried = new Map<string, string>()
  if (ptyByPid.size === 0) {
    return carried
  }
  const urls = await readEnvs([...ptyByPid.keys()])
  for (const [pid, url] of urls) {
    const ptyId = ptyByPid.get(pid)
    const slot = claudeAuthProxySlotId(url)
    if (!ptyId || !slot || isForeignClaudeAuthProxyUrl(url, listeningPort)) {
      continue
    }
    carried.set(slot, ptyId)
  }
  return carried
}

export type ClaudeAuthProxyEnvReader = (pids: readonly number[]) => Promise<Map<number, string>>

/**
 * Maintenance only; no read path calls this. Drops a slot whose PTY is gone, and an unbound slot
 * older than the spawn grace. Before a slot is dropped, the live PTYs' environments are read: a
 * slot one of them still carries is bound to that PTY (and recorded on its pane row when the row
 * has none) instead of dropped. Why: a pane Orca learned from its transcript has no slot on its
 * row, and the owner table is memory; neither is proof that the shell stopped using the slot.
 */
export async function pruneClaudeAuthProxySlots(
  now = Date.now(),
  readEnvs: ClaudeAuthProxyEnvReader = readProcessAnthropicBaseUrls
): Promise<string[]> {
  const current = getClaudeAuthProxy()
  if (!current) {
    return []
  }
  const live = liveClaudeAuthProxyPtyIds()
  const referenced = referencedClaudeAuthProxySlots()
  const candidates: string[] = []
  for (const { slot } of current.status().slots) {
    const panePty = referenced.get(slot)
    if (panePty) {
      bindClaudeAuthProxySlotToPty(slot, panePty, now)
      continue
    }
    if (claudeAuthProxySlotShouldPrune(slot, live, now)) {
      candidates.push(slot)
    }
  }
  if (candidates.length === 0) {
    return []
  }
  const carried = await claudeAuthProxySlotsCarriedByLivePtys(current.port(), readEnvs)
  // The read took time: a spawn or a record may have claimed a candidate meanwhile.
  const referencedNow = referencedClaudeAuthProxySlots()
  const dropped: string[] = []
  for (const slot of candidates) {
    if (getClaudeAuthProxy() !== current || current.accountIdForSlot(slot) === null) {
      continue
    }
    const ptyId = carried.get(slot) ?? referencedNow.get(slot)
    if (ptyId) {
      bindClaudeAuthProxySlotToPty(slot, ptyId, now)
      recordCarriedClaudeAuthProxySlot(ptyId, slot, current.accountIdForSlot(slot))
      continue
    }
    releaseOwnClaudeAuthProxySlot(slot)
    dropped.push(slot)
  }
  return dropped
}

/** A pane row without a slot gains the one its shell carries, so the next prune need not read `ps`. */
function recordCarriedClaudeAuthProxySlot(
  ptyId: string,
  slot: string,
  billed: string | null
): void {
  const record = getClaudePaneAccount(ptyId)
  if (!record || record.proxySlot) {
    return
  }
  recordClaudePaneAccount({
    ...record,
    proxySlot: slot,
    assignedAccountId: billed ?? record.assignedAccountId ?? record.accountId
  })
}

/** One armed prune at a time; a later event re-arms the same one instead of adding another. */
let scheduled: ReturnType<typeof setTimeout> | null = null

/** Just past the unbound grace, so a slot minted by the arming event is already decidable. */
export const CLAUDE_AUTH_PROXY_PRUNE_DELAY_MS = CLAUDE_AUTH_PROXY_UNBOUND_SLOT_GRACE_MS + 1_000

/** Arms the next prune. Called when a slot is minted and when a PTY leaves the registry. */
export function scheduleClaudeAuthProxyPrune(delayMs = CLAUDE_AUTH_PROXY_PRUNE_DELAY_MS): void {
  if (scheduled || !getClaudeAuthProxy()) {
    return
  }
  scheduled = setTimeout(() => {
    scheduled = null
    pruneClaudeAuthProxySlots().catch((error: unknown) => {
      console.warn('[claude-auth-proxy] slot prune failed', error)
    })
  }, delayMs)
  scheduled.unref?.()
}

export function cancelScheduledClaudeAuthProxyPrune(): void {
  if (scheduled) {
    clearTimeout(scheduled)
    scheduled = null
  }
}
