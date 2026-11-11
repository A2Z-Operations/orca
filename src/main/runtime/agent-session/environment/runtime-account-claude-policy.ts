import type { ClaudeSessionMoverSetting } from '../../../../shared/claude-account-switch-settings'
import type { ClaudeAuthProxyStatus } from '../../../../shared/claude-auth-proxy-status'
import type { ClaudeRateLimitAccountsState } from '../../../../shared/managed-account-types'
import type { ClaudeAccountService } from '../../../claude-accounts/service'
import type { ClaudeModelPolicyPatch } from '../../../claude-accounts/claude-model-policy'
import { claudeAuthProxyStatus as readClaudeAuthProxyStatus } from '../../../claude-accounts/claude-auth-proxy/claude-auth-proxy-host'
import {
  assignClaudePaneOnExecutionHost,
  type AssignClaudePaneRequest
} from '../../../claude-accounts/claude-pane-account-assign'

/** The fork's Claude account policies, as the runtime command surface exposes them. */
export type RuntimeClaudePolicyMethods = {
  setClaudeSessionMover(setting: ClaudeSessionMoverSetting): ClaudeRateLimitAccountsState
  setClaudeAutoSwitch(enabled: boolean): ClaudeRateLimitAccountsState
  setClaudeAuthProxy(enabled: boolean): ClaudeRateLimitAccountsState
  setClaudeAccountTokenRefresh(enabled: boolean): ClaudeRateLimitAccountsState
  /** Live listener. Does not require the account service: the proxy is process-global. */
  claudeAuthProxyStatus(): ClaudeAuthProxyStatus
  setClaudeAccountPool(enabled: boolean): ClaudeRateLimitAccountsState
  setClaudeModelPolicy(patch: ClaudeModelPolicyPatch): ClaudeRateLimitAccountsState
  /** Works without account services: a WSL guest has the proxy and the pane registry, not the desktop's accounts. */
  assignClaudePane(request: AssignClaudePaneRequest): { assigned: boolean }
}

/** Each setter writes where the accounts live; `requireAccounts` throws the controller's "managed by the desktop" message. */
export function runtimeClaudePolicyMethods(
  requireAccounts: () => ClaudeAccountService
): RuntimeClaudePolicyMethods {
  return {
    setClaudeSessionMover: (setting) => requireAccounts().setSessionMover(setting),
    setClaudeAutoSwitch: (enabled) => requireAccounts().setAutoSwitch(enabled),
    setClaudeAuthProxy: (enabled) => requireAccounts().setAuthProxy(enabled),
    setClaudeAccountTokenRefresh: (enabled) => requireAccounts().setTokenRefresh(enabled),
    claudeAuthProxyStatus: () => readClaudeAuthProxyStatus(),
    setClaudeAccountPool: (enabled) => requireAccounts().setAccountPool(enabled),
    setClaudeModelPolicy: (patch) => requireAccounts().setModelPolicy(patch),
    assignClaudePane: (request) => assignClaudePaneOnExecutionHost(request)
  }
}
