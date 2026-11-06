import type {
  ClaudeAuthProxyHealth,
  ClaudeRateLimitAccountsState
} from '../../shared/managed-account-types'
import type { ClaudeAuthProxyStatus } from '../../shared/claude-auth-proxy-status'
import { resolveClaudeModelPolicy, type ClaudeModelPolicySettings } from './claude-model-policy'
import { claudeModelPolicyEvaluations } from './claude-model-policy-evaluations'

let readProxyStatus: (() => ClaudeAuthProxyStatus | null) | null = null

/** The listener's host installs this. Kept here so the account list does not import the listener. */
export function setClaudeAuthProxyStatusReader(
  reader: (() => ClaudeAuthProxyStatus | null) | null
): void {
  readProxyStatus = reader
}

function authProxyHealth(): ClaudeAuthProxyHealth | null {
  const status = readProxyStatus?.() ?? null
  if (!status) {
    return null
  }
  return {
    listening: status.listening,
    unknownSlotRequests: status.unknownSlotRequests,
    lastError: status.lastError
  }
}

/** Model policy, its last pass per pane, and auth-proxy health for `accounts.list`. */
export function claudeAccountListExtras(settings: {
  claudeModelPolicy?: ClaudeModelPolicySettings
}): Pick<
  ClaudeRateLimitAccountsState,
  'modelPolicy' | 'modelPolicyEvaluations' | 'authProxyHealth'
> {
  const evaluations = claudeModelPolicyEvaluations()
  const health = authProxyHealth()
  return {
    modelPolicy: resolveClaudeModelPolicy(settings),
    ...(evaluations.length > 0 ? { modelPolicyEvaluations: evaluations } : {}),
    ...(health ? { authProxyHealth: health } : {})
  }
}
