import {
  CLAUDE_INJECTED_CONFIG_DIR_ENV,
  CLAUDE_PROFILE_POINTER_ENV
} from '../../../../shared/claude-profile-routing'
import { getClaudeProfileRouter } from '../../../claude-accounts/claude-profile-installed-router'
import type { ClaudeRuntimeAuthPreparation } from '../../../claude-accounts/runtime-auth-service'
import type { RuntimePtySpawnState } from './spawn-state'

/**
 * A session-mover resume names the account it continues on. Every other
 * Orca-made launch runs on the selected account.
 */
export async function resolveRuntimeClaudeAuth(
  ctx: Pick<RuntimePtySpawnState, 'codexSelectionTarget'> & {
    args: Pick<RuntimePtySpawnState['args'], 'claudeAccountId' | 'resumeProviderSession'>
    deps: Pick<RuntimePtySpawnState['deps'], 'prepareClaudeAuth'>
  }
): Promise<ClaudeRuntimeAuthPreparation | null> {
  const accountId = ctx.args.claudeAccountId
  if (accountId !== undefined) {
    const router = getClaudeProfileRouter()
    if (!router) {
      throw new Error('claude_account_router_unavailable')
    }
    return router.prepareLaunchFor(accountId)
  }
  const sessionId = ctx.args.resumeProviderSession?.id
  // Optional: test doubles of the router only implement prepareLaunchFor.
  const assigned = sessionId ? getClaudeProfileRouter()?.assignedAccountForResume(sessionId) : null
  if (assigned) {
    const router = getClaudeProfileRouter()
    if (!router) {
      throw new Error('claude_account_router_unavailable')
    }
    return router.prepareLaunchFor(assigned)
  }
  return ctx.deps.prepareClaudeAuth
    ? await ctx.deps.prepareClaudeAuth(ctx.codexSelectionTarget)
    : null
}

/** An explicit account must not keep the selected account's shell pointer. */
export function claudeLaunchPinsAccount(claudeAccountId: string | undefined): boolean {
  return claudeAccountId !== undefined
}

/**
 * Why strip: preflight merged the selected account's pointer into `args.env`
 * (`withClaudeProfileTerminalEnv`); a spread cannot remove it, and any pointer makes the pane's
 * `claude` shell function re-route to the selected account. A pinned launch starts without it.
 * Never mutates the caller's env.
 */
export function applyRuntimeClaudeAuthEnv(
  env: Record<string, string> | undefined,
  auth: ClaudeRuntimeAuthPreparation | null,
  pinnedToAccount: boolean
): Record<string, string> | undefined {
  if (!auth) {
    return env
  }
  const base: Record<string, string> = { ...env }
  if (pinnedToAccount) {
    delete base[CLAUDE_PROFILE_POINTER_ENV]
    delete base[CLAUDE_INJECTED_CONFIG_DIR_ENV]
    delete base.CLAUDE_CONFIG_DIR
  }
  return { ...base, ...auth.envPatch }
}
