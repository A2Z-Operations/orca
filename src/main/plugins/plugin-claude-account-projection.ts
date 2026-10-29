import {
  claudeBillingAccountId,
  type ClaudePaneAccountRecord
} from '../claude-accounts/claude-pane-account-registry'
import type {
  ProviderRateLimits,
  RateLimitState,
  RateLimitWindow
} from '../../shared/rate-limit-types'
import {
  PLUGIN_ASSIGNED_SESSION_COUNT_MAX,
  PLUGIN_CLAUDE_ACCOUNT_ID_MAX_LENGTH,
  PLUGIN_CLAUDE_ACCOUNT_LABEL_MAX_LENGTH,
  PLUGIN_CLAUDE_ACCOUNT_LIMIT,
  PLUGIN_CLAUDE_WINDOW_MINUTES_MAX,
  type PluginClaudeAccountUsage,
  type PluginClaudeAccountView,
  type PluginClaudeUsageChangedPayload,
  type PluginClaudeUsageWindow
} from '../../shared/plugins/plugin-claude-account-contract'

export type PluginClaudeAccountSource = {
  id: string
  email: string
}

type PluginClaudeAccountRateLimits = Pick<RateLimitState, 'claude' | 'inactiveClaudeAccounts'>

type PluginClaudeAccountPane = Pick<ClaudePaneAccountRecord, 'accountId' | 'assignedAccountId'>

// SAFETY: claudeBillingAccountId reads only assignedAccountId and accountId.
function billingAccountId(pane: PluginClaudeAccountPane): string {
  return claudeBillingAccountId(pane as ClaudePaneAccountRecord)
}

function projectWindow(window: RateLimitWindow | null | undefined): PluginClaudeUsageWindow | null {
  if (!window || !Number.isFinite(window.usedPercent) || !Number.isFinite(window.windowMinutes)) {
    return null
  }
  const windowMinutes = Math.trunc(window.windowMinutes)
  if (windowMinutes <= 0 || windowMinutes > PLUGIN_CLAUDE_WINDOW_MINUTES_MAX) {
    return null
  }
  return {
    usedPercent: Math.min(100, Math.max(0, window.usedPercent)),
    windowMinutes,
    resetsAt: window.resetsAt != null && Number.isFinite(window.resetsAt) ? window.resetsAt : null
  }
}

function projectUsage(limits: ProviderRateLimits | null): PluginClaudeAccountUsage {
  return {
    session: projectWindow(limits?.session),
    weekly: projectWindow(limits?.weekly),
    fableWeekly: projectWindow(limits?.fableWeekly),
    updatedAt: limits && Number.isFinite(limits.updatedAt) ? limits.updatedAt : null
  }
}

/** Host selection owns `state.claude`. A WSL-selected account is in neither slot, so its windows stay empty. */
function limitsFor(
  accountId: string,
  activeAccountId: string | null,
  rateLimits: PluginClaudeAccountRateLimits
): ProviderRateLimits | null {
  if (accountId === activeAccountId && rateLimits.claude) {
    return rateLimits.claude
  }
  return (
    rateLimits.inactiveClaudeAccounts.find((row) => row.accountId === accountId)?.rateLimits ?? null
  )
}

function assignedSessionCount(
  accountId: string,
  panes: readonly PluginClaudeAccountPane[]
): number {
  let count = 0
  for (const pane of panes) {
    if (billingAccountId(pane) === accountId) {
      count += 1
    }
  }
  return Math.min(count, PLUGIN_ASSIGNED_SESSION_COUNT_MAX)
}

export function projectPluginClaudeAccounts(input: {
  accounts: readonly PluginClaudeAccountSource[]
  activeAccountId: string | null
  rateLimits: PluginClaudeAccountRateLimits
  panes: readonly PluginClaudeAccountPane[]
}): PluginClaudeAccountView[] {
  const seen = new Set<string>()
  const views: PluginClaudeAccountView[] = []
  for (const account of input.accounts) {
    const id = account.id.trim()
    if (id.length === 0 || id.length > PLUGIN_CLAUDE_ACCOUNT_ID_MAX_LENGTH || seen.has(id)) {
      continue
    }
    seen.add(id)
    const email = account.email.trim()
    views.push({
      id,
      label: (email.length > 0 ? email : id).slice(0, PLUGIN_CLAUDE_ACCOUNT_LABEL_MAX_LENGTH),
      usage: projectUsage(limitsFor(id, input.activeAccountId, input.rateLimits)),
      assignedSessionCount: assignedSessionCount(id, input.panes)
    })
  }
  views.sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
  return views.slice(0, PLUGIN_CLAUDE_ACCOUNT_LIMIT)
}

function usageFingerprint(usage: PluginClaudeAccountUsage): string {
  return JSON.stringify({
    session: usage.session,
    weekly: usage.weekly,
    fableWeekly: usage.fableWeekly,
    updatedAt: usage.updatedAt
  })
}

export function fingerprintPluginClaudeAccounts(
  accounts: readonly PluginClaudeAccountView[]
): Map<string, string> {
  const next = new Map<string, string>()
  for (const account of accounts) {
    next.set(account.id, usageFingerprint(account.usage))
  }
  return next
}

/** Removed accounts stay quiet. A new id, or a changed window, is the only signal. */
export function diffPluginClaudeAccountUsage(
  previous: ReadonlyMap<string, string>,
  accounts: readonly PluginClaudeAccountView[]
): { changed: PluginClaudeUsageChangedPayload[]; next: Map<string, string> } {
  const next = fingerprintPluginClaudeAccounts(accounts)
  const changed: PluginClaudeUsageChangedPayload[] = []
  for (const account of accounts) {
    if (previous.get(account.id) === next.get(account.id)) {
      continue
    }
    changed.push({
      accountId: account.id,
      label: account.label,
      usage: account.usage
    })
  }
  return { changed, next }
}
