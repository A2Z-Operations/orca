import type { HandlerContext } from '../dispatch'
import { RuntimeClientError } from '../runtime-client'
import { formatClaudeUsageLine, readClaudeAccountsState } from './account-claude-status'

/**
 * `orca account usage --agent claude [--json]`: each managed account's last usage reading
 * (5-hour, weekly, Fable weekly), its age, and whether it is the selected reading or the
 * inactive-account cache. Read-only; it does not ask the runtime to fetch.
 */
export async function printClaudeAccountUsage(ctx: HandlerContext): Promise<void> {
  const agent = ctx.flags.get('agent') ?? 'claude'
  if (agent !== 'claude') {
    throw new RuntimeClientError('invalid_argument', 'Only --agent claude supports usage today.')
  }
  const claude = await readClaudeAccountsState(ctx)
  const rows = new Map((claude.usageWindows ?? []).map((row) => [row.accountId, row]))
  if (ctx.json) {
    const accounts = claude.accounts.map((account) => ({
      accountId: account.id,
      email: account.email,
      selected: account.id === claude.activeAccountId,
      session: rows.get(account.id)?.session ?? null,
      weekly: rows.get(account.id)?.weekly ?? null,
      fable: rows.get(account.id)?.fable ?? null,
      readAt: rows.get(account.id)?.readAt ?? null,
      source: rows.get(account.id)?.source ?? null,
      ...(rows.get(account.id)?.unavailable
        ? { unavailable: rows.get(account.id)?.unavailable }
        : {})
    }))
    console.log(JSON.stringify({ accounts }, null, 2))
    return
  }
  if (claude.accounts.length === 0) {
    console.log('No managed Claude accounts.')
    return
  }
  const now = Date.now()
  for (const account of claude.accounts) {
    const mark = account.id === claude.activeAccountId ? '*' : ' '
    console.log(`${mark} ${formatClaudeUsageLine(account.email, rows.get(account.id), now)}`)
  }
}
