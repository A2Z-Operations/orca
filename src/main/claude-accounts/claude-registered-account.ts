import type { ClaudeManagedAccount } from '../../shared/managed-account-types'

type RegisteredClaudeAccount = Pick<
  ClaudeManagedAccount,
  'id' | 'email' | 'organizationUuid' | 'wslLinuxAuthPath'
>

let readAccounts: (() => readonly RegisteredClaudeAccount[]) | undefined

/** Read Orca's registration store afresh; never learn an identity from a bound folder. */
export function installClaudeRegisteredAccounts(
  reader: (() => readonly RegisteredClaudeAccount[]) | undefined
): void {
  readAccounts = reader
}

export function registeredClaudeAccount(accountId: string): RegisteredClaudeAccount | undefined {
  return readAccounts?.().find((account) => account.id === accountId)
}

/** A saved guest path locates a registration; folder contents never establish its identity. */
export function registeredClaudeAccountForWslConfigDir(
  configDir: string
): RegisteredClaudeAccount | undefined {
  const matches = readAccounts?.().filter((account) => account.wslLinuxAuthPath === configDir)
  return matches?.length === 1 ? matches[0] : undefined
}
