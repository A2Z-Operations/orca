import { describe, expect, it } from 'vitest'
import type { ClaudeSessionMoveSummary } from '../../shared/managed-account-types'
import { structuredClaudeSessionKey } from '../claude/claude-structured-session-key'
import {
  claudeListedStructuredSessions,
  type ClaudeListedStructuredRecord
} from './claude-listed-structured-sessions'

const ACCOUNTS = [
  { id: 'acct-a', email: 'ada@example.com' },
  { id: 'acct-b', email: 'bob@example.com' }
]

function chat(
  sessionId: string,
  path: string,
  extra: Partial<ClaudeListedStructuredRecord> = {}
): ClaudeListedStructuredRecord {
  return {
    sessionId,
    provider: 'claude',
    accountHome: { variable: 'CLAUDE_CONFIG_DIR', path },
    location: {
      executionHostId: 'local',
      wslDistro: null,
      workspaceId: 'folder:one',
      workspaceKind: 'folder'
    },
    options: { model: 'claude-fable-5-2' },
    updatedAt: 1_000,
    ...extra
  }
}

describe('claudeListedStructuredSessions', () => {
  it('names each saved chat by its account row, System default, or an unknown account', () => {
    const { structuredSessions } = claudeListedStructuredSessions(
      ACCOUNTS,
      [
        chat('claude_one', '/data/claude-profiles/acct-a/home', {
          accountId: 'acct-a',
          currentModel: 'claude-opus-5-5',
          lastTurn: { state: 'settled', at: 9_000 }
        }),
        chat('claude_two', '/data/claude-profiles/acct-gone/home', { updatedAt: 5_000 }),
        chat('claude_three', '/Users/me/.claude', { updatedAt: 2_000, options: undefined }),
        { ...chat('codex_four', '/data/codex-home'), provider: 'codex' }
      ],
      []
    )
    expect(structuredSessions).toEqual([
      {
        sessionId: 'claude_one',
        paneKey: structuredClaudeSessionKey('claude_one'),
        account: 'managed',
        accountId: 'acct-a',
        email: 'ada@example.com',
        label: 'ada',
        model: 'claude-opus-5-5',
        workspaceId: 'folder:one',
        lastActivityAt: 9_000
      },
      {
        sessionId: 'claude_two',
        paneKey: structuredClaudeSessionKey('claude_two'),
        account: 'unknown',
        accountId: 'acct-gone',
        model: 'claude-fable-5-2',
        workspaceId: 'folder:one',
        lastActivityAt: 5_000
      },
      {
        sessionId: 'claude_three',
        paneKey: structuredClaudeSessionKey('claude_three'),
        account: 'system',
        accountId: null,
        workspaceId: 'folder:one',
        lastActivityAt: 2_000
      }
    ])
  })

  it("carries the mover's last decision for a chat, including why it skipped", () => {
    const key = structuredClaudeSessionKey('claude_one')
    const skipped: ClaudeSessionMoveSummary = {
      ptyId: key,
      paneKey: key,
      fromAccountId: 'acct-a',
      toAccountId: null,
      window: 'fableWeekly',
      percent: 96,
      line: 95,
      reason: 'skipped',
      detail: 'structured-needs-proxy',
      at: 7_000,
      chat: true
    }
    const terminal: ClaudeSessionMoveSummary = {
      ...skipped,
      ptyId: 'pty-1',
      paneKey: 'tab-1:leaf-1',
      reason: 'stay',
      chat: undefined,
      detail: undefined
    }
    const { structuredSessions, sessionMoves } = claudeListedStructuredSessions(
      ACCOUNTS,
      [chat('claude_one', '/data/claude-profiles/acct-a/home')],
      [skipped, terminal]
    )
    expect(structuredSessions[0]?.lastMove).toEqual({
      reason: 'skipped',
      detail: 'structured-needs-proxy',
      toAccountId: null,
      at: 7_000
    })
    expect(sessionMoves).toEqual([{ ...skipped, sessionId: 'claude_one' }, terminal])
  })
})
