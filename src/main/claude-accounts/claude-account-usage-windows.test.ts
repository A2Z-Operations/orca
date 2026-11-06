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

const blank = { session: null, weekly: null, fable: null, readAt: null, source: null }

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
      { accountId: 'active', session: 1, weekly: 64, fable: 63, readAt: 1, source: 'selected' },
      { accountId: 'idle', session: 1, weekly: 12, fable: 8, readAt: 2, source: 'cached' }
    ])
  })

  it('leaves an unread inactive account blank', () => {
    const rows = claudeAccountUsageWindows({
      accounts: [account('idle')],
      selectedAccountId: 'active',
      selectedLimits: reading('active', 64, 63),
      inactiveAccounts: []
    })
    expect(rows).toEqual([
      { accountId: 'idle', session: null, weekly: null, fable: null, readAt: null, source: null }
    ])
  })

  it('names a keychain denial and an http failure instead of a blank window', () => {
    const failed = (
      accountId: string,
      usageMetadata: ProviderRateLimits['usageMetadata']
    ): ProviderRateLimits => ({
      ...reading(accountId, 10, 10),
      status: 'error',
      weekly: null,
      fableWeekly: null,
      error: 'Claude usage is unavailable.',
      usageMetadata
    })
    const rows = claudeAccountUsageWindows({
      accounts: [account('keychain'), account('http'), account('login'), account('unread')],
      selectedAccountId: 'active',
      selectedLimits: null,
      inactiveAccounts: [
        {
          accountId: 'keychain',
          rateLimits: failed('keychain', { failureKind: 'keychain-unavailable' }),
          updatedAt: 1,
          isFetching: false
        },
        {
          accountId: 'http',
          rateLimits: failed('http', { failureKind: 'missing-credentials', httpStatus: 401 }),
          updatedAt: 1,
          isFetching: false
        },
        {
          accountId: 'login',
          rateLimits: failed('login', { failureKind: 'missing-credentials' }),
          updatedAt: 1,
          isFetching: false
        }
      ]
    })
    expect(rows).toEqual([
      {
        ...blank,
        readAt: 1,
        source: 'cached',
        accountId: 'keychain',
        unavailable: 'keychain denied'
      },
      { ...blank, readAt: 1, source: 'cached', accountId: 'http', unavailable: '401' },
      { ...blank, readAt: 1, source: 'cached', accountId: 'login', unavailable: 'sign in again' },
      { ...blank, accountId: 'unread' }
    ])
  })
})
