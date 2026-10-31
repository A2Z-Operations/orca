import type {
  ClaudeManagedAccount,
  ClaudeManagedAccountSummary
} from '../../shared/managed-account-types'
import { claudeStateFile, readClaudeFolderLogin } from './claude-account-folder'
import { savedWslClaudeAccountHome } from './claude-profile-wsl-paths'

type AccountHomeRouter = {
  accountHome: (accountId: string) => string
  coveredBySystemDefault: (accountId: string) => boolean
}

export function savedClaudeManagedAccountSummary(
  account: ClaudeManagedAccount
): ClaudeManagedAccountSummary {
  return {
    id: account.id,
    email: account.email,
    managedAuthRuntime: account.managedAuthRuntime ?? 'host',
    wslDistro: account.wslDistro ?? null,
    authMethod: account.authMethod ?? 'unknown',
    organizationUuid: account.organizationUuid ?? null,
    organizationName: account.organizationName ?? null,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
    lastAuthenticatedAt: account.lastAuthenticatedAt
  }
}

/** Folder login when it can be read. A stopped WSL distro is not started just to check. */
export function summarizeClaudeManagedAccount(
  account: ClaudeManagedAccount,
  router: AccountHomeRouter
): ClaudeManagedAccountSummary {
  const summary = savedClaudeManagedAccountSummary(account)
  if (account.managedAuthRuntime === 'wsl') {
    return savedWslClaudeAccountHome(account) ? summary : { ...summary, needsSignIn: true }
  }
  const home = router.accountHome(account.id)
  const login = readClaudeFolderLogin(claudeStateFile(home))
  if (login) {
    return {
      ...summary,
      home,
      email: login.email,
      organizationUuid: login.organizationUuid,
      organizationName: login.organizationName
    }
  }
  return router.coveredBySystemDefault(account.id)
    ? { ...summary, home, runsOnSystemDefault: true }
    : { ...summary, home, needsSignIn: true }
}
