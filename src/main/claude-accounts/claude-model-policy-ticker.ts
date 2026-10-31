import type { ProviderRateLimits } from '../../shared/rate-limit-types'
import type { ClaudePaneAccountRecord } from './claude-pane-account-registry'
import {
  CLAUDE_MODEL_POLICY_FLIP_COOLDOWN_MS,
  chooseClaudeModel,
  claudePolicyModelLabel,
  resolveClaudeModelPolicy,
  type ClaudeModelPolicySettings,
  type ClaudePolicyModel
} from './claude-model-policy'
import { isClaudeUsageFresh } from './claude-session-mover-policy'

export type ClaudeModelPolicyFlip = {
  ptyId: string
  paneKey: string | null
  accountId: string
  from: ClaudePolicyModel
  to: ClaudePolicyModel
  reason: string
  at: number
}

export type ClaudeModelPolicyTicker = {
  /** One pass. The subscription calls this on each usage publish. */
  evaluate: () => ClaudeModelPolicyFlip[]
  start: () => () => void
}

/**
 * Flips a policy-pinned slot when its account crosses a line or a window resets.
 * Leaving Fable happens at the line. Returning waits out the hysteresis band.
 * At most one flip per pane per {@link CLAUDE_MODEL_POLICY_FLIP_COOLDOWN_MS}.
 */
export function createClaudeModelPolicyTicker(deps: {
  getSettings: () => { claudeModelPolicy?: ClaudeModelPolicySettings }
  panes: () => readonly ClaudePaneAccountRecord[]
  usageFor: (
    accountId: string
  ) => { rateLimits: ProviderRateLimits | null; updatedAt: number } | null
  subscribe: (listener: () => void) => () => void
  apply: (flip: ClaudeModelPolicyFlip) => void
  onWarning?: (ptyId: string, warning: string) => void
  now?: () => number
}): ClaudeModelPolicyTicker {
  const lastFlipAt = new Map<string, number>()
  const warned = new Set<string>()

  const evaluate = (): ClaudeModelPolicyFlip[] => {
    const settings = deps.getSettings()
    if (!resolveClaudeModelPolicy(settings).enabled) {
      return []
    }
    const now = deps.now?.() ?? Date.now()
    const flips: ClaudeModelPolicyFlip[] = []
    for (const record of deps.panes()) {
      if (record.modelSource !== 'policy') {
        continue
      }
      const current = record.model ? claudePolicyModelLabel(record.model) : null
      if (!current) {
        continue
      }
      const accountId = record.assignedAccountId ?? record.accountId
      const usage = deps.usageFor(accountId)
      if (!isClaudeUsageFresh(usage, now)) {
        continue
      }
      const choice = chooseClaudeModel({
        limits: usage?.rateLimits ?? null,
        settings,
        now,
        current
      })
      if (choice.warning) {
        if (!warned.has(record.ptyId)) {
          warned.add(record.ptyId)
          deps.onWarning?.(record.ptyId, choice.warning)
        }
      } else {
        warned.delete(record.ptyId)
      }
      if (choice.model === current) {
        continue
      }
      const previous = lastFlipAt.get(record.ptyId)
      if (previous !== undefined && now - previous < CLAUDE_MODEL_POLICY_FLIP_COOLDOWN_MS) {
        continue
      }
      lastFlipAt.set(record.ptyId, now)
      const flip: ClaudeModelPolicyFlip = {
        ptyId: record.ptyId,
        paneKey: record.paneKey,
        accountId,
        from: current,
        to: choice.model,
        reason: choice.reason,
        at: now
      }
      flips.push(flip)
      deps.apply(flip)
    }
    return flips
  }

  return {
    evaluate,
    start: () => deps.subscribe(() => evaluate())
  }
}
