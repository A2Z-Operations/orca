import type { ClaudeRateLimitAccountsState } from '../../shared/managed-account-types'
import {
  claudeAccountTokenRefreshEnabled,
  claudeAuthProxyEnabled
} from '../../shared/claude-account-switch-settings'
import {
  claudeOAuthRefreshStatus,
  setClaudeOAuthRefreshEnabled
} from '../rate-limits/claude-oauth-refresh-state'

type AccountControlSettings = {
  claudeAuthProxy?: boolean
  claudeAccountTokenRefresh?: boolean
}

export function installClaudeTokenRefresh(store: {
  getSettings: () => { claudeAccountTokenRefresh?: boolean }
}): void {
  setClaudeOAuthRefreshEnabled(() => claudeAccountTokenRefreshEnabled(store.getSettings()))
}

export function claudeTokenRefreshFields(
  settings: AccountControlSettings,
  accounts: readonly { id: string }[]
): Required<
  Pick<ClaudeRateLimitAccountsState, 'authProxy' | 'tokenRefresh' | 'tokenRefreshAccounts'>
> {
  return {
    authProxy: claudeAuthProxyEnabled(settings) ? 'on' : 'off',
    tokenRefresh: claudeAccountTokenRefreshEnabled(settings) ? 'on' : 'off',
    tokenRefreshAccounts: accounts.map((account) => {
      const status = claudeOAuthRefreshStatus().find((row) => row.accountId === account.id)
      return {
        accountId: account.id,
        lastRefreshAt: status?.lastRefreshAt ?? null,
        nextRetryAt: status?.nextRetryAt ?? null,
        lapsed: status?.lapsed ?? false
      }
    })
  }
}
