import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ACCOUNT_HANDLERS } from './account'
import { RuntimeClient } from '../runtime-client'
import type { HandlerContext } from '../dispatch'

describe('account auto-switch', () => {
  const client = new RuntimeClient()
  const callMock = vi.spyOn(client, 'call')
  let logSpy: ReturnType<typeof vi.spyOn>

  function autoSwitchContext(flags: [string, string | boolean][], json = false): HandlerContext {
    return {
      client,
      cwd: process.cwd(),
      flags: new Map<string, string | boolean>([['agent', 'claude'], ...flags]),
      json,
      rawArgs: []
    }
  }

  beforeEach(() => {
    callMock.mockReset()
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })
  afterEach(() => logSpy.mockRestore())

  it('turns Claude auto-switch on through accounts.setClaudeAutoSwitch and prints the state', async () => {
    callMock.mockResolvedValue({
      id: 'test',
      ok: true,
      result: { accounts: [], activeAccountId: null, autoSwitchEnabled: true },
      _meta: { runtimeId: 'test-runtime' }
    })

    await ACCOUNT_HANDLERS['account auto-switch'](
      autoSwitchContext([
        ['agent', 'claude'],
        ['on', true]
      ])
    )

    expect(callMock).toHaveBeenCalledWith('accounts.setClaudeAutoSwitch', { enabled: true })
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('auto-switch: on'))
  })

  it('turns it off with --off and defaults --agent to claude', async () => {
    callMock.mockResolvedValue({
      id: 'test',
      ok: true,
      result: { accounts: [], activeAccountId: null, autoSwitchEnabled: false },
      _meta: { runtimeId: 'test-runtime' }
    })

    await ACCOUNT_HANDLERS['account auto-switch'](autoSwitchContext([['off', true]]))

    expect(callMock).toHaveBeenCalledWith('accounts.setClaudeAutoSwitch', { enabled: false })
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('auto-switch: off'))
  })

  it('prints only the state as JSON', async () => {
    callMock.mockResolvedValue({
      id: 'test',
      ok: true,
      result: { accounts: [], activeAccountId: null, autoSwitchEnabled: true },
      _meta: { runtimeId: 'test-runtime' }
    })

    await ACCOUNT_HANDLERS['account auto-switch'](autoSwitchContext([['on', true]], true))

    expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toEqual({ autoSwitchEnabled: true })
  })

  it('refuses an agent other than claude', async () => {
    await expect(
      ACCOUNT_HANDLERS['account auto-switch'](
        autoSwitchContext([
          ['agent', 'codex'],
          ['on', true]
        ])
      )
    ).rejects.toThrow(/claude/)
    expect(callMock).not.toHaveBeenCalled()
  })

  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the flag tuples are the literal shapes HandlerContext.flags holds.
  it.each([
    [[]],
    [
      [
        ['on', true],
        ['off', true]
      ]
    ]
  ] as [[string, string | boolean][]][])(
    'needs exactly one of --on / --off (flags %j)',
    async (flags) => {
      await expect(
        ACCOUNT_HANDLERS['account auto-switch'](autoSwitchContext(flags))
      ).rejects.toThrow(/--on, --off, or --status/)
      expect(callMock).not.toHaveBeenCalled()
    }
  )

  it('accepts --environment, unlike the other account commands, so a paired server can be flipped', async () => {
    // Why: this is how the MacBook turns the switch on for the Studio's headless runtime.
    callMock.mockResolvedValue({
      id: 'test',
      ok: true,
      result: { accounts: [], activeAccountId: null, autoSwitchEnabled: true },
      _meta: { runtimeId: 'runtime-1' }
    })

    await ACCOUNT_HANDLERS['account auto-switch'](
      autoSwitchContext([
        ['on', true],
        ['environment', 'macstudio']
      ])
    )

    expect(callMock).toHaveBeenCalledWith('accounts.setClaudeAutoSwitch', { enabled: true })
  })
})
