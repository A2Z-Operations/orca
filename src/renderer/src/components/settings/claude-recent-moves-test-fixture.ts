import type {
  ClaudeRateLimitAccountsState,
  ClaudeSessionMoveSummary
} from '../../../../shared/managed-account-types'

export const RECENT_MOVES_NOW = Date.parse('2026-11-05T07:00:00.000Z')
const TICK = RECENT_MOVES_NOW - 9 * 60_000

const account = (id: string, email: string) => ({
  id,
  email,
  managedAuthRuntime: 'host' as const,
  wslDistro: null,
  authMethod: 'subscription-oauth' as const,
  createdAt: 0,
  updatedAt: 0,
  lastAuthenticatedAt: 0
})

const base = {
  window: null,
  percent: null,
  line: null,
  toAccountId: null
} satisfies Partial<ClaudeSessionMoveSummary>

/** One mover tick: 20 sessions stayed on one account, two model flips, and one move. */
export function recentMovesFixture(): ClaudeRateLimitAccountsState {
  const stays: ClaudeSessionMoveSummary[] = Array.from({ length: 20 }, (_, index) => ({
    ...base,
    ptyId: `pty-${index}`,
    paneKey: index === 0 ? 'tab-known:leaf' : `tab-${index}:leaf`,
    fromAccountId: 'acct-a',
    reason: 'no-target',
    at: TICK,
    strategy: 'proxy'
  }))
  const flips: ClaudeSessionMoveSummary[] = [0, 1].map((index) => ({
    ...base,
    ptyId: `pty-${index}`,
    paneKey: `tab-${index}:leaf`,
    fromAccountId: 'acct-a',
    toAccountId: 'acct-a',
    reason: 'fable-line',
    at: TICK - (index + 1) * 60_000,
    kind: 'model',
    modelFrom: 'fable',
    modelTo: 'opus',
    strategy: 'proxy'
  }))
  const move: ClaudeSessionMoveSummary = {
    ...base,
    ptyId: 'pty-moved',
    paneKey: null,
    fromAccountId: 'acct-a',
    toAccountId: 'acct-b',
    reason: 'moved',
    at: TICK - 5 * 60_000,
    strategy: 'resume'
  }
  return {
    accounts: [account('acct-a', 'a@example.com'), account('acct-b', 'b@example.com')],
    activeAccountId: 'acct-a',
    usageWindows: [
      { accountId: 'acct-a', session: 97, weekly: 60, fable: 91, readAt: TICK, source: 'selected' },
      { accountId: 'acct-b', session: 5, weekly: 12, fable: null, readAt: TICK, source: 'cached' }
    ],
    sessionMoves: [...stays, ...flips, move]
  }
}
