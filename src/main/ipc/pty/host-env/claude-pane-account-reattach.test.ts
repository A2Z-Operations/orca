import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  _internals,
  getClaudePaneAccount,
  recordClaudePaneAccount
} from '../../../claude-accounts/claude-pane-account-registry'
import {
  installClaudePaneAccountPersistence,
  type ClaudePaneAccountPersistence,
  type PersistedClaudePaneAccount
} from '../../../claude-accounts/claude-pane-account-persistence'
import type { ClaudeRuntimeAuthPreparation } from '../../../claude-accounts/runtime-auth-service'
import {
  limits,
  PANE_1,
  setup,
  state
} from '../../../claude-accounts/claude-session-mover-test-fixture'
import { recordClaudePaneAccountForSpawn } from './claude-pane-account'
import type { ReattachSlotProxy } from './claude-pane-proxy-slot-recovery'

const SLOT = 'a'.repeat(32)
const HOST = { runtime: 'host' as const }

function memoryPersistence(rows: PersistedClaudePaneAccount[]): ClaudePaneAccountPersistence {
  const panes = new Map(rows.map((row) => [row.ptyId, row]))
  return {
    save: (record) => {
      panes.set(record.ptyId, { ...record })
    },
    forget: (ptyId) => {
      panes.delete(ptyId)
    },
    read: (ptyId) => panes.get(ptyId) ?? null,
    proxyPort: () => null,
    setProxyPort: () => {}
  }
}

function fakeProxy(port: number, live: Record<string, string> = {}): ReattachSlotProxy {
  const slots = new Map(Object.entries(live))
  return {
    port: () => port,
    accountIdForSlot: (slot) => slots.get(slot) ?? null,
    adoptSlot: vi.fn((slot: string, accountId: string) => {
      slots.set(slot, accountId)
      return true
    })
  }
}

function auth(provenance = 'profile:a'): ClaudeRuntimeAuthPreparation {
  return {
    configDir: '/profiles/a/home',
    envPatch: {
      CLAUDE_CONFIG_DIR: '/profiles/a/home',
      ANTHROPIC_BASE_URL: 'http://127.0.0.1:4100/p/minted-for-this-reattach/'
    },
    provenance
  }
}

function persistedRow(overrides: Partial<PersistedClaudePaneAccount> = {}) {
  return {
    ptyId: 'pty-1',
    paneKey: PANE_1,
    accountId: 'a',
    assignedAccountId: 'b',
    configDir: '/profiles/a/home',
    launchedAt: 1_000,
    pinned: false,
    source: 'spawn' as const,
    proxySlot: SLOT,
    proxyPort: 4100,
    ...overrides
  }
}

function reattach(
  proxy: ReattachSlotProxy | null,
  readBaseUrl: (pid: number | null | undefined) => Promise<string | null> = async () => null
): void {
  recordClaudePaneAccountForSpawn({
    ptyId: 'pty-1',
    paneKey: PANE_1,
    isClaudeLaunch: true,
    isReattach: true,
    // Today's selection is `c`; the persisted row must win over it.
    claudeAuth: auth('profile:c'),
    settings: { activeClaudeManagedAccountId: 'c' },
    target: HOST,
    pid: 4242,
    proxy,
    readBaseUrl
  })
}

describe('reattach keeps the proxy slot', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    installClaudePaneAccountPersistence(null)
    _internals.reset()
    vi.useRealTimers()
  })

  it('reattach with a live slot keeps proxySlot and the billed account from the persisted row', () => {
    installClaudePaneAccountPersistence(memoryPersistence([persistedRow()]))
    reattach(fakeProxy(4100, { [SLOT]: 'b' }))
    expect(getClaudePaneAccount('pty-1')).toMatchObject({
      accountId: 'a',
      assignedAccountId: 'b',
      proxySlot: SLOT
    })
  })

  it('a restarted listener on the old port adopts the slot for the billed account', () => {
    installClaudePaneAccountPersistence(memoryPersistence([persistedRow()]))
    const proxy = fakeProxy(4100)
    reattach(proxy)
    expect(proxy.adoptSlot).toHaveBeenCalledWith(SLOT, 'b')
    expect(getClaudePaneAccount('pty-1')?.proxySlot).toBe(SLOT)
  })

  it('reattach → proxySlot present → proxy strategy chosen', async () => {
    installClaudePaneAccountPersistence(
      memoryPersistence([persistedRow({ assignedAccountId: 'a' })])
    )
    reattach(fakeProxy(4100, { [SLOT]: 'a' }))
    const proxyMove = vi.fn(async (request: { ptyId: string }) => ({
      kind: 'moved' as const,
      newPtyId: request.ptyId
    }))
    const f = setup({ proxyStrategy: { move: proxyMove } })
    f.session('pty-1', PANE_1, 'a', 'working')
    f.records[0] = { ...getClaudePaneAccount('pty-1')!, ptyId: 'pty-1' }
    f.mover.start()
    f.publish(state(96, { b: limits(20), c: limits(50) }))
    await vi.runAllTimersAsync()
    expect(proxyMove).toHaveBeenCalledTimes(1)
    expect(f.move).not.toHaveBeenCalled()
  })

  it('slot no longer listening → resume fallback (no crash)', async () => {
    installClaudePaneAccountPersistence(
      memoryPersistence([persistedRow({ assignedAccountId: 'a' })])
    )
    // The listener came back on another port: the PTY's baked URL cannot reach it.
    reattach(fakeProxy(5200))
    const record = getClaudePaneAccount('pty-1')
    expect(record).toMatchObject({ accountId: 'a' })
    expect(record?.proxySlot).toBeUndefined()
    const proxyMove = vi.fn()
    const f = setup({ proxyStrategy: { move: proxyMove } })
    f.session('pty-1', PANE_1, 'a', 'done')
    f.records[0] = { ...record!, ptyId: 'pty-1' }
    f.mover.start()
    f.publish(state(96, { b: limits(20), c: limits(50) }))
    await vi.runAllTimersAsync()
    expect(proxyMove).not.toHaveBeenCalled()
    expect(f.move).toHaveBeenCalledTimes(1)
  })

  it('no listener at all drops the slot instead of throwing', () => {
    installClaudePaneAccountPersistence(memoryPersistence([persistedRow()]))
    expect(() => reattach(null)).not.toThrow()
    expect(getClaudePaneAccount('pty-1')?.proxySlot).toBeUndefined()
  })

  it('without a persisted row, falls back to the slot in the process environment', async () => {
    const proxy = fakeProxy(4100, { [SLOT]: 'c' })
    const readBaseUrl = vi.fn(
      async (_pid: number | null | undefined) => `http://127.0.0.1:4100/p/${SLOT}/`
    )
    reattach(proxy, readBaseUrl)
    expect(readBaseUrl).toHaveBeenCalledWith(4242)
    // The row is recorded at once; the slot arrives when the environment read lands.
    expect(getClaudePaneAccount('pty-1')).toMatchObject({ accountId: 'c' })
    expect(getClaudePaneAccount('pty-1')?.proxySlot).toBeUndefined()
    await vi.waitFor(() =>
      expect(getClaudePaneAccount('pty-1')).toMatchObject({ accountId: 'c', proxySlot: SLOT })
    )
  })

  it('a slot read after the pane left or already has one does not overwrite it', async () => {
    const proxy = fakeProxy(4100, { [SLOT]: 'c', other: 'c' })
    let release: (url: string | null) => void = () => {}
    const pending = new Promise<string | null>((resolve) => {
      release = resolve
    })
    reattach(proxy, () => pending)
    const recorded = getClaudePaneAccount('pty-1')
    expect(recorded).not.toBeNull()
    if (recorded) {
      recordClaudePaneAccount({ ...recorded, proxySlot: 'other' })
    }
    release(`http://127.0.0.1:4100/p/${SLOT}/`)
    await pending
    expect(getClaudePaneAccount('pty-1')?.proxySlot).toBe('other')
  })

  it('ignores the slot minted for the reattach itself', async () => {
    reattach(fakeProxy(4100, { 'minted-for-this-reattach': 'c' }))
    await vi.waitFor(() => expect(getClaudePaneAccount('pty-1')?.proxySlot).toBeUndefined())
  })
})
