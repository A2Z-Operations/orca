import { describe, expect, it } from 'vitest'
import type { ProviderRateLimits } from '../../shared/rate-limit-types'
import { claudeAccountUsageWindows } from './claude-account-usage-windows'

function account(id: string): { id: string } {
  return { id }
}

function reading(accountId: string, weekly: number, fable: number): ProviderRateLimits {
  const window = (usedPercent: number) => ({
    usedPercent,
    windowMinutes: 10080,
    resetsAt: null,
    resetDescription: null
  })
  return {
    provider: 'claude',
    session: window(1),
    weekly: window(weekly),
    fableWeekly: window(fable),
    updatedAt: 1,
    error: null,
    status: 'ok',
    usageMetadata: { authProvenance: `profile:${accountId}` }
  }
}

describe('claudeAccountUsageWindows', () => {
  it('reads the active account from the selected reading and inactive accounts from the cache', () => {
    const rows = claudeAccountUsageWindows({
      accounts: [account('active'), account('idle')],
      selectedAccountId: 'active',
      selectedLimits: reading('active', 64, 63),
      inactiveAccounts: [
        {
          accountId: 'idle',
          rateLimits: reading('idle', 12, 8),
          updatedAt: 2,
          isFetching: false
        }
      ]
    })
    expect(rows).toEqual([
      { accountId: 'active', weekly: 64, fable: 63 },
      { accountId: 'idle', weekly: 12, fable: 8 }
    ])
  })

  it('leaves an unread inactive account blank', () => {
    const rows = claudeAccountUsageWindows({
      accounts: [account('idle')],
      selectedAccountId: 'active',
      selectedLimits: reading('active', 64, 63),
      inactiveAccounts: []
    })
    expect(rows).toEqual([{ accountId: 'idle', weekly: null, fable: null }])
  })
})
