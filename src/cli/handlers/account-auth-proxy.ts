import type { HandlerContext } from '../dispatch'
import { RuntimeClientError } from '../runtime-client'
import type { ClaudeRateLimitAccountsState } from '../../shared/managed-account-types'

/**
 * `orca account auth-proxy --agent claude --on|--off`: writes the host setting behind
 * Settings › Accounts › Claude › "Bill Claude through a local auth proxy".
 *
 * Why no remote-flag rejection: the proxy runs on the runtime it is written on, so
 * `--environment <server>` is the one way to set it for a headless Orca server.
 */
export async function setClaudeAuthProxy(ctx: HandlerContext): Promise<void> {
  const agent = ctx.flags.get('agent') ?? 'claude'
  if (agent !== 'claude') {
    throw new RuntimeClientError(
      'invalid_argument',
      'Only --agent claude supports auth-proxy today.'
    )
  }
  const on = ctx.flags.get('on') === true
  const off = ctx.flags.get('off') === true
  if (on === off) {
    throw new RuntimeClientError('invalid_argument', 'Pass exactly one of --on or --off.')
  }
  const result = await ctx.client.call<ClaudeRateLimitAccountsState>(
    'accounts.setClaudeAuthProxy',
    {
      enabled: on
    }
  )
  const enabled = result.result.authProxy ?? (on ? 'on' : 'off')
  if (ctx.json) {
    console.log(JSON.stringify({ authProxy: enabled }, null, 2))
    return
  }
  console.log(`Claude auth-proxy: ${enabled}`)
}
