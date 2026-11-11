import {
  getClaudePaneAccount,
  setClaudePaneModel
} from '../claude-accounts/claude-pane-account-registry'
import { claudePolicyModelLabel } from '../claude-accounts/claude-model-policy'
import { structuredClaudeSessionKey } from './claude-structured-session-key'

/**
 * A model the person fixed (saved option or --model flag) pins the pane and wins over the model
 * policy's env; otherwise a policy-chosen model is handed back so the launch can pass it as `model`.
 */
export function pinStructuredClaudeLaunchModel(
  sessionId: string,
  fixedModel: unknown,
  env: Record<string, string> | undefined
): { policyModelId?: string } {
  const sessionKey = structuredClaudeSessionKey(sessionId)
  const fixed = typeof fixedModel === 'string' && fixedModel.length > 0
  if (fixed) {
    if (env && getClaudePaneAccount(sessionKey)?.modelSource === 'policy') {
      delete env.ANTHROPIC_MODEL
    }
    setClaudePaneModel(sessionKey, claudePolicyModelLabel(fixedModel) ?? fixedModel, 'pinned')
    return {}
  }
  const policyModelId =
    getClaudePaneAccount(sessionKey)?.modelSource === 'policy' ? env?.ANTHROPIC_MODEL : undefined
  return policyModelId ? { policyModelId } : {}
}
