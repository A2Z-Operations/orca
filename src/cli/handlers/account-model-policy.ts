import type { HandlerContext } from '../dispatch'
import { getRepeatedStringFlag } from '../flags'
import { RuntimeClientError } from '../runtime-client'
import type { ClaudeRateLimitAccountsState } from '../../shared/managed-account-types'
import { formatClaudeModelPolicyLine } from './account-list-format'

type AccountsListSnapshot = {
  claude: ClaudeRateLimitAccountsState
}

type ModelPolicyPatch = {
  enabled?: boolean
  fableLine?: number
  weeklyGuard?: number
}

/**
 * `orca account model-policy --agent claude --on|--off|--status|--set fable-line=.. weekly-guard=..`
 * Spend Fable while both windows are under their lines, otherwise Opus 5.5.
 */
export async function setClaudeModelPolicy(ctx: HandlerContext): Promise<void> {
  const agent = ctx.flags.get('agent') ?? 'claude'
  if (agent !== 'claude') {
    throw new RuntimeClientError(
      'invalid_argument',
      'Only --agent claude supports model-policy today.'
    )
  }
  const on = ctx.flags.get('on') === true
  const off = ctx.flags.get('off') === true
  const status = ctx.flags.get('status') === true
  const sets = getRepeatedStringFlag(ctx.flags, 'set')
  const modes = [on, off, status, sets.length > 0].filter(Boolean).length
  if (modes !== 1) {
    throw new RuntimeClientError(
      'invalid_argument',
      'Pass exactly one of --on, --off, --status, or --set.'
    )
  }
  if (status) {
    const listed = await ctx.client.call<AccountsListSnapshot>('accounts.list', {})
    printPolicy(ctx, listed.result.claude.modelPolicy)
    return
  }
  const patch: ModelPolicyPatch = parseSet(sets)
  if (on) {
    patch.enabled = true
  }
  if (off) {
    patch.enabled = false
  }
  const result = await ctx.client.call<ClaudeRateLimitAccountsState>(
    'accounts.setClaudeModelPolicy',
    patch
  )
  printPolicy(ctx, result.result.modelPolicy)
}

function printPolicy(
  ctx: HandlerContext,
  policy: ClaudeRateLimitAccountsState['modelPolicy']
): void {
  const resolved = policy ?? { enabled: true, fableLine: 90, weeklyGuard: 91 }
  if (ctx.json) {
    console.log(JSON.stringify({ modelPolicy: resolved }, null, 2))
    return
  }
  console.log(formatClaudeModelPolicyLine(resolved))
}

function parseSet(entries: string[]): ModelPolicyPatch {
  const patch: ModelPolicyPatch = {}
  for (const entry of entries) {
    for (const part of entry
      .split(',')
      .map((piece) => piece.trim())
      .filter((piece) => piece.length > 0)) {
      const eq = part.indexOf('=')
      if (eq <= 0) {
        throw new RuntimeClientError(
          'invalid_argument',
          'Each --set value is key=value. Keys: fable-line, weekly-guard.'
        )
      }
      const key = part.slice(0, eq)
      const raw = part.slice(eq + 1)
      const value = Number(raw)
      if (!Number.isFinite(value)) {
        throw new RuntimeClientError('invalid_argument', `--set ${key} must be a number.`)
      }
      if (key === 'fable-line') {
        patch.fableLine = value
      } else if (key === 'weekly-guard') {
        patch.weeklyGuard = value
      } else {
        throw new RuntimeClientError(
          'invalid_argument',
          `Unknown --set key ${key}. Use fable-line or weekly-guard.`
        )
      }
    }
  }
  return patch
}
