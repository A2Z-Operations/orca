import { CLAUDE_USAGE_LINES } from '../../../../shared/claude-usage-lines'
import type { ClaudeRateLimitAccountsState } from '../../../../shared/managed-account-types'

export type ClaudeUsageRow = NonNullable<ClaudeRateLimitAccountsState['usageWindows']>[number]

export type ClaudeAccountUsageState =
  | 'ok'
  | 'near-line'
  | 'at-line'
  | 'sign-in'
  | 'refreshing'
  | 'unreadable'

/** Points under a line that already count as "near". */
export const CLAUDE_NEAR_LINE_POINTS = 10

const SIGN_IN = new Set(['sign in again', 'lapsed', '401'])

/** The Accounts strip state: the same lines the auto-switch and the mover use. */
export function claudeAccountUsageState(
  account: { needsSignIn?: boolean },
  row: ClaudeUsageRow | undefined
): ClaudeAccountUsageState {
  if (account.needsSignIn || (row?.unavailable && SIGN_IN.has(row.unavailable))) {
    return 'sign-in'
  }
  const windows: [number | null | undefined, number][] = [
    [row?.session, CLAUDE_USAGE_LINES.session],
    [row?.weekly, CLAUDE_USAGE_LINES.weekly],
    [row?.fable, CLAUDE_USAGE_LINES.fableWeekly]
  ]
  const read = windows.filter((entry): entry is [number, number] => typeof entry[0] === 'number')
  if (read.length === 0) {
    return row?.unavailable ? 'unreadable' : 'refreshing'
  }
  if (read.some(([used, line]) => used >= line)) {
    return 'at-line'
  }
  return read.some(([used, line]) => used >= line - CLAUDE_NEAR_LINE_POINTS) ? 'near-line' : 'ok'
}
