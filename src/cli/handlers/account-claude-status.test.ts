import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ACCOUNT_HANDLERS } from './account'
import { RuntimeClient } from '../runtime-client'
import type { HandlerContext } from '../dispatch'
import type { ClaudeRateLimitAccountsState } from '../../shared/managed-account-types'

const NOW = Date.parse('2026-11-05T07:00:00.000Z')

const account = (id: string) => ({
  id,
  email: `${id}@example.com`,
  managedAuthRuntime: 'host' as const,
  wslDistro: null,
  authMethod: 'subscription-oauth' as const,
  createdAt: 0,
  updatedAt: 0,
  lastAuthenticatedAt: 0
})

const claude: ClaudeRateLimitAccountsState = {
  accounts: [account('a'), account('b'), account('c')],
  activeAccountId: 'a',
  autoSwitchEnabled: true,
  sessionMover: 'move',
  pool: 'on',
  assignedSessions: [
    { accountId: 'a', count: 3 },
    { accountId: 'b', count: 1, chatCount: 1 }
  ],
  usageWindows: [
    {
      accountId: 'a',
      session: 96,
      weekly: 40,
      fable: 30,
      readAt: NOW - 120_000,
      source: 'selected'
    },
    {
      accountId: 'b',
      session: 10,
      weekly: 20,
      fable: null,
      readAt: NOW - 9 * 60_000,
      source: 'cached'
    },
    {
      accountId: 'c',
      session: null,
      weekly: null,
      fable: null,
      readAt: null,
      source: null,
      unavailable: '429'
    }
  ],
  sessionMoves: [
    {
      ptyId: '1',
      paneKey: null,
      fromAccountId: 'a',
      toAccountId: null,
      window: null,
      percent: null,
      line: null,
      reason: 'under-line',
      at: 1,
      strategy: 'proxy'
    },
    {
      ptyId: '2',
      paneKey: null,
      fromAccountId: 'a',
      toAccountId: null,
      window: null,
      percent: null,
      line: null,
      reason: 'under-line',
      at: 1,
      strategy: 'proxy'
    },
    {
      ptyId: '3',
      paneKey: null,
      fromAccountId: 'b',
      toAccountId: null,
      window: null,
      percent: null,
      line: null,
      reason: 'wait:mid-turn',
      at: 1,
      strategy: 'resume'
    },
    {
      ptyId: '1',
      paneKey: null,
      fromAccountId: 'a',
      toAccountId: 'a',
      window: null,
      percent: null,
      line: null,
      reason: 'fable-line',
      at: 1,
      kind: 'model',
      strategy: 'proxy'
    }
  ]
}

describe('account --status and account usage', () => {
  const client = new RuntimeClient()
  const callMock = vi.spyOn(client, 'call')
  let logSpy: ReturnType<typeof vi.spyOn>

  function context(flags: [string, string | boolean][], json = false): HandlerContext {
    return { client, cwd: process.cwd(), flags: new Map(flags), json, rawArgs: [] }
  }

  const printed = (): string => String(logSpy.mock.calls.at(-1)?.[0])

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    callMock.mockReset()
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    callMock.mockResolvedValue({ id: 't', ok: true, result: { claude }, _meta: { runtimeId: 'r' } })
  })
  afterEach(() => {
    logSpy.mockRestore()
    vi.useRealTimers()
  })

  it('auto-switch --status prints the setting, selection, and accounts at a line', async () => {
    await ACCOUNT_HANDLERS['account auto-switch'](context([['status', true]]))
    expect(callMock).toHaveBeenCalledWith('accounts.list', { refreshUsage: false })
    expect(printed()).toBe(
      [
        'Claude auto-switch: on',
        '  selected: a@example.com',
        '  accounts: 3 (2 with a usage reading, 1 at a line)'
      ].join('\n')
    )
  })

  it('session-mover --status counts decisions by reason and strategy, and flips apart', async () => {
    await ACCOUNT_HANDLERS['account session-mover'](context([['status', true]]))
    expect(printed()).toBe(
      [
        'Claude session-mover: move',
        '  sessions: 3 (proxy 2, resume 1)',
        '  last decisions: under-line 2, wait:mid-turn 1',
        '  model flips: 1'
      ].join('\n')
    )
    await ACCOUNT_HANDLERS['account session-mover'](context([['status', true]], true))
    expect(JSON.parse(printed())).toMatchObject({ sessions: 3, reasons: { 'under-line': 2 } })
  })

  it('pool --status lists live sessions per account', async () => {
    await ACCOUNT_HANDLERS['account pool'](context([['status', true]]))
    expect(printed()).toBe(
      [
        'Claude account pool: on',
        '  a@example.com: 3 sessions',
        '  b@example.com: 1 sessions (1 chat)',
        '  c@example.com: 0 sessions'
      ].join('\n')
    )
  })

  it('usage prints each account with windows, read age, and source, read-only', async () => {
    await ACCOUNT_HANDLERS['account usage'](context([['agent', 'claude']]))
    expect(callMock).toHaveBeenCalledTimes(1)
    expect(callMock).toHaveBeenCalledWith('accounts.list', { refreshUsage: false })
    expect(logSpy.mock.calls.map((call) => String(call[0]))).toEqual([
      '* a@example.com  5h 96%  weekly 40%  fable 30%  read 2m ago  (selected)',
      '  b@example.com  5h 10%  weekly 20%  read 9m ago  (cached)',
      '  c@example.com  5h -  weekly -  not read  429'
    ])
  })

  it('usage --json carries readAt and source per account', async () => {
    await ACCOUNT_HANDLERS['account usage'](context([['agent', 'claude']], true))
    const { accounts } = JSON.parse(printed())
    expect(accounts[0]).toEqual({
      accountId: 'a',
      email: 'a@example.com',
      selected: true,
      session: 96,
      weekly: 40,
      fable: 30,
      readAt: NOW - 120_000,
      source: 'selected'
    })
    expect(accounts[2]).toMatchObject({ unavailable: '429', readAt: null })
  })
})
