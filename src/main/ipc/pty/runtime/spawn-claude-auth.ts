import {
  CLAUDE_INJECTED_CONFIG_DIR_ENV,
  CLAUDE_PROFILE_POINTER_ENV
} from '../../../../shared/claude-profile-routing'
import { getClaudeProfileRouter } from '../../../claude-accounts/claude-profile-installed-router'
import type { ClaudeRuntimeAuthPreparation } from '../../../claude-accounts/runtime-auth-service'
import type { RuntimePtySpawnState } from './spawn-state'

/**
 * Why: a session-mover resume names the account it moves to; every other launch runs on the selected
 * account, as before. The installed router is the one that routes the selected account's launches.
 */
export async function resolveRuntimeClaudeAuth(
  ctx: Pick<RuntimePtySpawnState, 'codexSelectionTarget'> & {
    args: Pick<RuntimePtySpawnState['args'], 'claudeAccountId'>
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
  return ctx.deps.prepareClaudeAuth ? ctx.deps.prepareClaudeAuth(ctx.codexSelectionTarget) : null
}

/**
 * Why strip: preflight merged the SELECTED account's pointer into `args.env`
 * (`withClaudeProfileTerminalEnv`); a spread cannot remove it, and any pointer makes the pane's
 * `claude` shell function re-route to the selected account (`src/shared/claude-shell-function.ts`).
 * A pinned launch starts without it and carries only that account's `CLAUDE_CONFIG_DIR` (Task 3).
 * `ORCA_CLAUDE_USER_CONFIG_DIR` stays: it names the user's own dir. Never mutates the caller's env.
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
