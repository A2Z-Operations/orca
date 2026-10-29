// How a host Claude account compares with System default: where its usage is read, and whether
// an old terminal's `claude` (which runs System default) runs another account than the selected one.
import type { ClaudeManagedAccount } from '../../shared/managed-account-types'
import type { ClaudeFolderLogin } from './claude-account-folder'
import { isSameClaudeLogin } from './claude-account-folder'
import type { ClaudeRuntimeAuthPreparation } from './runtime-auth/runtime-auth-types'

/** The router's public reads these comparisons use. */
export type SystemDefaultReads = {
  coveredBySystemDefault: (accountId: string) => boolean
  accountHome: (accountId: string) => string
  systemDefaultHome: () => string
  accountLogin: (accountId: string) => ClaudeFolderLogin | null
  systemDefaultLogin: (maxAgeMs?: number) => ClaudeFolderLogin | null
}

/** Where an unselected account's usage is read: where its launches would run once selected. */
export function claudeAccountUsagePreparation(
  reads: SystemDefaultReads,
  accountId: string
): ClaudeRuntimeAuthPreparation {
  if (reads.coveredBySystemDefault(accountId)) {
    // Why no CLAUDE_CONFIG_DIR: naming System default's folder moves Claude to another Keychain item.
    return { configDir: reads.systemDefaultHome(), envPatch: {}, provenance: 'system' }
  }
  const home = reads.accountHome(accountId)
  return {
    configDir: home,
    envPatch: { CLAUDE_CONFIG_DIR: home },
    provenance: `profile:${accountId}`
  }
}

/** True unless the selected account's login and System default's are known and the same. */
export function systemDefaultRunsAnotherAccount(
  reads: SystemDefaultReads,
  selectedAccountId: string,
  saved: ClaudeManagedAccount | undefined
): boolean {
  const selected = reads.accountLogin(selectedAccountId) ?? saved
  const systemDefault = reads.systemDefaultLogin(5_000)
  return !selected || !systemDefault || !isSameClaudeLogin(selected, systemDefault)
}
