import type { InactiveAccountUsage, ProviderRateLimits } from '../../shared/rate-limit-types'
import { isClaudeUsageReadingOf } from './claude-account-auto-switch'

type UsageAccount = { id: string; runsOnSystemDefault?: true }

export type ClaudeUsageWindowRow = {
  accountId: string
  weekly: number | null
  fable: number | null
  /** Why the percent is blank. Omitted when the window was simply not read yet. */
  unavailable?: string
}

/** List text for a non-ok reading. Omitted for ok, idle, and fetching. */
export function claudeUsageWindowUnavailable(
  limits: ProviderRateLimits | null | undefined
): string | undefined {
  if (
    !limits ||
    limits.status === 'ok' ||
    limits.status === 'idle' ||
    limits.status === 'fetching'
  ) {
    return undefined
  }
  const kind = limits.usageMetadata?.failureKind
  const http = limits.usageMetadata?.httpStatus
  if (kind === 'keychain-unavailable') {
    return 'keychain denied'
  }
  if (http === 401 || http === 403 || http === 429) {
    return String(http)
  }
  if (kind === 'missing-credentials') {
    return 'sign in again'
  }
  if (kind === 'stale-token') {
    return '401'
  }
  if (kind === 'rate-limited') {
    return '429'
  }
  if (limits.status === 'error' || limits.status === 'unavailable') {
    return 'unavailable'
  }
  return undefined
}

type UsageReading = { rateLimits: ProviderRateLimits | null; updatedAt: number }

/** The selected account uses the active reading. Every other account uses the inactive cache. */
export function claudeAccountUsageReading(input: {
  account: UsageAccount
  selectedAccountId: string | null
  selectedLimits: ProviderRateLimits | null
  inactiveAccounts: readonly InactiveAccountUsage[]
}): UsageReading | null {
  if (
    input.account.id === input.selectedAccountId &&
    input.selectedLimits &&
    isClaudeUsageReadingOf(input.selectedLimits, input.account)
  ) {
    return { rateLimits: input.selectedLimits, updatedAt: input.selectedLimits.updatedAt }
  }
  const inactive = input.inactiveAccounts.find((row) => row.accountId === input.account.id)
  return inactive ? { rateLimits: inactive.rateLimits, updatedAt: inactive.updatedAt } : null
}

export function claudeAccountUsageWindows(input: {
  accounts: readonly UsageAccount[]
  selectedAccountId: string | null
  selectedLimits: ProviderRateLimits | null
  inactiveAccounts: readonly InactiveAccountUsage[]
}): ClaudeUsageWindowRow[] {
  return input.accounts.map((account) => {
    const reading = claudeAccountUsageReading({
      account,
      selectedAccountId: input.selectedAccountId,
      selectedLimits: input.selectedLimits,
      inactiveAccounts: input.inactiveAccounts
    })
    const limits = reading?.rateLimits?.status === 'ok' ? reading.rateLimits : null
    const unavailable = claudeUsageWindowUnavailable(reading?.rateLimits)
    return {
      accountId: account.id,
      weekly: limits?.weekly ? limits.weekly.usedPercent : null,
      fable: limits?.fableWeekly ? limits.fableWeekly.usedPercent : null,
      ...(unavailable ? { unavailable } : {})
    }
  })
}
