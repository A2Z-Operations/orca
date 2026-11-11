import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  getClaudeAuthProxy,
  startClaudeAuthProxy,
  stopClaudeAuthProxy
} from '../../../claude-accounts/claude-auth-proxy/claude-auth-proxy-host'
import {
  cancelScheduledClaudeAuthProxyPrune,
  pruneClaudeAuthProxySlots
} from '../../../claude-accounts/claude-auth-proxy/claude-auth-proxy-prune'
import {
  bindClaudeAuthProxySlotToPty,
  claudeAuthProxySlotOwner,
  resetClaudeAuthProxySlotOwners
} from '../../../claude-accounts/claude-auth-proxy/claude-auth-proxy-slot-owners'
import {
  _internals,
  getClaudePaneAccount,
  type ClaudePaneAccountRecord
} from '../../../claude-accounts/claude-pane-account-registry'
import { collectClaudeMoverSessions } from '../../../claude-accounts/claude-session-mover-sessions'
import { registerPty, unregisterPty } from '../../../memory/pty-registry'
import {
  adoptClaudePaneProxySlot,
  recordInferredClaudePaneAccount
} from './claude-pane-slot-adoption'

const PANE = 'tab-1:0195f2ce-1111-4000-8000-000000000001'
const PTY = 'folder:abc@@def'

function requireProxy(): NonNullable<ReturnType<typeof getClaudeAuthProxy>> {
  const proxy = getClaudeAuthProxy()
  if (!proxy || proxy.port() === null) {
    throw new Error('proxy did not start')
  }
  return proxy
}

const HOME = '/profiles/acct-a/home'
/** Claude writes `<CLAUDE_CONFIG_DIR>/projects/<project>/<session>.jsonl`; inference reads the path. */
const TRANSCRIPT = `${HOME}/projects/p/session.jsonl`

/** The mover's inference pass, wired as the provider wires it. */
function infer(): ClaudePaneAccountRecord[] {
  const inferred: ClaudePaneAccountRecord[] = []
  collectClaudeMoverSessions({
    records: [],
    statuses: [],
    providerSessions: [{ paneKey: PANE, sessionId: 'sess-1', transcriptPath: TRANSCRIPT }],
    resolveProviderSession: () => null,
    resolvePaneKey: () => PANE,
    resolvePtyIdForPaneKey: () => PTY,
    resolveWorktreeId: () => null,
    accounts: [{ id: 'acct-a', homes: [HOME] }],
    recordInferred: (record) => {
      inferred.push(record)
      recordInferredClaudePaneAccount(record)
    },
    now: 1
  })
  return inferred
}

beforeEach(async () => {
  await startClaudeAuthProxy()
})

afterEach(async () => {
  unregisterPty(PTY)
  _internals.reset()
  resetClaudeAuthProxySlotOwners()
  cancelScheduledClaudeAuthProxyPrune()
  await stopClaudeAuthProxy()
})

describe('transcript inference records the pane slot', () => {
  it('carries the slot the shell bound at spawn, and the prune then keeps it', async () => {
    const proxy = requireProxy()
    const slot = proxy.allocateSlot('acct-a')
    bindClaudeAuthProxySlotToPty(slot, PTY, 1)
    registerPty({ ptyId: PTY, worktreeId: null, sessionId: null, paneKey: PANE, pid: null })

    const inferred = infer()
    expect(inferred).toHaveLength(1)
    expect(inferred[0]?.source).toBe('transcript')
    const record = getClaudePaneAccount(PTY)
    expect(record?.source).toBe('transcript')
    expect(record?.pinned).toBe(true)
    expect(record?.proxySlot).toBe(slot)
    expect(record?.assignedAccountId).toBe('acct-a')

    // The incident: a status-triggered prune dropped this slot. Now nothing drops it.
    const dropped = await pruneClaudeAuthProxySlots(undefined, async () => new Map())
    expect(dropped).toEqual([])
    expect(proxy.accountIdForSlot(slot)).toBe('acct-a')
  })

  it('reads the slot from the process environment when the owner table forgot it', async () => {
    const proxy = requireProxy()
    const port = proxy.port()
    const slot = proxy.allocateSlot('acct-a')
    registerPty({ ptyId: PTY, worktreeId: null, sessionId: null, paneKey: PANE, pid: 4242 })

    infer()
    expect(getClaudePaneAccount(PTY)?.proxySlot).toBeUndefined()

    // The provider wires the real `ps` read; the test drives the same adoption with a fake read.
    let resolveRead: (url: string | null) => void = () => {}
    const read = new Promise<string | null>((resolve) => {
      resolveRead = resolve
    })
    adoptClaudePaneProxySlot(PTY, 'acct-a', { pid: 4242, readBaseUrl: () => read })
    resolveRead(`http://127.0.0.1:${port}/p/${slot}/`)
    await read
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(getClaudePaneAccount(PTY)?.proxySlot).toBe(slot)
    expect(claudeAuthProxySlotOwner(slot)?.ptyId).toBe(PTY)
  })

  it('leaves a record alone when no slot is bound and the environment has none', async () => {
    requireProxy()
    registerPty({ ptyId: PTY, worktreeId: null, sessionId: null, paneKey: PANE, pid: null })
    infer()
    const before = getClaudePaneAccount(PTY)
    expect(before?.proxySlot).toBeUndefined()
    adoptClaudePaneProxySlot(PTY, 'acct-a', { pid: null, readBaseUrl: async () => null })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(getClaudePaneAccount(PTY)).toEqual(before)
  })
})
