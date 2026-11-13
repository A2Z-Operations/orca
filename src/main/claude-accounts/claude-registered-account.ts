import type { ClaudeManagedAccount } from '../../shared/managed-account-types'

let readAccounts: (() => readonly ClaudeManagedAccount[]) | undefined

/** Read Orca's registration store afresh; never learn an identity from a bound folder. */
export function installClaudeRegisteredAccounts(
  reader: (() => readonly ClaudeManagedAccount[]) | undefined
): void {
  readAccounts = reader
}

export function registeredClaudeAccount(accountId: string): ClaudeManagedAccount | undefined {
  return readAccounts?.().find((account) => account.id === accountId)
}
