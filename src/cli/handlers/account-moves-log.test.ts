import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ACCOUNT_HANDLERS } from './account'
import { RuntimeClient } from '../runtime-client'
import type { HandlerContext } from '../dispatch'
import type { ClaudeAccountLogEntry } from '../../shared/claude-account-log-types'

describe('account moves --log', () => {
  const client = new RuntimeClient()
  const callMock = vi.spyOn(client, 'call')
  let logSpy: ReturnType<typeof vi.spyOn>

  function context(flags: [string, string | boolean][], json = false): HandlerContext {
    return {
      client,
      cwd: process.cwd(),
      flags: new Map<string, string | boolean>(flags),
      json,
      rawArgs: []
    }
  }

  const at = Date.parse('2026-11-05T06:16:00.000Z')
  const entries: ClaudeAccountLogEntry[] = [
    {
      type: 'decision',
      at,
      ptyId: 'pty-1',
      paneKey: 'tab-1:leaf-1',
      fromAccountId: 'acct-a',
      toAccountId: null,
      reason: 'under-line',
      strategy: 'proxy'
    },
    {
      type: 'flip',
      at,
      ptyId: 'pty-1',
      paneKey: 'tab-1:leaf-1',
      accountId: 'acct-a',
      modelFrom: 'fable',
      modelTo: 'opus',
      reason: 'fable-line',
      strategy: 'proxy'
    },
    { type: 'proxy-unknown-slot', at, method: 'POST', path: '/v1/messages', count: 4 },
    {
      type: 'proxy-error',
      at,
      method: 'POST',
      path: '/v1/messages',
      status: 429,
      accountId: 'acct-b',
      count: 2
    }
  ]

  beforeEach(() => {
    callMock.mockReset()
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    callMock.mockResolvedValue({
      id: 'test',
      ok: true,
      result: { path: '/logs/account-moves.log', entries },
      _meta: { runtimeId: 'test-runtime' }
    })
  })
  afterEach(() => logSpy.mockRestore())

  it('reads accounts.claudeAccountLog with --since and prints one line per row', async () => {
    await ACCOUNT_HANDLERS['account moves'](
      context([
        ['log', true],
        ['since', '2026-11-05T06:00:00Z']
      ])
    )
    expect(callMock).toHaveBeenCalledWith('accounts.claudeAccountLog', {
      since: Date.parse('2026-11-05T06:00:00Z')
    })
    expect(logSpy.mock.calls.map((call) => String(call[0]))).toEqual([
      '2026-11-05T06:16:00.000Z  tab-1:leaf-1  acct-a → -  under-line  proxy',
      '2026-11-05T06:16:00.000Z  tab-1:leaf-1  fable → opus  fable-line  proxy  model',
      '2026-11-05T06:16:00.000Z  proxy  unknown slot  POST /v1/messages  ×4',
      '2026-11-05T06:16:00.000Z  proxy  429  POST /v1/messages  acct-b  ×2'
    ])
  })

  it('prints the entries with --json', async () => {
    await ACCOUNT_HANDLERS['account moves'](context([['log', true]], true))
    expect(callMock).toHaveBeenCalledWith('accounts.claudeAccountLog', {})
    expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toEqual(entries)
  })

  it('rejects a bad --since and --since without --log', async () => {
    await expect(
      ACCOUNT_HANDLERS['account moves'](
        context([
          ['log', true],
          ['since', 'yesterday-ish']
        ])
      )
    ).rejects.toThrow('--since must be')
    await expect(
      ACCOUNT_HANDLERS['account moves'](context([['since', '2026-11-05']]))
    ).rejects.toThrow('--since applies to --log')
    expect(callMock).not.toHaveBeenCalled()
  })
})
