import type { GlobalSettings } from '../../shared/global-settings-types'
import type { ClaudeManagedAccountSummary } from '../../shared/managed-account-types'
import type {
  ProviderRateLimits,
  RateLimitRuntimeTarget,
  RateLimitState
} from '../../shared/rate-limit-types'
import type { RateLimitService } from '../rate-limits/service'
import { DEFAULT_POLL_MS } from '../rate-limits/service/service-types'
import {
  isClaudeOverAutoSwitchLine,
  pickClaudeAutoSwitchTarget
} from './claude-account-auto-switch-policy'
import {
  getSelectedClaudeAccountIdForTarget,
  normalizeClaudeAccountSelectionTarget
} from './runtime-selection'
import type { ClaudeAccountService } from './service'

type ClaudeAutoSwitchSettings = Pick<
  GlobalSettings,
  | 'claudeAutoSwitchEnabled'
  | 'activeClaudeManagedAccountId'
  | 'activeClaudeManagedAccountIdsByRuntime'
>

type ClaudeAutoSwitchDeps = {
  getSettings: () => ClaudeAutoSwitchSettings
  rateLimits: Pick<RateLimitService, 'fetchInactiveClaudeAccountsOnOpen'>
  accounts: Pick<ClaudeAccountService, 'listAccounts' | 'autoSelectAccountForTarget'>
  onSwitched: (emails: { from: string; to: string }) => void
}

type ClaudeAutoSwitchDecision =
  | { kind: 'stay' }
  | { kind: 'read-usage' }
  | { kind: 'switch'; from: ClaudeManagedAccountSummary; to: ClaudeManagedAccountSummary }

const STAY: ClaudeAutoSwitchDecision = { kind: 'stay' }

/** Moves new Claude sessions to the managed account with the most room before a usage limit. */
export function createClaudeAccountAutoSwitch(
  deps: ClaudeAutoSwitchDeps
): (state: RateLimitState) => void {
  let latestState: RateLimitState | null = null
  let selectedAccountId: string | null | undefined
  let lastSwitchAt = 0
  let lastUsageReadAt = 0
  let switching = false

  const decide = (state: RateLimitState, now: number): ClaudeAutoSwitchDecision => {
    const settings = deps.getSettings()
    const selectedId = getSelectedClaudeAccountIdForTarget(settings, state.claudeTarget)
    if (!settings.claudeAutoSwitchEnabled || !selectedId) {
      return STAY
    }
    const accounts = deps.accounts.listAccounts().accounts
    const from = accounts.find((account) => account.id === selectedId)
    if (
      !from ||
      // Why: mid-switch, the snapshot can still be the previous account's.
      !isReadingOf(state.claude, from) ||
      // Why: after a switch or a failed attempt, act only on a newer reading.
      (state.claude?.updatedAt ?? 0) < lastSwitchAt ||
      !isClaudeOverAutoSwitchLine(state.claude, now)
    ) {
      return STAY
    }

    const candidateIds = new Set(
      accounts
        .filter(
          (account) =>
            account.id !== selectedId &&
            !account.needsSignIn &&
            isOnTarget(account, state.claudeTarget)
        )
        .map((account) => account.id)
    )
    const usages = state.inactiveClaudeAccounts.filter((usage) => candidateIds.has(usage.accountId))
    const candidates = usages.filter((usage) => now - usage.updatedAt <= DEFAULT_POLL_MS)
    // Why: rank only once every candidate has a recent reading, or a read was just tried.
    if (candidates.length < candidateIds.size) {
      if (usages.some((usage) => usage.isFetching)) {
        return STAY
      }
      if (now - lastUsageReadAt >= DEFAULT_POLL_MS) {
        return { kind: 'read-usage' }
      }
    }
    const targetId = pickClaudeAutoSwitchTarget(state.claude, candidates, { now, lastSwitchAt })
    const to = accounts.find((account) => account.id === targetId)
    return to ? { kind: 'switch', from, to } : STAY
  }

  const switchAccount = (
    from: ClaudeManagedAccountSummary,
    to: ClaudeManagedAccountSummary,
    target: RateLimitRuntimeTarget
  ): void => {
    switching = true
    // Why: the switch can wait behind a sign-in, so it re-decides on the latest usage when it runs.
    const stillWanted = (): boolean => {
      const decision = latestState ? decide(latestState, Date.now()) : STAY
      return decision.kind === 'switch' && decision.from.id === from.id && decision.to.id === to.id
    }
    deps.accounts
      .autoSelectAccountForTarget(to.id, target, stillWanted)
      .then((switched) => {
        if (switched) {
          deps.onSwitched({ from: from.email, to: to.email })
        }
      })
      .catch((error: unknown) => {
        lastSwitchAt = Date.now()
        console.warn('[claude-accounts] Auto-switch failed:', error)
      })
      .finally(() => {
        switching = false
      })
  }

  return (state) => {
    latestState = state
    const now = Date.now()
    const selectedId = getSelectedClaudeAccountIdForTarget(deps.getSettings(), state.claudeTarget)
    // Why any change, not only ours: an account picked by hand gets the same cooldown.
    if (selectedAccountId !== undefined && selectedId !== selectedAccountId) {
      lastSwitchAt = now
    }
    selectedAccountId = selectedId
    // Why: the usage service skips a read it debounces, so only one under way counts as tried.
    if (state.inactiveClaudeAccounts.some((usage) => usage.isFetching)) {
      lastUsageReadAt = now
    }
    if (switching) {
      return
    }
    const decision = decide(state, now)
    if (decision.kind === 'read-usage') {
      deps.rateLimits
        .fetchInactiveClaudeAccountsOnOpen()
        .catch((error: unknown) =>
          console.warn('[claude-accounts] Failed to read inactive Claude usage:', error)
        )
    } else if (decision.kind === 'switch') {
      switchAccount(decision.from, decision.to, state.claudeTarget)
    }
  }
}

/** Usage is tagged `profile:<id>` (`profile:<id>:wsl:<distro>` in WSL) by the account it was read for. */
function isReadingOf(
  limits: ProviderRateLimits | null,
  account: ClaudeManagedAccountSummary
): boolean {
  const provenance = limits?.usageMetadata?.authProvenance
  // Why: an account System default covers runs on that login, so its usage is tagged `system`.
  if (account.coveredBySystemDefault) {
    return provenance === 'system'
  }
  return (
    provenance === `profile:${account.id}` || !!provenance?.startsWith(`profile:${account.id}:`)
  )
}

function isOnTarget(account: ClaudeManagedAccountSummary, target: RateLimitRuntimeTarget): boolean {
  const accountTarget = normalizeClaudeAccountSelectionTarget({
    runtime: account.managedAuthRuntime,
    wslDistro: account.wslDistro
  })
  return accountTarget.runtime === target.runtime && accountTarget.wslDistro === target.wslDistro
}
