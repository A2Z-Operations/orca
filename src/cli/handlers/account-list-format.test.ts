import { describe, expect, it } from 'vitest'
import { formatClaudeSessionMoveLine } from '../../shared/claude-session-move-line'
import {
  formatAccountsBlock,
  formatClaudeModelPolicyEvaluationLine,
  formatClaudeModelPolicyLine
} from './account-list-format'

describe('formatAccountsBlock', () => {
  it('prints the WSL guest proxy status without changing the host proxy line', () => {
    const text = formatAccountsBlock('Claude', {
      accounts: [{ id: 'a', email: 'a@example.com' }],
      activeAccountId: 'a',
      authProxy: 'on',
      wslAuthProxy: 'unsupported:wsl'
    })
    expect(text).toContain('  auth-proxy: on')
    expect(text).toContain('  wsl auth-proxy: unsupported:wsl')
  })

  it('labels native-chat sessions and leaves a terminal-only count unsuffixed', () => {
    const text = formatAccountsBlock('Claude', {
      accounts: [
        { id: 'a', email: 'a@example.com' },
        { id: 'b', email: 'b@example.com' }
      ],
      activeAccountId: 'a',
      assignedSessions: [
        { accountId: 'a', count: 2, chatCount: 1 },
        { accountId: 'b', count: 0 }
      ]
    })
    expect(text).toContain('  a@example.com (active)  sessions: 2 (1 chat)')
    expect(text).toContain('  b@example.com  sessions: 0')
  })

  it('prints both windows and the model-policy line', () => {
    const text = formatAccountsBlock('Claude', {
      accounts: [{ id: 'a', email: 'a@example.com' }],
      activeAccountId: 'a',
      pool: 'on',
      usageWindows: [{ accountId: 'a', weekly: 42.4, fable: null }],
      modelPolicy: { enabled: true, fableLine: 90, weeklyGuard: 91 }
    })
    expect(text).toContain('  a@example.com (active)  weekly 42% · fable —')
    expect(text).toContain('  pool: on\n  model-policy: on (fable<90, weekly<91)')
    expect(formatClaudeModelPolicyLine({ enabled: false, fableLine: 80, weeklyGuard: 70 })).toBe(
      'model-policy: off'
    )
    expect(
      formatClaudeModelPolicyEvaluationLine({
        ptyId: 'pty-1',
        paneKey: 'reports',
        accountId: 'acct',
        model: 'fable',
        source: 'policy',
        choice: 'opus',
        reason: 'weekly-guard',
        skip: 'cooldown',
        at: Date.parse('2026-10-30T00:00:00.000Z')
      })
    ).toBe(
      'pane reports  account acct  model fable  source policy  choice opus  reason weekly-guard  skip cooldown  at 2026-10-30T00:00:00.000Z'
    )
  })

  it('prints keychain denial and an http status instead of a silent dash', () => {
    const text = formatAccountsBlock('Claude', {
      accounts: [
        { id: 'a', email: 'a@example.com' },
        { id: 'b', email: 'b@example.com' }
      ],
      activeAccountId: null,
      usageWindows: [
        { accountId: 'a', weekly: null, fable: null, unavailable: 'keychain denied' },
        { accountId: 'b', weekly: null, fable: null, unavailable: '401' }
      ]
    })
    expect(text).toContain(
      '  a@example.com  weekly ? (keychain denied) · fable ? (keychain denied)'
    )
    expect(text).toContain('  b@example.com  weekly — (401) · fable — (401)')
  })

  it('prints a model flip on its own moves line', () => {
    expect(
      formatClaudeSessionMoveLine({
        ptyId: 'pty-1',
        paneKey: 'reports',
        fromAccountId: 'acct',
        toAccountId: 'acct',
        window: null,
        percent: null,
        line: null,
        reason: 'weekly-guard',
        at: Date.parse('2026-10-30T00:00:00.000Z'),
        kind: 'model',
        modelFrom: 'fable',
        modelTo: 'opus'
      })
    ).toBe('2026-10-30T00:00:00.000Z  reports  fable → opus  weekly-guard  model')
  })
})
