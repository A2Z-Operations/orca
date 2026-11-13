import { once } from 'node:events'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { vi } from 'vitest'
import type * as Keychain from '../keychain'
import type { ClaudeManagedAccount } from '../../../shared/managed-account-types'
import { ClaudeProfileRouter } from '../claude-profile-router'
import { installClaudeProfileRouter } from '../claude-profile-installed-router'
import { installClaudeRegisteredAccounts } from '../claude-registered-account'
import { createClaudeAuthProxy } from './claude-auth-proxy'
import {
  bindClaudeAuthProxyAccountDir,
  clearClaudeAuthProxyAccountDirs,
  readClaudeAuthProxyAccessToken,
  refreshClaudeAuthProxyAccessToken
} from './claude-auth-proxy-account-credentials'

const identityMocks = vi.hoisted(() => ({
  profile: vi.fn(),
  refresh: vi.fn(),
  keychain: vi.fn(async (): Promise<string | null> => null)
}))
vi.mock('../../rate-limits/claude-oauth-node-fetch', () => ({
  claudeOAuthTokenFetch: identityMocks.profile
}))
vi.mock('../../rate-limits/claude-oauth-refresh', () => ({
  refreshClaudeOAuthAccessToken: identityMocks.refresh
}))
vi.mock('../keychain', async (importOriginal) => ({
  ...(await importOriginal<typeof Keychain>()),
  readActiveClaudeKeychainCredentialsStrict: identityMocks.keychain
}))

export const saved: ClaudeManagedAccount = {
  id: 'account-a',
  email: 'first@example.invalid',
  organizationUuid: 'org-first',
  authMethod: 'subscription-oauth',
  managedAuthPath: '/unused',
  createdAt: 0,
  updatedAt: 0,
  lastAuthenticatedAt: 0
}
export const originalLogin = {
  emailAddress: 'first@example.invalid',
  organizationUuid: 'org-first'
}

export async function identityFixture(route: string) {
  identityMocks.keychain.mockResolvedValue(null)
  identityMocks.refresh.mockReset()
  identityMocks.profile.mockImplementation(async (_url: string, init: RequestInit) => {
    const own = [
      'Bearer synthetic-recovery-credential',
      'Bearer synthetic-renewed-credential'
    ].includes(new Headers(init.headers).get('authorization') ?? '')
    return Response.json({
      account: { email: own ? 'first@example.invalid' : 'second@example.invalid' },
      organization: { uuid: own ? 'org-first' : 'org-second' }
    })
  })
  const root = await mkdtemp(join(tmpdir(), 'claude-proxy-identity-'))
  let accounts = [{ ...saved }]
  const router = new ClaudeProfileRouter({
    dataRoot: join(root, 'data'),
    userHome: join(root, 'user'),
    env: {},
    getSettings: () => ({
      claudeManagedAccounts: accounts,
      activeClaudeManagedAccountId: saved.id,
      agentStatusHooksEnabled: false,
      disabledTuiAgents: []
    })
  })
  const configDir =
    route === 'system default' ? router.systemDefaultHome() : router.accountHome(saved.id)
  const stateFile = join(route === 'system default' ? router.userHome : configDir, '.claude.json')
  await mkdir(configDir, { recursive: true })
  await writeFile(stateFile, JSON.stringify({ oauthAccount: originalLogin }))
  installClaudeRegisteredAccounts(() => accounts)
  if (route === 'guest') {
    bindClaudeAuthProxyAccountDir(saved.id, configDir)
  } else {
    installClaudeProfileRouter(router)
  }
  const seen: boolean[] = []
  let upstreamStatus = 200
  const upstream = createServer((req, res) => {
    seen.push(
      ['Bearer synthetic-recovery-credential', 'Bearer synthetic-renewed-credential'].includes(
        req.headers.authorization ?? ''
      )
    )
    req.resume()
    res.writeHead(upstreamStatus, { 'content-type': 'application/json' })
    res.end('{}')
  })
  upstream.listen(0, '127.0.0.1')
  await once(upstream, 'listening')
  const address = upstream.address()
  if (!address || typeof address === 'string') {
    throw new Error('No loopback port')
  }
  let at = 0
  const proxy = createClaudeAuthProxy({
    readToken: readClaudeAuthProxyAccessToken,
    refreshAccessToken: refreshClaudeAuthProxyAccessToken,
    now: () => at,
    upstream: `http://127.0.0.1:${address.port}`
  })
  await proxy.start()
  const slot = proxy.allocateSlot(saved.id)
  return {
    root,
    configDir,
    stateFile,
    seen,
    proxy,
    slot,
    setAccounts: (next: ClaudeManagedAccount[]) => {
      accounts = next
    },
    setUpstreamStatus: (status: number) => {
      upstreamStatus = status
    },
    advance: (ms = 5_000) => {
      at += ms
    },
    writeToken: (foreign = false) =>
      writeFile(
        join(configDir, '.credentials.json'),
        JSON.stringify({
          claudeAiOauth: {
            accessToken: foreign ? 'synthetic-foreign-credential' : 'synthetic-recovery-credential'
          }
        })
      ),
    request: async (targetSlot = slot) => {
      const response = await fetch(`${proxy.slotBaseUrl(targetSlot)}v1/messages`, {
        method: 'POST',
        headers: { authorization: 'Bearer synthetic-client-credential' },
        body: '{}'
      })
      await response.text()
      return response.status
    },
    close: async () => {
      await proxy.stop()
      upstream.closeAllConnections()
      await new Promise<void>((resolve) => upstream.close(() => resolve()))
      installClaudeProfileRouter(undefined)
      installClaudeRegisteredAccounts(undefined)
      clearClaudeAuthProxyAccountDirs()
      vi.restoreAllMocks()
      await rm(root, { recursive: true, force: true })
    }
  }
}

export { identityMocks }
