import { claudeAuthProxyEnabled } from '../../../shared/claude-account-switch-settings'
import type { ClaudeEnvPatch } from '../environment'
import { claudeAuthProxyBaseUrl } from './claude-auth-proxy-host'

/** Adds the pane's proxy slot when the proxy is on and the user has not set a base URL. */
export function withClaudeAuthProxyUrl(
  accountId: string | null | undefined,
  patch: ClaudeEnvPatch,
  env: NodeJS.ProcessEnv,
  settings: { claudeAuthProxy?: boolean } | null | undefined
): ClaudeEnvPatch {
  if (patch.ANTHROPIC_BASE_URL) {
    return patch
  }
  const url = claudeAuthProxyBaseUrl(accountId, env, claudeAuthProxyEnabled(settings))
  return url ? { ...patch, ANTHROPIC_BASE_URL: url } : patch
}
