import type { HandlerContext } from '../dispatch'
import { CLAUDE_USAGE_LINES } from '../../shared/claude-usage-lines'
import { formatClaudeShortAge } from '../../shared/claude-relative-age'
import type { ClaudeRateLimitAccountsState } from '../../shared/managed-account-types'

type Snapshot = { claude: ClaudeRateLimitAccountsState }
type UsageRow = NonNullable<ClaudeRateLimitAccountsState['usageWindows']>[number]

/** Read-only: the list the runtime already has, without asking it to fetch usage. */
export async function readClaudeAccountsState(
  ctx: HandlerContext
): Promise<ClaudeRateLimitAccountsState> {
  const result = await ctx.client.call<Snapshot>('accounts.list', { refreshUsage: false })
  return result.result.claude
}

function emailOf(claude: ClaudeRateLimitAccountsState, accountId: string | null): string {
  return claude.accounts.find((account) => account.id === accountId)?.email ?? accountId ?? '-'
}

function atLine(row: UsageRow): boolean {
  return (
    (row.session ?? 0) >= CLAUDE_USAGE_LINES.session ||
    (row.weekly ?? 0) >= CLAUDE_USAGE_LINES.weekly ||
    (row.fable ?? 0) >= CLAUDE_USAGE_LINES.fableWeekly
  )
}

export function claudeAutoSwitchStatus(claude: ClaudeRateLimitAccountsState) {
  const rows = claude.usageWindows ?? []
  return {
    autoSwitchEnabled: claude.autoSwitchEnabled === true,
    selectedAccountId: claude.activeAccountId,
    selectedEmail: claude.activeAccountId ? emailOf(claude, claude.activeAccountId) : null,
    accounts: claude.accounts.length,
    readable: rows.filter((row) => row.weekly !== null || row.session != null).length,
    atLine: rows.filter(atLine).length
  }
}

export function claudeSessionMoverStatus(claude: ClaudeRateLimitAccountsState) {
  const decisions = (claude.sessionMoves ?? []).filter((row) => row.kind !== 'model')
  const reasons: Record<string, number> = {}
  const strategies = { proxy: 0, resume: 0 }
  for (const row of decisions) {
    reasons[row.reason] = (reasons[row.reason] ?? 0) + 1
    if (row.strategy) {
      strategies[row.strategy] += 1
    }
  }
  return {
    sessionMover: claude.sessionMover ?? 'ask',
    sessions: decisions.length,
    reasons,
    strategies,
    modelFlips: (claude.sessionMoves ?? []).length - decisions.length
  }
}

export function claudePoolStatus(claude: ClaudeRateLimitAccountsState) {
  const sessions = new Map((claude.assignedSessions ?? []).map((row) => [row.accountId, row]))
  return {
    pool: claude.pool ?? claude.accountPool ?? 'off',
    accounts: claude.accounts.map((account) => ({
      accountId: account.id,
      email: account.email,
      sessions: sessions.get(account.id)?.count ?? 0,
      chatSessions: sessions.get(account.id)?.chatCount ?? 0
    }))
  }
}

function percent(label: string, value: number | null | undefined): string {
  return `${label} ${value === null || value === undefined ? '-' : `${Math.round(value)}%`}`
}

/** One `orca account usage` line: email, windows, read age, and where the reading came from. */
export function formatClaudeUsageLine(
  email: string,
  row: UsageRow | undefined,
  now: number
): string {
  const windows = [
    percent('5h', row?.session),
    percent('weekly', row?.weekly),
    ...(row?.fable !== null && row?.fable !== undefined ? [percent('fable', row.fable)] : [])
  ].join('  ')
  const read = row?.readAt ? `read ${formatClaudeShortAge(row.readAt, now)} ago` : 'not read'
  const source = row?.source ? `  (${row.source})` : ''
  const unavailable = row?.unavailable ? `  ${row.unavailable}` : ''
  return `${email}  ${windows}  ${read}${source}${unavailable}`
}

/** The `--status` views the three Claude switches print: as JSON with `--json`, else as lines. */
export type ClaudeStatusView =
  | ReturnType<typeof claudeAutoSwitchStatus>
  | ReturnType<typeof claudeSessionMoverStatus>
  | ReturnType<typeof claudePoolStatus>

export function printClaudeStatus(
  ctx: HandlerContext,
  value: ClaudeStatusView,
  lines: string[]
): void {
  console.log(ctx.json ? JSON.stringify(value, null, 2) : lines.join('\n'))
}
