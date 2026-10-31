import { afterEach, describe, expect, it, vi } from 'vitest'
import { ACCOUNT_HANDLERS } from './account'
import type { HandlerContext } from '../dispatch'
import { RuntimeClient } from '../runtime-client'

describe('account model-policy status', () => {
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

  afterEach(() => {
    logSpy.mockRestore()
  })

  it('prints the last evaluation per pane', async () => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    callMock.mockResolvedValue({
      id: 'test',
      ok: true,
      result: {
        claude: {
          accounts: [],
          activeAccountId: null,
          modelPolicy: { enabled: true, fableLine: 1, weeklyGuard: 1 },
          modelPolicyEvaluations: [
            {
              ptyId: 'pty-1',
              paneKey: 'pane-1',
              accountId: 'acct',
              model: 'fable',
              source: 'policy',
              choice: 'opus',
              reason: 'fable-line',
              skip: null,
              at: Date.parse('2026-10-30T00:00:00.000Z')
            }
          ]
        }
      },
      _meta: { runtimeId: 'test-runtime' }
    })
    await ACCOUNT_HANDLERS['account model-policy'](
      context([
        ['agent', 'claude'],
        ['status', true]
      ])
    )
    expect(callMock).toHaveBeenCalledWith('accounts.list', {})
    expect(logSpy.mock.calls.map((call) => String(call[0]))).toEqual([
      'model-policy: on (fable<1, weekly<1)',
      '  pane pane-1  account acct  model fable  source policy  choice opus  reason fable-line  at 2026-10-30T00:00:00.000Z'
    ])
  })

  it('prints evaluations as JSON', async () => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    callMock.mockResolvedValue({
      id: 'test',
      ok: true,
      result: {
        claude: {
          accounts: [],
          activeAccountId: null,
          modelPolicy: { enabled: true, fableLine: 90, weeklyGuard: 91 }
        }
      },
      _meta: { runtimeId: 'test-runtime' }
    })
    await ACCOUNT_HANDLERS['account model-policy'](
      context(
        [
          ['agent', 'claude'],
          ['status', true]
        ],
        true
      )
    )
    expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toEqual({
      modelPolicy: { enabled: true, fableLine: 90, weeklyGuard: 91 },
      evaluations: []
    })
  })
})
