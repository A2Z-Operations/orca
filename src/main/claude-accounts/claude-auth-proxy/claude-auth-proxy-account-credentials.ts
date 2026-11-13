import { registeredClaudeAccount } from '../claude-registered-account'
import { readClaudeBearerIdentity } from './claude-auth-proxy-bearer-identity'
import {
  claudeStateFileAsync,
  isSameClaudeLogin,
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

const accountDirs = new Map<string, string>()

/** A binding locates credentials; only the registration store establishes ownership. */
export function bindClaudeAuthProxyAccountDir(accountId: string, configDir: string): void {
  if (!accountId || !configDir || getClaudeProfileRouter()) {
    return
  }
  accountDirs.set(accountId, configDir)
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
        requireConsistentSources: true,
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
  const saved = registeredClaudeAccount(accountId)
  return bound
    ? {
        configDir: bound,
        identity: saved
          ? { email: saved.email, organizationUuid: saved.organizationUuid ?? null }
          : null,
        readOptions: {
          requireConsistentSources: true,
          credentialsFileConfigDir: bound,
          keychainConfigDir: bound
        }
      }
    : null
}

async function matchesAccount(source: CredentialSource): Promise<boolean> {
  const current = await readClaudeFolderLoginAsync(
    await claudeStateFileAsync(source.configDir, source.userHome),
    true
  )
  if (!source.identity?.email || !source.identity.organizationUuid?.trim()) {
    console.info('[claude-auth-proxy] identity unknown')
    return false
  }
  if (!current) {
    return false
  }
  if (!isSameClaudeLogin(source.identity, current, true)) {
    console.info('[claude-auth-proxy] account changed under slot')
    return false
  }
  return true
}

async function admitBearer(
  accountId: string,
  source: CredentialSource,
  token: string | null
): Promise<string | null> {
  if (!token || !source.identity) {
    return null
  }
  const identity = await readClaudeBearerIdentity(token)
  if (!identity || !isSameClaudeLogin(source.identity, identity, true)) {
    console.info('[claude-auth-proxy] account changed under slot')
    return null
  }
  const latest = credentialSource(accountId)
  if (
    !latest?.identity ||
    latest.configDir !== source.configDir ||
    !isSameClaudeLogin(source.identity, latest.identity, true)
  ) {
    return null
  }
  return (await matchesAccount(latest)) ? token : null
}

/** Cache misses and refreshes must verify the selected source before admitting its bearer. */
export async function readClaudeAuthProxyAccessToken(accountId: string): Promise<string | null> {
  try {
    const source = credentialSource(accountId)
    if (!source) {
      console.info('[claude-auth-proxy] identity unknown')
      return null
    }
    if (!(await matchesAccount(source))) {
      return null
    }
    const result = await readClaudeOAuthCredentials(source.readOptions)
    return await admitBearer(accountId, source, result.token)
  } catch {
    return null
  }
}

export async function refreshClaudeAuthProxyAccessToken(accountId: string): Promise<string | null> {
  try {
    const source = credentialSource(accountId)
    if (!source) {
      console.info('[claude-auth-proxy] identity unknown')
      return null
    }
    if (!(await matchesAccount(source))) {
      return null
    }
    const refreshed = await refreshClaudeOAuthAccessToken({
      accountId,
      readOptions: source.readOptions
    })
    if (refreshed.outcome !== 'refreshed') {
      return null
    }
    const stored = await readClaudeOAuthCredentials(source.readOptions)
    return stored.token === refreshed.accessToken
      ? await admitBearer(accountId, source, stored.token)
      : null
  } catch {
    return null
  }
}
