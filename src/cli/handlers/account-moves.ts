import type { HandlerContext } from '../dispatch'
import { getOptionalStringFlag } from '../flags'
import { RuntimeClientError } from '../runtime-client'
import { formatClaudeAccountLogLine } from '../../shared/claude-account-log-line'
import type { ClaudeAccountLogEntry } from '../../shared/claude-account-log-types'
import { formatClaudeSessionMoveLine } from '../../shared/claude-session-move-line'
import type { ClaudeSessionMoveSummary } from '../../shared/managed-account-types'

type MovesSnapshot = {
  claude: {
    sessionMoves?: readonly ClaudeSessionMoveSummary[]
  }
}

type AccountLog = { path: string; entries: ClaudeAccountLogEntry[] }

/**
 * `orca account moves`: prints the mover's last decision per live Claude session.
 * `--log [--since <iso>]` prints the durable account log instead: every decision, model flip, and
 * auth-proxy error the runtime recorded, across restarts.
 *
 * Why no remote-flag rejection: the decisions belong to the runtime that moved
 * the sessions, so `--environment <server>` reads that server.
 */
export async function printClaudeAccountMoves(ctx: HandlerContext): Promise<void> {
  const agent = ctx.flags.get('agent') ?? 'claude'
  if (agent !== 'claude') {
    throw new RuntimeClientError('invalid_argument', 'Only --agent claude supports moves today.')
  }
  if (ctx.flags.get('log') === true) {
    await printClaudeAccountLog(ctx)
    return
  }
  if (ctx.flags.has('since')) {
    throw new RuntimeClientError('invalid_argument', '--since applies to --log.')
  }
  const result = await ctx.client.call<MovesSnapshot>('accounts.list', { refreshUsage: false })
  const moves = result.result.claude.sessionMoves ?? []
  if (ctx.json) {
    console.log(JSON.stringify(moves, null, 2))
    return
  }
  if (moves.length === 0) {
    console.log('No Claude session moves.')
    return
  }
  for (const move of moves) {
    console.log(formatClaudeSessionMoveLine(move))
  }
}

function parseSince(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined
  }
  const at = Date.parse(value)
  if (!Number.isFinite(at) || at < 0) {
    throw new RuntimeClientError(
      'invalid_argument',
      '--since must be an ISO date or time, for example 2026-11-05T06:00:00Z.'
    )
  }
  return at
}

async function printClaudeAccountLog(ctx: HandlerContext): Promise<void> {
  const since = parseSince(getOptionalStringFlag(ctx.flags, 'since'))
  const result = await ctx.client.call<AccountLog>(
    'accounts.claudeAccountLog',
    since !== undefined ? { since } : {}
  )
  const { entries } = result.result
  if (ctx.json) {
    console.log(JSON.stringify(entries, null, 2))
    return
  }
  if (entries.length === 0) {
    console.log('No Claude account log entries.')
    return
  }
  for (const entry of entries) {
    console.log(formatClaudeAccountLogLine(entry))
  }
}
