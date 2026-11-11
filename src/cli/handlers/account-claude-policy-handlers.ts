import type { CommandHandler } from '../dispatch'
import { setClaudeAuthProxy } from './account-auth-proxy'
import { setClaudeAccountTokenRefresh } from './account-token-refresh'
import { setClaudeAutoSwitch } from './account-auto-switch'
import { printClaudeAccountMoves } from './account-moves'
import { printClaudeAccountUsage } from './account-usage'
import { setClaudeAccountPool } from './account-pool'
import { setClaudeModelPolicy } from './account-model-policy'
import { setClaudeSessionMover } from './account-session-mover'

/** The fork's Claude account policies: each runs on the host that owns the accounts. */
export const CLAUDE_ACCOUNT_POLICY_HANDLERS: Record<string, CommandHandler> = {
  'account auth-proxy': setClaudeAuthProxy,
  'account auto-switch': setClaudeAutoSwitch,
  'account moves': printClaudeAccountMoves,
  'account usage': printClaudeAccountUsage,
  'account pool': setClaudeAccountPool,
  'account model-policy': setClaudeModelPolicy,
  'account session-mover': setClaudeSessionMover,
  'account token-refresh': setClaudeAccountTokenRefresh
}
