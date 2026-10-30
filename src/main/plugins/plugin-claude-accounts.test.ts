import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ClaudeManagedAccount } from '../../shared/managed-account-types'
import { parsePluginManifest } from '../../shared/plugins/manifest/plugin-manifest'
import type { PluginClaudeAccountView } from '../../shared/plugins/plugin-claude-account-contract'
import type { ProviderRateLimits, RateLimitWindow } from '../../shared/rate-limit-types'
import {
  publishClaudeAccountSessionMoved,
  setClaudeAccountPluginPublishListener
} from '../claude-accounts/claude-account-plugin-publish'
import type { ClaudePaneAccountRecord } from '../claude-accounts/claude-pane-account-registry'
import { deliverPluginEvent } from './plugin-event-delivery'
import {
  bindPluginClaudeAccountEvents,
  readPluginClaudeAccounts
} from './plugin-claude-account-events'
import {
  diffPluginClaudeAccountUsage,
  fingerprintPluginClaudeAccounts,
  projectPluginClaudeAccounts
} from './plugin-claude-account-projection'
import { executePluginHostCall, type PluginHostServices } from './workers/plugin-host-methods'
import type { ValidDiscoveredPlugin } from './plugin-discovery'
import type { PluginWorkerController } from './workers/plugin-worker-controller'

const SECRET = 'sk-ant-plugin-sentinel'

afterEach(() => {
  setClaudeAccountPluginPublishListener(null)
})

function window(usedPercent: number, extra: Partial<RateLimitWindow> = {}): RateLimitWindow {
  return {
    usedPercent,
    windowMinutes: 300,
    resetsAt: 1_700_000_000_000,
    resetDescription: '2:30 PM',
    ...extra
  }
}

function limits(usedPercent: number, extra: Partial<ProviderRateLimits> = {}): ProviderRateLimits {
  return {
    provider: 'claude',
    session: window(usedPercent),
    weekly: window(10, { windowMinutes: 10_080, resetsAt: null }),
    fableWeekly: null,
    updatedAt: 1_700_000_000_100,
    error: `Bearer ${SECRET}`,
    status: 'ok',
    extraUsage: {
      enabled: true,
      disabledReason: null,
      resetsAt: null,
      unit: 'currency',
      balance: 12,
      currencyCode: 'USD',
      spent: null,
      spendLimit: null,
      spentPercent: null
    },
    buckets: [{ name: SECRET, ...window(1) }],
    usageMetadata: { credentialSource: SECRET },
    ...extra
  }
}

function account(id: string, email = `${id}@example.com`): ClaudeManagedAccount {
  return {
    id,
    email,
    managedAuthPath: `/secret/${SECRET}/${id}`,
    authMethod: 'subscription-oauth',
    organizationUuid: SECRET,
    createdAt: 1,
    updatedAt: 1,
    lastAuthenticatedAt: 1
  }
}

function view(id: string, usedPercent: number, label = id, sessions = 0): PluginClaudeAccountView {
  return {
    id,
    label,
    assignedSessionCount: sessions,
    usage: {
      session: { usedPercent, windowMinutes: 300, resetsAt: null },
      weekly: null,
      fableWeekly: null,
      updatedAt: 1
    }
  }
}

function services(): PluginHostServices {
  return {
    resolveActiveWorktreeContext: vi.fn().mockResolvedValue(null),
    listWorktreeTerminals: vi.fn().mockResolvedValue([]),
    sendTerminalText: vi.fn().mockResolvedValue({ accepted: true }),
    dispatchPluginNotification: vi.fn().mockResolvedValue({ delivered: true }),
    storage: {
      get: vi.fn(),
      set: vi.fn(),
      delete: vi.fn(),
      keys: vi.fn().mockReturnValue([])
    },
    secrets: {
      get: vi.fn().mockReturnValue({ ok: true, value: null }),
      set: vi.fn().mockReturnValue({ ok: true }),
      delete: vi.fn()
    },
    settings: {
      getAll: vi.fn().mockReturnValue({}),
      set: vi.fn().mockReturnValue({ ok: true })
    },
    listClaudeAccounts: vi.fn().mockReturnValue({ accounts: [] })
  }
}

describe('projectPluginClaudeAccounts', () => {
  it('keeps ids, labels, windows, and billing counts, and drops secrets', () => {
    const panes: ClaudePaneAccountRecord[] = [
      {
        ptyId: 'pty-secret',
        paneKey: null,
        accountId: 'spawn',
        configDir: `/secret/${SECRET}`,
        launchedAt: 1,
        pinned: false,
        source: 'spawn',
        assignedAccountId: 'billed',
        providerSessionId: SECRET
      },
      {
        ptyId: 'pty-2',
        paneKey: null,
        accountId: 'billed',
        configDir: null,
        launchedAt: 1,
        pinned: false,
        source: 'spawn'
      }
    ]
    const projected = projectPluginClaudeAccounts({
      accounts: [
        account('host', 'host@example.com'),
        account('idle'),
        account('wsl'),
        account('billed'),
        account('spawn'),
        account('   ', 'blank-id@example.com'),
        account(` ${'a'.repeat(257)} `, 'long@example.com'),
        account(' labeled ', '   '),
        account('dup', 'first@example.com'),
        account('dup', 'second@example.com'),
        account('long-label', `${'e'.repeat(600)}@example.com`)
      ],
      activeAccountId: 'host',
      rateLimits: {
        claude: limits(40),
        inactiveClaudeAccounts: [
          { accountId: 'host', rateLimits: limits(99), updatedAt: 1, isFetching: false },
          { accountId: 'idle', rateLimits: limits(12), updatedAt: 1, isFetching: false },
          {
            accountId: 'billed',
            rateLimits: limits(3, { session: null, weekly: window(8, { windowMinutes: 10_080 }) }),
            updatedAt: 1,
            isFetching: false
          }
        ]
      },
      panes
    })

    const encoded = JSON.stringify(projected)
    expect(encoded).not.toContain(SECRET)
    expect(encoded).not.toContain('Bearer')
    expect(encoded).not.toContain('configDir')
    expect(encoded).not.toContain('2:30 PM')
    expect(encoded).not.toContain('USD')
    expect(encoded).not.toContain('organization')
    expect(projected.find((entry) => entry.id === 'host')).toMatchObject({
      label: 'host@example.com',
      assignedSessionCount: 0,
      usage: { session: { usedPercent: 40, windowMinutes: 300, resetsAt: 1_700_000_000_000 } }
    })
    expect(projected.find((entry) => entry.id === 'idle')?.usage.session?.usedPercent).toBe(12)
    expect(projected.find((entry) => entry.id === 'wsl')?.usage).toEqual({
      session: null,
      weekly: null,
      fableWeekly: null,
      updatedAt: null
    })
    expect(projected.find((entry) => entry.id === 'billed')).toMatchObject({
      assignedSessionCount: 2,
      usage: {
        session: null,
        weekly: { usedPercent: 8, windowMinutes: 10_080, resetsAt: 1_700_000_000_000 }
      }
    })
    expect(projected.find((entry) => entry.id === 'spawn')?.assignedSessionCount).toBe(0)
    expect(projected.find((entry) => entry.id === 'labeled')?.label).toBe('labeled')
    expect(projected.find((entry) => entry.id === 'dup')?.label).toBe('first@example.com')
    expect(projected.some((entry) => entry.id.includes('aaa'))).toBe(false)
    expect(projected.find((entry) => entry.id === 'long-label')?.label).toHaveLength(512)
    expect(Object.keys(projected[0] ?? {})).toEqual([
      'id',
      'label',
      'usage',
      'assignedSessionCount'
    ])
  })

  it('uses an inactive row when the host selection has no live reading', () => {
    const projected = projectPluginClaudeAccounts({
      accounts: [account('host')],
      activeAccountId: 'host',
      rateLimits: {
        claude: null,
        inactiveClaudeAccounts: [
          { accountId: 'host', rateLimits: limits(7), updatedAt: 1, isFetching: false }
        ]
      },
      panes: []
    })
    expect(projected[0]?.usage.session?.usedPercent).toBe(7)
  })

  it('drops a window that is not a finite quota and clamps a percent into range', () => {
    const projected = projectPluginClaudeAccounts({
      accounts: [account('host')],
      activeAccountId: 'host',
      rateLimits: {
        claude: limits(0, {
          session: window(Number.NaN),
          weekly: window(150, { windowMinutes: 300.9, resetsAt: Number.POSITIVE_INFINITY }),
          fableWeekly: window(-4, { windowMinutes: 0 }),
          updatedAt: Number.NaN
        }),
        inactiveClaudeAccounts: []
      },
      panes: []
    })
    expect(projected[0]?.usage).toEqual({
      session: null,
      weekly: { usedPercent: 100, windowMinutes: 300, resetsAt: null },
      fableWeekly: null,
      updatedAt: null
    })
  })

  it('sorts by id, caps the list, and caps a session count', () => {
    const accounts = Array.from({ length: 65 }, (_, index) =>
      account(`id-${String(index).padStart(2, '0')}`)
    )
    const panes = Array.from({ length: 10_001 }, () => ({
      accountId: 'id-00',
      assignedAccountId: undefined
    }))
    const projected = projectPluginClaudeAccounts({
      accounts,
      activeAccountId: null,
      rateLimits: { claude: null, inactiveClaudeAccounts: [] },
      panes
    })
    expect(projected).toHaveLength(64)
    expect(projected[0]?.id).toBe('id-00')
    expect(projected.at(-1)?.id).toBe('id-63')
    expect(projected[0]?.assignedSessionCount).toBe(10_000)
  })
})

describe('diffPluginClaudeAccountUsage', () => {
  it('stays quiet for the baseline, identical polls, label changes, and removals', () => {
    const initial = [view('a', 10, 'first', 1)]
    const baseline = fingerprintPluginClaudeAccounts(initial)
    expect(diffPluginClaudeAccountUsage(baseline, initial).changed).toEqual([])
    expect(diffPluginClaudeAccountUsage(baseline, [view('a', 10, 'renamed', 4)]).changed).toEqual(
      []
    )
    const removed = diffPluginClaudeAccountUsage(baseline, [])
    expect(removed.changed).toEqual([])
    expect(removed.next.size).toBe(0)
  })

  it('emits a changed window and a new account, without the session count', () => {
    const baseline = fingerprintPluginClaudeAccounts([view('a', 10)])
    const changed = diffPluginClaudeAccountUsage(baseline, [
      view('a', 11, 'A', 3),
      view('b', 4, 'B', 2)
    ])
    expect(changed.changed).toEqual([
      {
        accountId: 'a',
        label: 'A',
        usage: view('a', 11).usage
      },
      {
        accountId: 'b',
        label: 'B',
        usage: view('b', 4).usage
      }
    ])
    expect(JSON.stringify(changed.changed)).not.toContain('assignedSessionCount')
  })
})

describe('bindPluginClaudeAccountEvents', () => {
  it('baselines the first read and emits only a later usage change', () => {
    let accounts = [view('a', 10, 'A')]
    const emitted: { event: string; payload: unknown }[] = []
    const listeners = new Set<() => void>()
    const release = bindPluginClaudeAccountEvents({
      emit: (event, payload) => emitted.push({ event, payload }),
      readAccounts: () => accounts,
      subscribeRateLimits: (listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      }
    })
    expect(readPluginClaudeAccounts().accounts).toEqual(accounts)
    for (const listener of listeners) {
      listener()
    }
    expect(emitted).toEqual([])
    accounts = [view('a', 10, 'renamed')]
    for (const listener of listeners) {
      listener()
    }
    expect(emitted).toEqual([])
    accounts = [view('a', 22, 'renamed')]
    for (const listener of listeners) {
      listener()
    }
    expect(emitted).toEqual([
      {
        event: 'accounts.usage.changed',
        payload: {
          accountId: 'a',
          label: 'renamed',
          usage: view('a', 22).usage
        }
      }
    ])
    release()
    expect(readPluginClaudeAccounts()).toEqual({ accounts: [] })
  })

  it('publishes a session move and skips a move onto the same account', () => {
    const emitted: unknown[] = []
    const release = bindPluginClaudeAccountEvents({
      emit: (_event, payload) => emitted.push(payload),
      readAccounts: () => [],
      subscribeRateLimits: () => () => undefined
    })
    publishClaudeAccountSessionMoved({
      ptyId: 'pty-new',
      fromAccountId: 'a',
      toAccountId: 'b',
      previousPtyId: 'pty-old'
    })
    publishClaudeAccountSessionMoved({
      ptyId: 'pty-1',
      fromAccountId: 'a',
      toAccountId: 'a',
      previousPtyId: 'pty-0'
    })
    publishClaudeAccountSessionMoved({
      ptyId: 'pty-1',
      fromAccountId: 'a',
      toAccountId: 'c',
      previousPtyId: 'pty-1'
    })
    expect(emitted).toEqual([
      { ptyId: 'pty-new', fromAccountId: 'a', toAccountId: 'b', previousPtyId: 'pty-old' },
      { ptyId: 'pty-1', fromAccountId: 'a', toAccountId: 'c' }
    ])
    release()
  })
})

describe('publishClaudeAccountSessionMoved', () => {
  it('does nothing when unbound and ignores a listener that throws', () => {
    expect(() =>
      publishClaudeAccountSessionMoved({
        ptyId: 'pty-1',
        fromAccountId: 'a',
        toAccountId: 'b'
      })
    ).not.toThrow()
    setClaudeAccountPluginPublishListener(() => {
      throw new Error('plugin failed')
    })
    expect(() =>
      publishClaudeAccountSessionMoved({
        ptyId: 'pty-1',
        fromAccountId: 'a',
        toAccountId: 'b'
      })
    ).not.toThrow()
  })
})

describe('accounts.listClaudeAccounts', () => {
  it('denies a worker without accounts.read and a sandboxed panel', async () => {
    const host = services()
    const denied = await executePluginHostCall({
      pluginId: 'orca-samples.demo',
      method: 'accounts.listClaudeAccounts',
      params: {},
      surface: 'worker',
      grantedCapabilities: [],
      services: host
    })
    const panel = await executePluginHostCall({
      pluginId: 'orca-samples.demo',
      method: 'accounts.listClaudeAccounts',
      params: {},
      surface: 'panel',
      grantedCapabilities: ['accounts.read'],
      services: host
    })
    expect(denied).toMatchObject({
      ok: false,
      code: 'capability_denied',
      error: 'plugin does not have the "accounts.read" capability'
    })
    expect(panel).toMatchObject({
      ok: false,
      code: 'not_permitted',
      error: 'method accounts.listClaudeAccounts is not available to plugin panels'
    })
    expect(host.listClaudeAccounts).not.toHaveBeenCalled()
  })

  it('returns the projection and fails closed when a token field is present', async () => {
    const projected = projectPluginClaudeAccounts({
      accounts: [account('host', 'host@example.com')],
      activeAccountId: 'host',
      rateLimits: { claude: limits(40), inactiveClaudeAccounts: [] },
      panes: []
    })
    const host = services()
    host.listClaudeAccounts = () => ({ accounts: projected })
    const outcome = await executePluginHostCall({
      pluginId: 'orca-samples.demo',
      method: 'accounts.listClaudeAccounts',
      params: undefined,
      surface: 'worker',
      grantedCapabilities: ['accounts.read'],
      services: host
    })
    expect(outcome).toEqual({ ok: true, value: { accounts: projected } })
    expect(JSON.stringify(outcome)).not.toContain(SECRET)

    host.listClaudeAccounts = () =>
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the service type forbids a token field; this plants one to prove the schema rejects it.
      ({ accounts: [], accessToken: SECRET }) as { accounts: PluginClaudeAccountView[] }
    const leaked = await executePluginHostCall({
      pluginId: 'orca-samples.demo',
      method: 'accounts.listClaudeAccounts',
      params: {},
      surface: 'worker',
      grantedCapabilities: ['accounts.read'],
      services: host
    })
    expect(leaked).toEqual({
      ok: false,
      code: 'action_failed',
      error: 'internal: malformed accounts.listClaudeAccounts result'
    })
    expect(JSON.stringify(leaked)).not.toContain(SECRET)
  })
})

function manifest(events: string[], capabilities: string[]): Record<string, unknown> {
  return {
    manifestVersion: 1,
    id: 'demo',
    publisher: 'orca-samples',
    name: 'Demo',
    version: '1.0.0',
    engines: { orca: '>=1.0.0' },
    pluginApi: 1,
    main: 'main.mjs',
    contributes: { events: events.map((on) => ({ on })) },
    capabilities: capabilities.map((kind) => ({ kind }))
  }
}

describe('account event manifest validation', () => {
  it('requires accounts.read for account events and events:subscribe for the others', () => {
    expect(parsePluginManifest(manifest(['accounts.usage.changed'], ['accounts.read'])).ok).toBe(
      true
    )
    expect(parsePluginManifest(manifest(['accounts.session.moved'], ['events:subscribe'])).ok).toBe(
      false
    )
    expect(parsePluginManifest(manifest(['worktree.created'], ['events:subscribe'])).ok).toBe(true)
    expect(parsePluginManifest(manifest(['worktree.created'], ['accounts.read'])).ok).toBe(false)
    const mixed = parsePluginManifest(
      manifest(['worktree.created', 'accounts.session.moved'], ['accounts.read'])
    )
    expect(mixed.ok).toBe(false)
    if (!mixed.ok) {
      expect(mixed.error).toContain('workspace:read')
    }
    expect(
      parsePluginManifest(
        manifest(
          ['worktree.created', 'accounts.usage.changed', 'accounts.session.moved'],
          ['events:subscribe', 'accounts.read']
        )
      ).ok
    ).toBe(true)
  })
})

function discovered(events: string[], capabilities: string[]): ValidDiscoveredPlugin {
  const parsed = parsePluginManifest(manifest(events, capabilities))
  if (!parsed.ok) {
    throw new Error(parsed.error)
  }
  return {
    pluginKey: 'orca-samples.demo',
    rootDir: '/tmp/plugin',
    manifest: parsed.manifest,
    consentFingerprint: 'fingerprint',
    contentHash: null,
    isDev: true
  }
}

describe('deliverPluginEvent account capability', () => {
  it('skips account events unless the grant includes accounts.read', async () => {
    const delivered: string[] = []
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: delivery only calls ensure, then deliverEvent on the handle.
    const workerController = {
      ensure: vi.fn(async () => ({
        deliverEvent: (event: string) => delivered.push(`manifest:${event}`)
      }))
    } as unknown as PluginWorkerController
    const usage = {
      accountId: 'a',
      label: 'a@example.com',
      usage: { session: null, weekly: null, fableWeekly: null, updatedAt: null }
    }
    const subscribed = discovered(['accounts.usage.changed'], ['accounts.read'])
    deliverPluginEvent({
      event: 'accounts.usage.changed',
      payload: usage,
      plugins: [subscribed],
      workerController,
      isRuntimeApproved: () => true,
      grantedCapabilities: () => ['workspace:read', 'agent:read'],
      logWarning: () => () => undefined
    })
    await Promise.resolve()
    expect(delivered).toEqual([])
    expect(workerController.ensure).not.toHaveBeenCalled()

    delivered.length = 0
    deliverPluginEvent({
      event: 'accounts.usage.changed',
      payload: usage,
      plugins: [subscribed],
      workerController,
      isRuntimeApproved: () => true,
      grantedCapabilities: () => ['accounts.read'],
      logWarning: () => () => undefined
    })
    await vi.waitFor(() => expect(delivered).toEqual(['manifest:accounts.usage.changed']))
  })
})
