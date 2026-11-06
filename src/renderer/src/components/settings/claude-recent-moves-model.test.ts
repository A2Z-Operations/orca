import { describe, expect, it } from 'vitest'
import { translate } from '@/i18n/i18n'
import type { ClaudeSessionMoveSummary } from '../../../../shared/managed-account-types'
import { claudeAccountUsageState } from './claude-account-usage-state'
import { recentMovesFixture } from './claude-recent-moves-test-fixture'
import {
  claudeMoveRowsFromLog,
  filterClaudeMoveRows,
  groupClaudeMoveRows,
  mergeClaudeMoveRows
} from './claude-recent-moves-rows'
import { claudeMoveSessionName } from './claude-recent-moves-session-name'
import { claudeMoveCategory, claudeMoveDecision, claudeMoveVia } from './claude-recent-moves-words'

const row = (extra: Partial<ClaudeSessionMoveSummary>): ClaudeSessionMoveSummary => ({
  ptyId: 'pty-1',
  paneKey: null,
  fromAccountId: 'a',
  toAccountId: null,
  window: null,
  percent: null,
  line: null,
  reason: 'under-line',
  at: 1,
  ...extra
})

const words = (extra: Partial<ClaudeSessionMoveSummary>) => {
  const phrase = claudeMoveDecision(row(extra))
  return translate(phrase.key, phrase.fallback, phrase.values)
}

describe('recent moves rows', () => {
  it('turns reasons into plain words', () => {
    expect(words({ reason: 'no-target' })).toBe('Stayed: no account under the line')
    expect(words({ reason: 'under-line' })).toBe('Stayed: under the line')
    expect(words({ reason: 'moved', strategy: 'proxy' })).toBe('Moved (no restart)')
    expect(words({ reason: 'moved', strategy: 'resume' })).toBe('Moved (restarted)')
    expect(words({ reason: 'wait:mid-turn' })).toBe('Waiting: mid-turn')
    expect(words({ reason: 'pinned' })).toBe('Pinned')
    expect(words({ reason: 'stay' })).toBe('Stayed')
    expect(words({ reason: 'something-new' })).toBe('something-new')
    expect(
      words({ kind: 'model', reason: 'fable-line', modelFrom: 'fable', modelTo: 'opus' })
    ).toBe('Switched model: Fable → Opus (Fable window at its line)')
    expect(claudeMoveVia(row({ strategy: 'resume' }))).toBe('restart')
    expect(claudeMoveVia(row({}))).toBeNull()
    expect(claudeMoveCategory(row({ reason: 'rebalance' }))).toBe('move')
    expect(claudeMoveCategory(row({ kind: 'model', reason: 'x' }))).toBe('flip')
  })

  it('folds the 20 stays of one tick into one line and keeps flips and the move apart', () => {
    const rows = mergeClaudeMoveRows(recentMovesFixture().sessionMoves ?? [], [])
    const lines = groupClaudeMoveRows(rows)
    expect(
      lines.map((line) => (line.kind === 'group' ? `group:${line.rows.length}` : line.row.reason))
    ).toEqual(['group:20', 'fable-line', 'fable-line', 'moved'])
  })

  it('filters by chip, account, and search text', () => {
    const rows = recentMovesFixture().sessionMoves ?? []
    const text = (candidate: ClaudeSessionMoveSummary) =>
      `${candidate.ptyId} ${candidate.fromAccountId}`
    const pick = (
      category: 'all' | 'move' | 'flip' | 'stay',
      accountId: string | null,
      query = ''
    ) => filterClaudeMoveRows(rows, { category, accountId, query }, text).length
    expect(pick('all', null)).toBe(23)
    expect(pick('flip', null)).toBe(2)
    expect(pick('move', null)).toBe(1)
    expect(pick('stay', null)).toBe(20)
    expect(pick('all', 'acct-b')).toBe(1)
    expect(pick('all', null, 'PTY-MOVED')).toBe(1)
  })

  it('names a session by its tab and workspace, else a short id; ids stay in the tooltip', () => {
    const tabs = new Map([['tab-known', { title: 'fix flaky test', worktree: 'orca-main' }]])
    expect(claudeMoveSessionName({ ptyId: 'p1', paneKey: 'tab-known:leaf' }, tabs)).toEqual({
      name: 'fix flaky test · orca-main',
      ids: 'pane tab-known:leaf · pty p1'
    })
    expect(
      claudeMoveSessionName({ ptyId: '0f3c9a2b-77d1-4e1a-9c1e-1234abcd5678', paneKey: null }, tabs)
        .name
    ).toBe('Session cd5678')
    expect(
      claudeMoveSessionName({ ptyId: 'structured-x1', paneKey: 'chat:x', chat: true }, tabs).name
    ).toBe('Chat uredx1')
  })

  it('maps durable-log rows back to table rows and skips proxy rows', () => {
    const rows = claudeMoveRowsFromLog([
      {
        type: 'decision',
        at: 5,
        ptyId: 'p',
        paneKey: null,
        fromAccountId: 'a',
        toAccountId: 'b',
        reason: 'moved',
        strategy: 'proxy'
      },
      {
        type: 'flip',
        at: 4,
        ptyId: 'p',
        paneKey: null,
        accountId: 'a',
        modelFrom: 'opus',
        modelTo: 'fable',
        reason: 'window-reset'
      },
      {
        type: 'proxy-error',
        at: 3,
        method: 'POST',
        path: '/v1/messages',
        status: 429,
        accountId: 'a',
        count: 1
      }
    ])
    expect(rows.map((entry) => `${entry.kind ?? 'move'}:${entry.reason}`)).toEqual([
      'move:moved',
      'model:window-reset'
    ])
    expect(mergeClaudeMoveRows(rows, rows)).toHaveLength(2)
  })

  it('classifies the accounts strip by the shared lines', () => {
    const state = recentMovesFixture()
    const rows = state.usageWindows ?? []
    expect(claudeAccountUsageState({}, rows[0])).toBe('at-line')
    expect(claudeAccountUsageState({}, rows[1])).toBe('ok')
    expect(claudeAccountUsageState({}, { ...rows[1]!, weekly: 85 })).toBe('near-line')
    expect(claudeAccountUsageState({ needsSignIn: true }, rows[1])).toBe('sign-in')
    expect(claudeAccountUsageState({}, undefined)).toBe('refreshing')
    expect(
      claudeAccountUsageState({}, { accountId: 'x', weekly: null, fable: null, unavailable: '429' })
    ).toBe('unreadable')
  })
})
