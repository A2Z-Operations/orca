import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ACCOUNT_HANDLERS } from './account'
import { RuntimeClient } from '../runtime-client'
import type { HandlerContext } from '../dispatch'

describe('account auth-proxy surface', () => {
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

  beforeEach(() => {
    callMock.mockReset()
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })
  afterEach(() => logSpy.mockRestore())

  it('sets the proxy through accounts.setClaudeAuthProxy and prints it', async () => {
    callMock.mockResolvedValue({
      id: 'test',
      ok: true,
      result: { accounts: [], activeAccountId: null, authProxy: 'off' },
      _meta: { runtimeId: 'test-runtime' }
    })
    await ACCOUNT_HANDLERS['account auth-proxy'](
      context([
        ['agent', 'claude'],
        ['off', true]
      ])
    )
    expect(callMock).toHaveBeenCalledWith('accounts.setClaudeAuthProxy', { enabled: false })
    expect(logSpy).toHaveBeenCalledWith('Claude auth-proxy: off')
  })

  it('prints JSON with --json', async () => {
    callMock.mockResolvedValue({
      id: 'test',
      ok: true,
      result: { accounts: [], activeAccountId: null, authProxy: 'on' },
      _meta: { runtimeId: 'test-runtime' }
    })
    await ACCOUNT_HANDLERS['account auth-proxy'](context([['on', true]], true))
    expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toEqual({ authProxy: 'on' })
  })

  it('needs exactly one of --on or --off and only --agent claude', async () => {
    await expect(ACCOUNT_HANDLERS['account auth-proxy'](context([]))).rejects.toThrow(
      'exactly one of --on or --off'
    )
    await expect(
      ACCOUNT_HANDLERS['account auth-proxy'](
        context([
          ['on', true],
          ['off', true]
        ])
      )
    ).rejects.toThrow('exactly one of --on or --off')
    await expect(
      ACCOUNT_HANDLERS['account auth-proxy'](
        context([
          ['agent', 'codex'],
          ['on', true]
        ])
      )
    ).rejects.toThrow('Only --agent claude')
    expect(callMock).not.toHaveBeenCalled()
  })

  it('shows auth-proxy in the Claude block when the host reports it', async () => {
    callMock.mockResolvedValue({
      id: 'test',
      ok: true,
      result: {
        claude: {
          accounts: [{ id: 'a', email: 'a@example.com' }],
          activeAccountId: 'a',
          autoSwitchEnabled: true,
          sessionMover: 'move',
          authProxy: 'on',
          paneAssignments: [{ ptyId: 'pty-1', accountId: 'b' }]
        },
        codex: { accounts: [], activeAccountId: null }
      },
      _meta: { runtimeId: 'test-runtime' }
    })
    await ACCOUNT_HANDLERS['account list']({ ...context([]), flags: new Map() })
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('  auth-proxy: on'))
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('  pane pty-1: account b'))
  })
})
