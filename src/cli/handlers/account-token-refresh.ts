import type { HandlerContext } from '../dispatch'
import { RuntimeClientError } from '../runtime-client'
import type { ClaudeRateLimitAccountsState } from '../../shared/managed-account-types'

/**
 * `orca account token-refresh --agent claude --on|--off|--status`: writes whether idle
 * Claude accounts refresh their access tokens, or prints the in-memory book.
 *
 * Why no remote-flag rejection: the book and the setting live on the runtime that holds
 * the accounts, so `--environment <server>` is how a headless host is configured.
 */
export async function setClaudeAccountTokenRefresh(ctx: HandlerContext): Promise<void> {
  const agent = ctx.flags.get('agent') ?? 'claude'
  if (agent !== 'claude') {
    throw new RuntimeClientError(
      'invalid_argument',
      'Only --agent claude supports token-refresh today.'
    )
  }
  const on = ctx.flags.get('on') === true
  const off = ctx.flags.get('off') === true
  const status = ctx.flags.get('status') === true
  if (Number(on) + Number(off) + Number(status) !== 1) {
    throw new RuntimeClientError(
      'invalid_argument',
      'Pass exactly one of --on, --off, or --status.'
    )
  }
  if (status) {
    const result = await ctx.client.call<{ claude: ClaudeRateLimitAccountsState }>(
      'accounts.list',
      {
        refreshUsage: false
      }
    )
    printClaudeTokenRefreshStatus(result.result.claude, ctx.json)
    return
  }
  const result = await ctx.client.call<ClaudeRateLimitAccountsState>(
    'accounts.setClaudeAccountTokenRefresh',
    { enabled: on }
  )
  printClaudeTokenRefreshStatus(result.result, ctx.json)
}

function printClaudeTokenRefreshStatus(state: ClaudeRateLimitAccountsState, json: boolean): void {
  const tokenRefresh = state.tokenRefresh ?? 'on'
  const accounts = (state.tokenRefreshAccounts ?? []).map((row) => ({
    accountId: row.accountId,
    lastRefreshAt: row.lastRefreshAt,
    nextRetryAt: row.nextRetryAt,
    lapsed: row.lapsed
  }))
  if (json) {
    console.log(JSON.stringify({ tokenRefresh, accounts }, null, 2))
    return
  }
  const lines = [`Claude token-refresh: ${tokenRefresh}`]
  if (accounts.length === 0) {
    lines.push('  accounts: none')
  }
  for (const row of accounts) {
    lines.push(
      `  ${row.accountId}  last ${formatWhen(row.lastRefreshAt)}  next ${formatWhen(row.nextRetryAt)}  lapsed ${row.lapsed ? 'yes' : 'no'}`
    )
  }
  console.log(lines.join('\n'))
}

function formatWhen(value: number | null): string {
  if (value === null) {
    return '—'
  }
  return new Date(value).toISOString()
}
