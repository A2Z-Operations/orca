import type { HandlerContext } from '../dispatch'
import { RuntimeClientError } from '../runtime-client'
import type { ClaudeRateLimitAccountsState } from '../../shared/managed-account-types'
import {
  claudeAutoSwitchStatus,
  printClaudeStatus,
  readClaudeAccountsState
} from './account-claude-status'

/**
 * `orca account auto-switch --agent claude --on|--off`: writes the host setting behind
 * Settings › Accounts › Claude › "Switch accounts before a usage limit".
 *
 * Why no remote-flag rejection: the switch rotates the accounts of the runtime it is written
 * on, so `--environment <server>` is the one way to turn it on for a headless Orca server.
 */
export async function setClaudeAutoSwitch(ctx: HandlerContext): Promise<void> {
  const agent = ctx.flags.get('agent') ?? 'claude'
  if (agent !== 'claude') {
    throw new RuntimeClientError(
      'invalid_argument',
      'Only --agent claude supports auto-switch today.'
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
    const view = claudeAutoSwitchStatus(await readClaudeAccountsState(ctx))
    printClaudeStatus(ctx, view, [
      `Claude auto-switch: ${view.autoSwitchEnabled ? 'on' : 'off'}`,
      `  selected: ${view.selectedEmail ?? '-'}`,
      `  accounts: ${view.accounts} (${view.readable} with a usage reading, ${view.atLine} at a line)`
    ])
    return
  }
  const result = await ctx.client.call<ClaudeRateLimitAccountsState>(
    'accounts.setClaudeAutoSwitch',
    { enabled: on }
  )
  const enabled = result.result.autoSwitchEnabled ?? on
  if (ctx.json) {
    console.log(JSON.stringify({ autoSwitchEnabled: enabled }, null, 2))
    return
  }
  console.log(`Claude auto-switch: ${enabled ? 'on' : 'off'}`)
}
