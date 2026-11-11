import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { registerPty, unregisterPty } from '../../memory/pty-registry'
import {
  _internals,
  forgetClaudePaneAccount,
  getClaudePaneAccount,
  recordClaudePaneAccount
} from '../claude-pane-account-registry'
import { applyStructuredClaudeProxySlot } from '../../claude/claude-structured-pane-account'
import {
  claudeAuthProxyStatus,
  getClaudeAuthProxy,
  startClaudeAuthProxy,
  stopClaudeAuthProxy
} from './claude-auth-proxy-host'
import {
  cancelScheduledClaudeAuthProxyPrune,
  pruneClaudeAuthProxySlots,
  scheduleClaudeAuthProxyPrune,
  type ClaudeAuthProxyEnvReader
} from './claude-auth-proxy-prune'
import {
  dropUnboundAuthProxySlot,
  releaseSupersededOwnProxySlot,
  retainAppliedClaudeAuthProxySlot
} from './claude-auth-proxy-slot-env'
import {
  bindClaudeAuthProxySlotToPty,
  claudeAuthProxySlotOwner,
  claudeAuthProxySlotShouldPrune,
  CLAUDE_AUTH_PROXY_UNBOUND_SLOT_GRACE_MS,
  noteClaudeAuthProxySlotAllocated,
  resetClaudeAuthProxySlotOwners
} from './claude-auth-proxy-slot-owners'

const registered: string[] = []

function trackPty(ptyId: string, pid: number | null = null): void {
  registerPty({ ptyId, worktreeId: null, sessionId: null, paneKey: null, pid })
  registered.push(ptyId)
}

/** No live PTY carries any slot. */
const noEnvs: ClaudeAuthProxyEnvReader = async () => new Map()

function requireProxy(): NonNullable<ReturnType<typeof getClaudeAuthProxy>> {
  const proxy = getClaudeAuthProxy()
  if (!proxy || proxy.port() === null) {
    throw new Error('proxy did not start')
  }
  return proxy
}

afterEach(async () => {
  for (const ptyId of registered.splice(0)) {
    unregisterPty(ptyId)
  }
  forgetClaudePaneAccount('pty-pane')
  _internals.reset()
  resetClaudeAuthProxySlotOwners()
  cancelScheduledClaudeAuthProxyPrune()
  await stopClaudeAuthProxy()
})

describe('claude auth proxy slot owners', () => {
  it('drops an untracked slot, a dead PTY, and an unbound slot past the grace', () => {
    const now = 10_000
    expect(claudeAuthProxySlotShouldPrune('missing', new Set(), now)).toBe(true)
    noteClaudeAuthProxySlotAllocated('fresh', now)
    expect(
      claudeAuthProxySlotShouldPrune(
        'fresh',
        new Set(),
        now + CLAUDE_AUTH_PROXY_UNBOUND_SLOT_GRACE_MS
      )
    ).toBe(false)
    expect(
      claudeAuthProxySlotShouldPrune(
        'fresh',
        new Set(),
        now + CLAUDE_AUTH_PROXY_UNBOUND_SLOT_GRACE_MS + 1
      )
    ).toBe(true)
    bindClaudeAuthProxySlotToPty('held', 'pty-1', now)
    expect(claudeAuthProxySlotShouldPrune('held', new Set(['pty-1']), now + 99_000)).toBe(false)
    expect(claudeAuthProxySlotShouldPrune('held', new Set(), now + 99_000)).toBe(true)
  })
})

describe('claude auth proxy slot prune', () => {
  beforeEach(async () => {
    await startClaudeAuthProxy()
  })

  it('drops leaked slots and keeps a live PTY, a fresh unbound slot, and a pane record', async () => {
    const proxy = requireProxy()
    const port = proxy.port()
    const leaked = proxy.allocateSlot('leaked')
    const stale = proxy.allocateSlot('stale')
    noteClaudeAuthProxySlotAllocated(
      stale,
      // ast-grep-ignore: test-no-wall-clock -- prune compares this age with its own Date.now()
      Date.now() - CLAUDE_AUTH_PROXY_UNBOUND_SLOT_GRACE_MS - 1
    )
    const fresh = proxy.allocateSlot('fresh')
    noteClaudeAuthProxySlotAllocated(fresh)
    const live = proxy.allocateSlot('live')
    bindClaudeAuthProxySlotToPty(live, 'pty-live')
    trackPty('pty-live')
    const dead = proxy.allocateSlot('dead')
    bindClaudeAuthProxySlotToPty(dead, 'pty-dead')
    const referenced = proxy.allocateSlot('referenced')
    recordClaudePaneAccount({
      ptyId: 'pty-pane',
      paneKey: null,
      accountId: 'referenced',
      configDir: null,
      launchedAt: 1,
      pinned: false,
      source: 'spawn',
      proxySlot: referenced
    })
    resetClaudeAuthProxySlotOwners()
    bindClaudeAuthProxySlotToPty(live, 'pty-live')
    bindClaudeAuthProxySlotToPty(dead, 'pty-dead')
    noteClaudeAuthProxySlotAllocated(fresh)
    noteClaudeAuthProxySlotAllocated(
      stale,
      // ast-grep-ignore: test-no-wall-clock -- prune compares this age with its own Date.now()
      Date.now() - CLAUDE_AUTH_PROXY_UNBOUND_SLOT_GRACE_MS - 1
    )

    await pruneClaudeAuthProxySlots(undefined, noEnvs)
    const slots = claudeAuthProxyStatus().slots.map((entry) => entry.slot)
    expect(slots).toContain(fresh)
    expect(slots).toContain(live)
    expect(slots).toContain(referenced)
    expect(slots).not.toContain(leaked)
    expect(slots).not.toContain(stale)
    expect(slots).not.toContain(dead)
    expect(claudeAuthProxySlotOwner(referenced)?.ptyId).toBe('pty-pane')

    const terminal = proxy.allocateSlot('terminal')
    noteClaudeAuthProxySlotAllocated(terminal)
    const launch = proxy.allocateSlot('launch')
    noteClaudeAuthProxySlotAllocated(launch)
    expect(
      releaseSupersededOwnProxySlot(
        `http://127.0.0.1:${port}/p/${terminal}/`,
        `http://127.0.0.1:${port}/p/${launch}/`
      )
    ).toBe(true)
    expect(proxy.accountIdForSlot(terminal)).toBeNull()
    expect(proxy.accountIdForSlot(launch)).toBe('launch')
    expect(
      releaseSupersededOwnProxySlot(
        'https://gateway.example',
        `http://127.0.0.1:${port}/p/${launch}/`
      )
    ).toBe(false)

    const poll = proxy.allocateSlot('poll')
    noteClaudeAuthProxySlotAllocated(poll)
    const polled = dropUnboundAuthProxySlot({
      configDir: '/poll',
      envPatch: { ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}/p/${poll}/` },
      provenance: 'profile:poll'
    })
    expect(polled.envPatch.ANTHROPIC_BASE_URL).toBeUndefined()
    expect(proxy.accountIdForSlot(poll)).toBeNull()

    const shell = proxy.allocateSlot('shell')
    noteClaudeAuthProxySlotAllocated(shell)
    retainAppliedClaudeAuthProxySlot({
      ptyId: 'pty-shell',
      env: { ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}/p/${shell}/` },
      isReattach: false
    })
    expect(claudeAuthProxySlotOwner(shell)?.ptyId).toBe('pty-shell')
    const reattach = proxy.allocateSlot('reattach')
    noteClaudeAuthProxySlotAllocated(reattach)
    retainAppliedClaudeAuthProxySlot({
      ptyId: 'pty-reattach',
      env: { ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}/p/${reattach}/` },
      isReattach: true
    })
    expect(proxy.accountIdForSlot(reattach)).toBeNull()
  })

  it('status is a pure read: a leaked, a stale, and a dead-PTY slot all survive it', () => {
    const proxy = requireProxy()
    const leaked = proxy.allocateSlot('leaked')
    const stale = proxy.allocateSlot('stale')
    noteClaudeAuthProxySlotAllocated(stale, 1)
    const dead = proxy.allocateSlot('dead')
    bindClaudeAuthProxySlotToPty(dead, 'pty-dead', 1)
    const before = proxy
      .status()
      .slots.map((entry) => entry.slot)
      .sort()

    const seen = claudeAuthProxyStatus()
      .slots.map((entry) => entry.slot)
      .sort()
    expect(seen).toEqual(before)
    expect(seen).toEqual(expect.arrayContaining([leaked, stale, dead]))
    expect(
      proxy
        .status()
        .slots.map((entry) => entry.slot)
        .sort()
    ).toEqual(before)
    expect(claudeAuthProxySlotOwner(leaked)).toBeNull()
    expect(claudeAuthProxySlotOwner(dead)?.ptyId).toBe('pty-dead')
  })

  it('prune keeps a slot a live PTY still carries although no owner or pane record names it', async () => {
    const proxy = requireProxy()
    const port = proxy.port()
    const carried = proxy.allocateSlot('carried')
    const forgotten = proxy.allocateSlot('forgotten')
    trackPty('pty-shell', 4242)
    trackPty('pty-other', 4343)
    recordClaudePaneAccount({
      ptyId: 'pty-shell',
      paneKey: null,
      accountId: 'carried',
      configDir: null,
      launchedAt: 1,
      pinned: true,
      source: 'transcript'
    })
    const envs: ClaudeAuthProxyEnvReader = async (pids) => {
      expect([...pids].sort()).toEqual([4242, 4343])
      return new Map([[4242, `http://127.0.0.1:${port}/p/${carried}/`]])
    }

    const dropped = await pruneClaudeAuthProxySlots(undefined, envs)
    expect(dropped).toEqual([forgotten])
    expect(proxy.accountIdForSlot(carried)).toBe('carried')
    expect(proxy.accountIdForSlot(forgotten)).toBeNull()
    expect(claudeAuthProxySlotOwner(carried)?.ptyId).toBe('pty-shell')
    const record = getClaudePaneAccount('pty-shell')
    expect(record?.proxySlot).toBe(carried)
    expect(record?.assignedAccountId).toBe('carried')

    // Bound and recorded now: the next prune does not read a single process environment.
    const reads: number[][] = []
    await pruneClaudeAuthProxySlots(undefined, async (pids) => {
      reads.push([...pids])
      return new Map()
    })
    expect(reads).toEqual([])
    expect(proxy.accountIdForSlot(carried)).toBe('carried')
    forgetClaudePaneAccount('pty-shell')
  })

  it('prune ignores a carried URL on another port and a dead PTY', async () => {
    const proxy = requireProxy()
    const port = proxy.port()
    const foreign = proxy.allocateSlot('foreign')
    const dead = proxy.allocateSlot('dead')
    bindClaudeAuthProxySlotToPty(dead, 'pty-dead', 1)
    trackPty('pty-shell', 4242)
    const otherPort = port === 1 ? 2 : (port ?? 0) - 1
    const dropped = await pruneClaudeAuthProxySlots(
      undefined,
      async () => new Map([[4242, `http://127.0.0.1:${otherPort}/p/${foreign}/`]])
    )
    expect(dropped.sort()).toEqual([dead, foreign].sort())
  })

  it('a scheduled prune runs once after the grace and then stays idle', async () => {
    vi.useFakeTimers()
    try {
      const proxy = requireProxy()
      const stale = proxy.allocateSlot('stale')
      noteClaudeAuthProxySlotAllocated(stale, Date.now())
      scheduleClaudeAuthProxyPrune()
      scheduleClaudeAuthProxyPrune()
      expect(vi.getTimerCount()).toBe(1)
      await vi.advanceTimersByTimeAsync(CLAUDE_AUTH_PROXY_UNBOUND_SLOT_GRACE_MS + 1_000)
      expect(proxy.accountIdForSlot(stale)).toBeNull()
      expect(vi.getTimerCount()).toBe(0)
      cancelScheduledClaudeAuthProxyPrune()
    } finally {
      vi.useRealTimers()
    }
  })

  it('reuses a native chat slot when a later launch prepared another one', () => {
    const proxy = requireProxy()
    const port = proxy.port()
    const kept = proxy.allocateSlot('chat')
    noteClaudeAuthProxySlotAllocated(kept)
    recordClaudePaneAccount({
      ptyId: 'chat-key',
      paneKey: 'chat-key',
      surface: 'chat',
      accountId: 'chat',
      configDir: null,
      launchedAt: 1,
      pinned: false,
      source: 'spawn',
      proxySlot: kept,
      assignedAccountId: 'chat'
    })
    const fresh = proxy.allocateSlot('chat')
    noteClaudeAuthProxySlotAllocated(fresh)
    const freshUrl = `http://127.0.0.1:${port}/p/${fresh}/`
    const env = { ANTHROPIC_BASE_URL: freshUrl }
    expect(
      applyStructuredClaudeProxySlot({
        env,
        preparation: {
          configDir: '/chat',
          envPatch: { ANTHROPIC_BASE_URL: freshUrl },
          provenance: 'profile:chat'
        },
        existing: getClaudePaneAccount('chat-key'),
        reuseRecordedSlot: true,
        userPinnedUrl: false
      })
    ).toBe(kept)
    expect(env.ANTHROPIC_BASE_URL).toBe(`http://127.0.0.1:${port}/p/${kept}/`)
    expect(proxy.accountIdForSlot(fresh)).toBeNull()
    expect(proxy.accountIdForSlot(kept)).toBe('chat')

    const pinned = { ANTHROPIC_BASE_URL: 'https://api.example.test' }
    const unused = proxy.allocateSlot('unused')
    noteClaudeAuthProxySlotAllocated(unused)
    expect(
      applyStructuredClaudeProxySlot({
        env: pinned,
        preparation: {
          configDir: '/chat',
          envPatch: { ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}/p/${unused}/` },
          provenance: 'profile:chat'
        },
        existing: getClaudePaneAccount('chat-key'),
        reuseRecordedSlot: true,
        userPinnedUrl: true
      })
    ).toBeUndefined()
    expect(pinned.ANTHROPIC_BASE_URL).toBe('https://api.example.test')
    expect(proxy.accountIdForSlot(unused)).toBeNull()
    expect(proxy.accountIdForSlot(kept)).toBe('chat')

    forgetClaudePaneAccount('chat-key')
    expect(proxy.accountIdForSlot(kept)).toBeNull()
  })
})
