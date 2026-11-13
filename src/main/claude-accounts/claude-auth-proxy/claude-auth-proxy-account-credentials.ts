import {
  claudeStateFile,
  claudeStateFileAsync,
  isSameClaudeLogin,
  readClaudeFolderLogin,
  readClaudeFolderLoginAsync,
  type ClaudeFolderLogin
} from '../claude-account-folder'
import { getClaudeProfileRouter } from '../claude-profile-installed-router'
import {
  readClaudeOAuthCredentials,
  type ClaudeOAuthCredentialReadOptions
} from '../../rate-limits/claude-oauth-credentials'
import { refreshClaudeOAuthAccessToken } from '../../rate-limits/claude-oauth-refresh'

type AccountIdentity = Pick<ClaudeFolderLogin, 'email' | 'organizationUuid'>
type CredentialSource = {
  readOptions: ClaudeOAuthCredentialReadOptions
  identity: AccountIdentity | null
  configDir: string | undefined
  userHome?: string
}

const accountDirs = new Map<string, { configDir: string; identity: AccountIdentity | null }>()

/** Guest bindings pin the login at registration; rebinding must not adopt a replacement login. */
export function bindClaudeAuthProxyAccountDir(accountId: string, configDir: string): void {
  if (!accountId || !configDir || getClaudeProfileRouter()) {
    return
  }
  const previous = accountDirs.get(accountId)
  accountDirs.set(accountId, {
    configDir,
    identity: previous ? previous.identity : readClaudeFolderLogin(claudeStateFile(configDir))
  })
}

export function clearClaudeAuthProxyAccountDirs(): void {
  accountDirs.clear()
}

function credentialSource(accountId: string): CredentialSource | null {
  const router = getClaudeProfileRouter()
  if (router) {
    const covered = router.coveredBySystemDefault(accountId)
    const userDir = router.userConfigDir()
    const configDir = covered ? userDir : router.accountHome(accountId)
    const credentialsDir = configDir ?? router.systemDefaultHome()
    const saved = router.savedAccount(accountId)
    return {
      readOptions: {
        credentialsFileConfigDir: credentialsDir,
        keychainConfigDir: credentialsDir,
        unsuffixedKeychainFallback: covered && !userDir
      },
      identity: saved
        ? { email: saved.email, organizationUuid: saved.organizationUuid ?? null }
        : null,
      configDir,
      userHome: router.userHome
    }
  }
  const bound = accountDirs.get(accountId)
  return bound
    ? {
        ...bound,
        readOptions: {
          credentialsFileConfigDir: bound.configDir,
          keychainConfigDir: bound.configDir
        }
      }
    : null
}

async function matchesAccount(source: CredentialSource): Promise<boolean> {
  const current = await readClaudeFolderLoginAsync(
    await claudeStateFileAsync(source.configDir, source.userHome)
  )
  if (!source.identity || !current) {
    return false
  }
  if (!isSameClaudeLogin(source.identity, current)) {
    console.info('[claude-auth-proxy] account changed under slot')
    return false
  }
  return true
}

/** Cache misses and refreshes must verify the selected source before admitting its bearer. */
export async function readClaudeAuthProxyAccessToken(accountId: string): Promise<string | null> {
  try {
    const source = credentialSource(accountId)
    if (!source || !(await matchesAccount(source))) {
      return null
    }
    const result = await readClaudeOAuthCredentials(source.readOptions)
    return result.token && (await matchesAccount(source)) ? result.token : null
  } catch {
    return null
  }
}

export async function refreshClaudeAuthProxyAccessToken(accountId: string): Promise<string | null> {
  try {
    const source = credentialSource(accountId)
    if (!source || !(await matchesAccount(source))) {
      return null
    }
    const refreshed = await refreshClaudeOAuthAccessToken({
      accountId,
      readOptions: source.readOptions
    })
    return refreshed.outcome === 'refreshed' && (await matchesAccount(source))
      ? refreshed.accessToken
      : null
  } catch {
    return null
  }
}
