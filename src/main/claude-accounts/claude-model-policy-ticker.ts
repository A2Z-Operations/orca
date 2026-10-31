import type { ClaudeModelPolicyEvaluation } from '../../shared/managed-account-types'
import type { ProviderRateLimits } from '../../shared/rate-limit-types'
import { replaceClaudeModelPolicyEvaluations } from './claude-model-policy-evaluations'
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
  /** Fires when `claudeModelPolicy` changes so a line edit does not wait for the next poll. */
  subscribeSettings?: (listener: () => void) => () => void
  apply: (flip: ClaudeModelPolicyFlip) => void
  onWarning?: (ptyId: string, warning: string) => void
  now?: () => number
}): ClaudeModelPolicyTicker {
  const lastFlipAt = new Map<string, number>()
  const warned = new Set<string>()
  const logged = new Map<string, string>()
  let loggedOff = false

  const logPane = (ptyId: string, line: string): void => {
    if (logged.get(ptyId) === line) {
      return
    }
    logged.set(ptyId, line)
    console.info(`[claude-model-policy] ${line}`)
  }

  const evaluate = (): ClaudeModelPolicyFlip[] => {
    const settings = deps.getSettings()
    const policy = resolveClaudeModelPolicy(settings)
    const now = deps.now?.() ?? Date.now()
    const flips: ClaudeModelPolicyFlip[] = []
    const evaluations: ClaudeModelPolicyEvaluation[] = []
    if (!policy.enabled) {
      if (!loggedOff) {
        console.info('[claude-model-policy] policy off')
        loggedOff = true
      }
    } else {
      loggedOff = false
    }
    for (const record of deps.panes()) {
      const accountId = record.assignedAccountId ?? record.accountId
      const note = (
        choice: ClaudePolicyModel | null,
        reason: string,
        skip: string | null,
        windows: { weekly: string; fable: string }
      ): void => {
        evaluations.push({
          ptyId: record.ptyId,
          paneKey: record.paneKey,
          accountId,
          model: record.model ?? null,
          source: record.modelSource ?? null,
          choice,
          reason,
          skip,
          at: now
        })
        logPane(
          record.ptyId,
          `pty=${record.ptyId} pane=${record.paneKey ?? '-'} account=${accountId} model=${record.model ?? '-'} source=${record.modelSource ?? '-'} weekly=${windows.weekly} fable=${windows.fable} lines=${policy.fableLine}/${policy.weeklyGuard} choice=${choice ?? '-'} reason=${reason}${skip ? ` skip=${skip}` : ''}`
        )
      }
      if (!policy.enabled) {
        note(null, 'policy-off', 'policy-off', { weekly: '-', fable: '-' })
        continue
      }
      if (record.modelSource !== 'policy') {
        const skip = record.modelSource === 'pinned' ? 'pinned' : 'not-policy'
        note(null, skip, skip, { weekly: '-', fable: '-' })
        continue
      }
      const current = record.model ? claudePolicyModelLabel(record.model) : null
      if (!current) {
        note(null, 'unrecognized-model', 'unrecognized-model', { weekly: '-', fable: '-' })
        continue
      }
      const usage = deps.usageFor(accountId)
      const readable = usage?.rateLimits?.status === 'ok' ? usage.rateLimits : null
      const windows = {
        weekly: readable?.weekly ? String(Math.round(readable.weekly.usedPercent)) : '-',
        fable: readable?.fableWeekly ? String(Math.round(readable.fableWeekly.usedPercent)) : '-'
      }
      if (!isClaudeUsageFresh(usage, now)) {
        note(null, 'stale', 'stale', windows)
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
        note(choice.model, choice.reason, 'same', windows)
        continue
      }
      const previous = lastFlipAt.get(record.ptyId)
      if (previous !== undefined && now - previous < CLAUDE_MODEL_POLICY_FLIP_COOLDOWN_MS) {
        note(choice.model, choice.reason, 'cooldown', windows)
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
      console.info(
        `[claude-model-policy] flip pty=${record.ptyId} pane=${record.paneKey ?? '-'} account=${accountId} ${current} → ${choice.model} reason=${choice.reason}`
      )
      deps.apply(flip)
      note(choice.model, choice.reason, null, windows)
    }
    replaceClaudeModelPolicyEvaluations(evaluations)
    return flips
  }

  return {
    evaluate,
    start: () => {
      const stopUsage = deps.subscribe(() => evaluate())
      const stopSettings = deps.subscribeSettings?.(() => evaluate()) ?? (() => {})
      console.info('[claude-model-policy] started')
      evaluate()
      return () => {
        stopUsage()
        stopSettings()
        console.info('[claude-model-policy] stopped')
      }
    }
  }
}
