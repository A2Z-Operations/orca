import { createServer, request as httpRequest } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installClaudeProfileRouter } from '../claude-profile-installed-router'
import {
  installClaudePaneAccountPersistence,
  type ClaudePaneAccountPersistence,
  type PersistedClaudePaneAccount
} from '../claude-pane-account-persistence'
import { readClaudeOAuthCredentials } from '../../rate-limits/claude-oauth-credentials'
import {
  bindClaudeAuthProxyAccountDir,
  claudeAuthProxyStatus,
  getClaudeAuthProxy,
  noteClaudePaneReattached,
  readClaudeAuthProxyAccessToken,
  startClaudeAuthProxy,
  stopClaudeAuthProxy
} from './claude-auth-proxy-host'
import {
  adoptPersistedClaudeAuthProxySlots,
  type PersistedSlotProxy
} from './claude-auth-proxy-persisted-slots'
import type { ClaudeAuthProxy, ClaudeAuthProxyOptions } from './claude-auth-proxy'

vi.mock('../../rate-limits/claude-oauth-credentials', () => ({
  readClaudeOAuthCredentials: vi.fn()
}))

/** The host hard-wires api.anthropic.com; a test that sends a real request points it at a fake. */
const fakeUpstream = vi.hoisted((): { url: string | null } => ({ url: null }))
vi.mock('./claude-auth-proxy', async (importOriginal) => {
  const actual = await importOriginal<{
    createClaudeAuthProxy: (options: ClaudeAuthProxyOptions) => ClaudeAuthProxy
  }>()
  return {
    ...actual,
    createClaudeAuthProxy: (options: ClaudeAuthProxyOptions) =>
      actual.createClaudeAuthProxy(
        fakeUpstream.url ? { ...options, upstream: fakeUpstream.url } : options
      )
  }
})

afterEach(async () => {
  installClaudeProfileRouter(undefined)
  fakeUpstream.url = null
  await stopClaudeAuthProxy()
})

describe('readClaudeAuthProxyAccessToken', () => {
  it('returns null when the credential read throws and does not log the secret', async () => {
    vi.mocked(readClaudeOAuthCredentials).mockRejectedValue(new Error('sk-ant-secret-token'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    bindClaudeAuthProxyAccountDir('acct', '/tmp/claude-home')
    await expect(readClaudeAuthProxyAccessToken('acct')).resolves.toBeNull()
    const logged = [...warn.mock.calls, ...info.mock.calls, ...error.mock.calls].flat().join(' ')
    expect(logged).not.toContain('sk-ant-secret-token')
    warn.mockRestore()
    info.mockRestore()
    error.mockRestore()
  })

  it('returns null when the reader reports the store unavailable', async () => {
    vi.mocked(readClaudeOAuthCredentials).mockResolvedValue({
      token: null,
      hasRefreshableCredentials: false,
      source: 'credentials-file',
      unavailable: true
    })
    bindClaudeAuthProxyAccountDir('acct', '/tmp/claude-home')
    await expect(readClaudeAuthProxyAccessToken('acct')).resolves.toBeNull()
  })
})

const SLOT_A = 'a'.repeat(32)
const SLOT_B = 'b'.repeat(32)

function persistedRow(
  overrides: Partial<PersistedClaudePaneAccount> = {}
): PersistedClaudePaneAccount {
  return {
    ptyId: 'pty-1',
    paneKey: null,
    accountId: 'acct-a',
    assignedAccountId: 'acct-b',
    configDir: null,
    launchedAt: 1_000,
    pinned: false,
    source: 'spawn',
    proxySlot: SLOT_A,
    proxyPort: 4100,
    ...overrides
  }
}

function memoryPersistence(
  rows: PersistedClaudePaneAccount[],
  proxyPort: number | null = null
): ClaudePaneAccountPersistence {
  const panes = new Map(rows.map((row) => [row.ptyId, row]))
  return {
    save: (record) => {
      panes.set(record.ptyId, { ...record })
    },
    forget: (ptyId) => {
      panes.delete(ptyId)
    },
    read: (ptyId) => panes.get(ptyId) ?? null,
    rows: () => [...panes.values()],
    proxyPort: () => proxyPort,
    setProxyPort: (port) => {
      proxyPort = port
    }
  }
}

function fakeStartProxy(port: number | null): PersistedSlotProxy & { slots: Map<string, string> } {
  const slots = new Map<string, string>()
  return {
    slots,
    port: () => port,
    adoptSlot: vi.fn((slot: string, accountId: string) => {
      slots.set(slot, accountId)
      return true
    }),
    endStartupGrace: vi.fn()
  }
}

function statusOf(url: string): Promise<{ status: number; retryAfter: string | undefined }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(url, { method: 'POST' }, (res) => {
      res.resume()
      res.on('end', () =>
        resolve({
          status: res.statusCode ?? 0,
          retryAfter: Array.isArray(res.headers['retry-after'])
            ? res.headers['retry-after'][0]
            : res.headers['retry-after']
        })
      )
      res.on('error', reject)
    })
    req.on('error', reject)
    req.end('{"hi":1}')
  })
}

describe('adoptPersistedClaudeAuthProxySlots', () => {
  it('re-registers the slots minted on this port for their billed account and skips the rest', () => {
    const proxy = fakeStartProxy(4100)
    const adoption = adoptPersistedClaudeAuthProxySlots(proxy, [
      persistedRow(),
      persistedRow({ ptyId: 'pty-2', proxySlot: SLOT_B, proxyPort: 4200 }),
      persistedRow({ ptyId: 'pty-3', proxySlot: undefined, proxyPort: undefined }),
      persistedRow({ ptyId: 'pty-4', proxySlot: 'c'.repeat(32), assignedAccountId: undefined })
    ])
    expect(adoption.adopted).toEqual([SLOT_A, 'c'.repeat(32)])
    expect([...proxy.slots.entries()]).toEqual([
      [SLOT_A, 'acct-b'],
      ['c'.repeat(32), 'acct-a']
    ])
    expect(adoption.pending()).toBe(4)
  })

  it('adopts nothing without a port and ends the grace once every persisted pane reattached', () => {
    const proxy = fakeStartProxy(null)
    const adoption = adoptPersistedClaudeAuthProxySlots(proxy, [
      persistedRow(),
      persistedRow({ ptyId: 'pty-2', proxySlot: undefined })
    ])
    expect(adoption.adopted).toEqual([])
    expect(proxy.adoptSlot).not.toHaveBeenCalled()
    adoption.reattached('pty-1')
    adoption.reattached('pty-1')
    adoption.reattached('unknown-pty')
    expect(proxy.endStartupGrace).not.toHaveBeenCalled()
    adoption.reattached('pty-2')
    expect(proxy.endStartupGrace).toHaveBeenCalledTimes(1)
    adoption.reattached('pty-2')
    expect(proxy.endStartupGrace).toHaveBeenCalledTimes(1)
  })

  it('leaves the grace to its cap when nothing was persisted', () => {
    const proxy = fakeStartProxy(4100)
    const adoption = adoptPersistedClaudeAuthProxySlots(proxy, [])
    adoption.reattached('pty-1')
    expect(proxy.endStartupGrace).not.toHaveBeenCalled()
    expect(adoption.pending()).toBe(0)
  })
})

/**
 * A restart on the recovered port: a first listener learns a free port the "previous" listener
 * would have persisted, then the second starts from the persisted rows on that port.
 */
async function restartWithPersistedRows(): Promise<number> {
  installClaudePaneAccountPersistence(memoryPersistence([]))
  await startClaudeAuthProxy()
  const port = getClaudeAuthProxy()?.port()
  expect(port).not.toBeNull()
  await stopClaudeAuthProxy()

  installClaudePaneAccountPersistence(
    memoryPersistence(
      [
        persistedRow({ proxyPort: port! }),
        persistedRow({ ptyId: 'pty-2', proxySlot: SLOT_B, proxyPort: port! + 1 }),
        persistedRow({ ptyId: 'pty-3', proxySlot: undefined, proxyPort: undefined })
      ],
      port
    )
  )
  await startClaudeAuthProxy()
  expect(getClaudeAuthProxy()?.port()).toBe(port)
  return port!
}

function listenFakeUpstream(): Promise<{
  url: string
  seen: { url: string | undefined; authorization: string | undefined }[]
  close: () => Promise<void>
}> {
  const seen: { url: string | undefined; authorization: string | undefined }[] = []
  const upstream = createServer((req, res) => {
    seen.push({ url: req.url, authorization: req.headers.authorization })
    req.resume()
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{"ok":true}')
    })
  })
  return new Promise((resolve, reject) => {
    upstream.once('error', reject)
    upstream.listen(0, '127.0.0.1', () => {
      const address = upstream.address()
      const port = address && typeof address === 'object' ? address.port : 0
      resolve({
        url: `http://127.0.0.1:${port}`,
        seen,
        close: () =>
          new Promise((done) => {
            upstream.closeIdleConnections()
            upstream.close(() => done())
          })
      })
    })
  })
}

describe('startClaudeAuthProxy', () => {
  it('registers the persisted slots when the listener starts, before any reattach', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    try {
      const port = await restartWithPersistedRows()
      const proxy = getClaudeAuthProxy()
      expect(proxy?.accountIdForSlot(SLOT_A)).toBe('acct-b')
      expect(proxy?.accountIdForSlot(SLOT_B)).toBeNull()
      expect(info.mock.calls.flat().join('\n')).toContain('re-registered 1 persisted slot')

      // An unknown slot is refused, not forwarded: 503 during the grace, 502 once every pane is back.
      const unknown = `http://127.0.0.1:${port}/p/${'d'.repeat(32)}/v1/messages`
      expect(await statusOf(unknown)).toEqual({ status: 503, retryAfter: '2' })
      noteClaudePaneReattached('pty-1')
      noteClaudePaneReattached('pty-2')
      expect(await statusOf(unknown)).toEqual({ status: 503, retryAfter: '2' })
      noteClaudePaneReattached('pty-3')
      expect(await statusOf(unknown)).toEqual({ status: 502, retryAfter: undefined })
      expect(claudeAuthProxyStatus().unknownSlotRequests).toBe(1)
      expect(claudeAuthProxyStatus().lastError).toBeNull()
    } finally {
      info.mockRestore()
    }
  })

  it('forwards a request on a re-registered slot with the billed account bearer, before any reattach', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const upstream = await listenFakeUpstream()
    fakeUpstream.url = upstream.url
    try {
      vi.mocked(readClaudeOAuthCredentials).mockClear()
      vi.mocked(readClaudeOAuthCredentials).mockImplementation(async (options) => ({
        token:
          options?.credentialsFileConfigDir === '/tmp/claude-home-acct-b'
            ? 'tok-acct-b'
            : 'tok-wrong',
        hasRefreshableCredentials: false,
        source: 'credentials-file'
      }))
      const port = await restartWithPersistedRows()
      // No profile router: the host reads the folder bound to the account id (a stop clears the map).
      bindClaudeAuthProxyAccountDir('acct-a', '/tmp/claude-home-acct-a')
      bindClaudeAuthProxyAccountDir('acct-b', '/tmp/claude-home-acct-b')

      const response = await statusOf(`http://127.0.0.1:${port}/p/${SLOT_A}/v1/messages`)
      expect(response).toEqual({ status: 200, retryAfter: undefined })
      // The slot the row persisted bills the assigned account, not the launch account.
      expect(upstream.seen).toEqual([{ url: '/v1/messages', authorization: 'Bearer tok-acct-b' }])
      expect(vi.mocked(readClaudeOAuthCredentials)).toHaveBeenCalledTimes(1)
      expect(vi.mocked(readClaudeOAuthCredentials).mock.calls[0]?.[0]).toMatchObject({
        credentialsFileConfigDir: '/tmp/claude-home-acct-b'
      })
      expect(claudeAuthProxyStatus().unknownSlotRequests).toBe(0)
      expect(claudeAuthProxyStatus().lastError).toBeNull()
      expect(claudeAuthProxyStatus().requestsLastHour).toEqual([{ accountId: 'acct-b', count: 1 }])
    } finally {
      info.mockRestore()
      await stopClaudeAuthProxy()
      await upstream.close()
    }
  })
})
