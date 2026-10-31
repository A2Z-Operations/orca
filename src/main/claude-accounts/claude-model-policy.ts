import type { ProviderRateLimits, RateLimitWindow } from '../../shared/rate-limit-types'
import type { ClaudePoolAccount, ClaudePoolUsage } from './claude-account-pool-policy'
import { isClaudeUsageFresh } from './claude-session-mover-policy'

/** API ids Claude Code 2.1.316 sends. Fable is 16 characters and Opus 5.5 is 15. */
export const CLAUDE_FABLE_MODEL_ID = 'claude-fable-5-1'
export const CLAUDE_OPUS_MODEL_ID = 'claude-opus-5-5'

export const CLAUDE_MODEL_POLICY_FABLE_LINE = 90
export const CLAUDE_MODEL_POLICY_WEEKLY_GUARD = 91
/** Flip back to Fable only this far under each line, so a window that bounces does not flap. */
export const CLAUDE_MODEL_POLICY_HYSTERESIS_PTS = 5
/** At most one model flip per slot in this window. */
export const CLAUDE_MODEL_POLICY_FLIP_COOLDOWN_MS = 10 * 60 * 1000
/** Weekly usage at or above this strands Fable headroom behind the weekly guard. */
export const CLAUDE_MODEL_POLICY_STRAND_WARNING_PERCENT = 80
export const CLAUDE_MODEL_POLICY_STRAND_WARNING = 'Fable budget will be stranded'

export type ClaudePolicyModel = 'fable' | 'opus'
export type ClaudeModelSource = 'policy' | 'pinned'

export type ClaudeModelPolicySettings = {
  /** Absent means on. Only an explicit false turns the policy off. */
  enabled?: boolean
  fableLine?: number
  weeklyGuard?: number
}

/** A partial write. Unset fields keep the saved value. */
export type ClaudeModelPolicyPatch = ClaudeModelPolicySettings

export type ClaudeModelPolicyResolved = {
  enabled: boolean
  fableLine: number
  weeklyGuard: number
}

export type ClaudeModelChoice = {
  model: ClaudePolicyModel
  modelId: string
  reason: string
  warning: string | null
}

export type ClaudePoolModelChoice = {
  accountId: string
  /** `chosen` won on headroom. `fallback` is the selected account because nothing ranked. */
  kind: 'chosen' | 'fallback'
  model: ClaudePolicyModel
  reason: string
  warning: string | null
}

type WindowRead = { used: number; reset: boolean }

export function claudeModelId(model: ClaudePolicyModel): string {
  return model === 'fable' ? CLAUDE_FABLE_MODEL_ID : CLAUDE_OPUS_MODEL_ID
}

/** `fable` / `opus` for a policy id or alias. Anything else is not a policy model. */
export function claudePolicyModelLabel(value: string): ClaudePolicyModel | null {
  if (value === CLAUDE_FABLE_MODEL_ID || value === 'fable') {
    return 'fable'
  }
  if (value === CLAUDE_OPUS_MODEL_ID || value === 'opus') {
    return 'opus'
  }
  return null
}

export function resolveClaudeModelPolicy(
  settings: { claudeModelPolicy?: ClaudeModelPolicySettings } | null | undefined
): ClaudeModelPolicyResolved {
  const policy = settings?.claudeModelPolicy
  return {
    enabled: policy?.enabled !== false,
    fableLine: clampLine(policy?.fableLine, CLAUDE_MODEL_POLICY_FABLE_LINE),
    weeklyGuard: clampLine(policy?.weeklyGuard, CLAUDE_MODEL_POLICY_WEEKLY_GUARD)
  }
}

/**
 * Which model this account should run. A fresh launch (`current` omitted) takes Fable only while
 * both windows are present and under their lines. An account already on Opus returns to Fable
 * only after both windows are {@link CLAUDE_MODEL_POLICY_HYSTERESIS_PTS} under the lines.
 */
export function chooseClaudeModel(input: {
  limits: ProviderRateLimits | null
  settings?: { claudeModelPolicy?: ClaudeModelPolicySettings } | null
  now: number
  current?: ClaudePolicyModel | null
}): ClaudeModelChoice {
  const policy = resolveClaudeModelPolicy(input.settings)
  const warning = strandWarning(input.limits, input.now)
  if (!policy.enabled) {
    return { model: 'opus', modelId: CLAUDE_OPUS_MODEL_ID, reason: 'off', warning }
  }
  const fable = readWindow(input.limits, 'fableWeekly', input.now)
  const weekly = readWindow(input.limits, 'weekly', input.now)
  if (input.current === 'opus') {
    return chooseReturnToFable(policy, fable, weekly, warning)
  }
  return chooseFresh(policy, fable, weekly, warning)
}

/**
 * Account for a new launch while the model policy is on.
 * Fable-eligible accounts rank by Fable headroom. Otherwise the account with the most weekly
 * headroom runs Opus. Ties break to fewer assigned panes, then account order.
 */
export function chooseClaudePoolAccountForModel(input: {
  accounts: readonly ClaudePoolAccount[]
  usage: readonly ClaudePoolUsage[]
  now: number
  pinnedCounts: Readonly<Record<string, number>>
  assignedCounts: Readonly<Record<string, number>>
  settings?: { claudeModelPolicy?: ClaudeModelPolicySettings } | null
}): ClaudePoolModelChoice | null {
  const selected = input.accounts.find((account) => account.selected)
  const usageById = new Map(input.usage.map((row) => [row.accountId, row]))
  const policy = resolveClaudeModelPolicy(input.settings)
  const ranked: {
    id: string
    headroom: number
    assigned: number
    index: number
    choice: ClaudeModelChoice
  }[] = []
  const opusRanked: typeof ranked = []
  input.accounts.forEach((account, index) => {
    if (!usableAccount(account, input)) {
      return
    }
    const row = usageById.get(account.id) ?? null
    if (!isClaudeUsageFresh(row, input.now)) {
      return
    }
    const limits = row?.rateLimits ?? null
    const choice = chooseClaudeModel({
      limits,
      settings: input.settings,
      now: input.now
    })
    const assigned = input.assignedCounts[account.id] ?? 0
    if (choice.model === 'fable') {
      const fable = readWindow(limits, 'fableWeekly', input.now)
      ranked.push({
        id: account.id,
        headroom: fable ? policy.fableLine - fable.used : 0,
        assigned,
        index,
        choice
      })
      return
    }
    const weekly = readWindow(limits, 'weekly', input.now)
    if (!weekly) {
      return
    }
    opusRanked.push({
      id: account.id,
      headroom: 100 - weekly.used,
      assigned,
      index,
      choice
    })
  })
  const best = bestRow(ranked) ?? bestRow(opusRanked)
  if (!best) {
    if (!selected) {
      return null
    }
    const choice = chooseClaudeModel({
      limits: usageById.get(selected.id)?.rateLimits ?? null,
      settings: input.settings,
      now: input.now
    })
    return { accountId: selected.id, kind: 'fallback', ...choiceFields(choice) }
  }
  return { accountId: best.id, kind: 'chosen', ...choiceFields(best.choice) }
}

function choiceFields(
  choice: ClaudeModelChoice
): Omit<ClaudePoolModelChoice, 'accountId' | 'kind'> {
  return {
    model: choice.model,
    reason: choice.reason,
    warning: choice.warning
  }
}

function bestRow<T extends { headroom: number; assigned: number; index: number }>(
  rows: T[]
): T | undefined {
  return [...rows].sort(
    (a, b) => b.headroom - a.headroom || a.assigned - b.assigned || a.index - b.index
  )[0]
}

function usableAccount(
  account: ClaudePoolAccount,
  input: { now: number; pinnedCounts: Readonly<Record<string, number>> }
): boolean {
  if (!account.signedIn) {
    return false
  }
  if (account.failureHoldUntil !== undefined && account.failureHoldUntil > input.now) {
    return false
  }
  return (input.pinnedCounts[account.id] ?? 0) === 0
}

function chooseFresh(
  policy: ClaudeModelPolicyResolved,
  fable: WindowRead | null,
  weekly: WindowRead | null,
  warning: string | null
): ClaudeModelChoice {
  if (!fable) {
    return opus('fable-unread', warning)
  }
  if (!weekly) {
    return opus('weekly-unread', warning)
  }
  if (fable.used >= policy.fableLine) {
    return opus('fable-line', warning)
  }
  if (weekly.used >= policy.weeklyGuard) {
    return opus('weekly-guard', warning)
  }
  const reason = fable.reset || weekly.reset ? 'window-reset' : 'fable-headroom'
  return fableChoice(reason, warning)
}

function chooseReturnToFable(
  policy: ClaudeModelPolicyResolved,
  fable: WindowRead | null,
  weekly: WindowRead | null,
  warning: string | null
): ClaudeModelChoice {
  const fableCut = policy.fableLine - CLAUDE_MODEL_POLICY_HYSTERESIS_PTS
  const weeklyCut = policy.weeklyGuard - CLAUDE_MODEL_POLICY_HYSTERESIS_PTS
  if (!fable || !weekly || fable.used >= fableCut || weekly.used >= weeklyCut) {
    return opus('hysteresis', warning)
  }
  const reason = fable.reset || weekly.reset ? 'window-reset' : 'fable-headroom'
  return fableChoice(reason, warning)
}

function fableChoice(reason: string, warning: string | null): ClaudeModelChoice {
  return { model: 'fable', modelId: CLAUDE_FABLE_MODEL_ID, reason, warning }
}

function opus(reason: string, warning: string | null): ClaudeModelChoice {
  return { model: 'opus', modelId: CLAUDE_OPUS_MODEL_ID, reason, warning }
}

function strandWarning(limits: ProviderRateLimits | null, now: number): string | null {
  const weekly = readWindow(limits, 'weekly', now)
  if (!weekly || weekly.used < CLAUDE_MODEL_POLICY_STRAND_WARNING_PERCENT) {
    return null
  }
  return CLAUDE_MODEL_POLICY_STRAND_WARNING
}

function readWindow(
  limits: ProviderRateLimits | null,
  name: 'weekly' | 'fableWeekly',
  now: number
): WindowRead | null {
  if (limits?.status !== 'ok') {
    return null
  }
  const window: RateLimitWindow | null | undefined = limits[name]
  if (!window) {
    return null
  }
  if (window.resetsAt !== null && window.resetsAt <= now) {
    return { used: 0, reset: true }
  }
  return { used: window.usedPercent, reset: false }
}

function clampLine(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback
  }
  return Math.min(100, Math.max(1, Math.round(value)))
}
