import type { HandlerContext } from '../dispatch'
import { RuntimeClientError } from '../runtime-client'
import type { ClaudeRateLimitAccountsState } from '../../shared/managed-account-types'
import {
  claudePoolStatus,
  printClaudeStatus,
  readClaudeAccountsState
} from './account-claude-status'

/**
 * `orca account pool --agent claude --on|--off`: writes the host setting behind
 * Settings › Accounts › Claude › "Spread sessions across accounts".
 *
 * Why no remote-flag rejection: the pool runs on the runtime it is written on, so
 * `--environment <server>` is the one way to set it for a headless Orca server.
 */
export async function setClaudeAccountPool(ctx: HandlerContext): Promise<void> {
  const agent = ctx.flags.get('agent') ?? 'claude'
  if (agent !== 'claude') {
    throw new RuntimeClientError('invalid_argument', 'Only --agent claude supports pool today.')
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
    const view = claudePoolStatus(await readClaudeAccountsState(ctx))
    printClaudeStatus(ctx, view, [
      `Claude account pool: ${view.pool}`,
      ...view.accounts.map(
        (row) =>
          `  ${row.email}: ${row.sessions} sessions${row.chatSessions > 0 ? ` (${row.chatSessions} chat)` : ''}`
      )
    ])
    return
  }
  const result = await ctx.client.call<ClaudeRateLimitAccountsState>(
    'accounts.setClaudeAccountPool',
    { enabled: on }
  )
  const pool = result.result.pool ?? (on ? 'on' : 'off')
  if (ctx.json) {
    console.log(JSON.stringify({ pool }, null, 2))
    return
  }
  console.log(`Claude account pool: ${pool}`)
}
