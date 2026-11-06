import type {
  ClaudeAuthProxyHealth,
  ClaudeRateLimitAccountsState
} from '../../shared/managed-account-types'
import type { ClaudeAuthProxyStatus } from '../../shared/claude-auth-proxy-status'
import {
  resolveClaudeModelPolicy,
  type ClaudeModelPolicyPatch,
  type ClaudeModelPolicySettings
} from './claude-model-policy'
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
type ModelPolicySettings = {
  claudeModelPolicy?: ClaudeModelPolicySettings
  claudeModelPolicyCoversExplicit?: boolean
}

/** The settings a model-policy patch writes. Unset fields keep the saved value. */
export function claudeModelPolicySettingsUpdate(
  current: ModelPolicySettings,
  patch: ClaudeModelPolicyPatch
): ModelPolicySettings {
  const saved = current.claudeModelPolicy
  return {
    claudeModelPolicy: resolveClaudeModelPolicy({
      claudeModelPolicy: {
        enabled: patch.enabled ?? saved?.enabled,
        fableLine: patch.fableLine ?? saved?.fableLine,
        weeklyGuard: patch.weeklyGuard ?? saved?.weeklyGuard
      }
    }),
    ...(patch.coversExplicit !== undefined
      ? { claudeModelPolicyCoversExplicit: patch.coversExplicit }
      : {})
  }
}

export function claudeAccountListExtras(
  settings: ModelPolicySettings
): Pick<
  ClaudeRateLimitAccountsState,
  'modelPolicy' | 'modelPolicyEvaluations' | 'authProxyHealth'
> {
  const evaluations = claudeModelPolicyEvaluations()
  const health = authProxyHealth()
  return {
    modelPolicy: {
      ...resolveClaudeModelPolicy(settings),
      coversExplicit: settings.claudeModelPolicyCoversExplicit === true
    },
    ...(evaluations.length > 0 ? { modelPolicyEvaluations: evaluations } : {}),
    ...(health ? { authProxyHealth: health } : {})
  }
}
