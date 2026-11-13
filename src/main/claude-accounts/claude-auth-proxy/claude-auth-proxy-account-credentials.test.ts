import { once } from 'node:events'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ClaudeProfileRouter } from '../claude-profile-router'
import type * as Keychain from '../keychain'
import { installClaudeProfileRouter } from '../claude-profile-installed-router'
import { createClaudeAuthProxy, type ClaudeAuthProxy } from './claude-auth-proxy'
import {
  bindClaudeAuthProxyAccountDir,
  clearClaudeAuthProxyAccountDirs,
  readClaudeAuthProxyAccessToken
} from './claude-auth-proxy-account-credentials'

vi.mock('../keychain', async (importOriginal) => ({
  ...(await importOriginal<typeof Keychain>()),
  readActiveClaudeKeychainCredentialsStrict: async () => null
}))

const saved = {
  id: 'account-a',
  email: 'first@example.invalid',
  organizationUuid: 'org-first',
  authMethod: 'subscription-oauth' as const,
  managedAuthPath: '/unused',
  createdAt: 0,
  updatedAt: 0,
  lastAuthenticatedAt: 0
}
const originalLogin = { emailAddress: 'first@example.invalid', organizationUuid: 'org-first' }

describe('Claude proxy credential identity', () => {
  let root: string
  let proxy: ClaudeAuthProxy
  let upstream: Server

  afterEach(async () => {
    await proxy?.stop()
    if (upstream) {
      upstream.closeAllConnections()
      await new Promise<void>((resolve) => upstream.close(() => resolve()))
    }
    installClaudeProfileRouter(undefined)
    clearClaudeAuthProxyAccountDirs()
    vi.restoreAllMocks()
    if (root) {
      await rm(root, { recursive: true, force: true })
    }
  })

  async function fixture(route: string) {
    root = await mkdtemp(join(tmpdir(), 'claude-proxy-identity-'))
    const router = new ClaudeProfileRouter({
      dataRoot: join(root, 'data'),
      userHome: join(root, 'user'),
      env: {},
      getSettings: () => ({
        claudeManagedAccounts: [saved],
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
    if (route === 'guest') {
      bindClaudeAuthProxyAccountDir(saved.id, configDir)
    } else {
      installClaudeProfileRouter(router)
    }
    const seen: boolean[] = []
    upstream = createServer((req, res) => {
      seen.push(req.headers.authorization === 'Bearer synthetic-recovery-credential')
      req.resume()
      res.end('{}')
    })
    upstream.listen(0, '127.0.0.1')
    await once(upstream, 'listening')
    const address = upstream.address()
    if (!address || typeof address === 'string') {
      throw new Error('No loopback port')
    }
    let at = 0
    proxy = createClaudeAuthProxy({
      readToken: readClaudeAuthProxyAccessToken,
      now: () => at,
      upstream: `http://127.0.0.1:${address.port}`
    })
    await proxy.start()
    const slot = proxy.allocateSlot(saved.id)
    return {
      configDir,
      stateFile,
      seen,
      advance: () => {
        at += 5_000
      },
      request: async () => {
        const response = await fetch(`${proxy.slotBaseUrl(slot)}v1/messages`)
        await response.text()
        return response.status
      }
    }
  }

  describe.each(['managed', 'system default', 'guest'])('%s source', (route) => {
    it('recovers only after the registered account signs in again', async () => {
      const test = await fixture(route)
      expect(await test.request()).toBe(401)
      await writeFile(
        join(test.configDir, '.credentials.json'),
        JSON.stringify({
          claudeAiOauth: { accessToken: 'synthetic-recovery-credential' }
        })
      )
      test.advance()
      expect(await test.request()).toBe(200)
      expect(await test.request()).toBe(200)
      expect(test.seen).toEqual([true, true])
    })

    it.each(['different email', 'different organization', 'missing', 'unreadable'])(
      'keeps the slot quarantined with %s identity until the original login returns',
      async (replacement) => {
        const info = vi.spyOn(console, 'info').mockImplementation(() => {})
        const test = await fixture(route)
        expect(await test.request()).toBe(401)
        await (replacement === 'missing'
          ? rm(test.stateFile)
          : writeFile(
              test.stateFile,
              replacement === 'unreadable'
                ? '{'
                : JSON.stringify({
                    oauthAccount:
                      replacement === 'different email'
                        ? { ...originalLogin, emailAddress: 'second@example.invalid' }
                        : { ...originalLogin, organizationUuid: 'org-second' }
                  })
            ))
        await writeFile(
          join(test.configDir, '.credentials.json'),
          JSON.stringify({
            claudeAiOauth: { accessToken: 'synthetic-recovery-credential' }
          })
        )
        if (route === 'guest') {
          bindClaudeAuthProxyAccountDir(saved.id, test.configDir)
        }
        test.advance()
        expect(await test.request()).toBe(401)
        test.advance()
        expect(await test.request()).toBe(401)
        expect(test.seen).toEqual([])
        const logged = info.mock.calls.flat().join('\n')
        if (route !== 'system default' && replacement.startsWith('different')) {
          expect(logged).toContain('account changed under slot')
        }
        expect(logged).not.toContain('synthetic-recovery-credential')
        expect(logged).not.toContain('@example.invalid')
        await writeFile(test.stateFile, JSON.stringify({ oauthAccount: originalLogin }))
        expect(await test.request()).toBe(401)
        test.advance()
        expect(await test.request()).toBe(200)
        expect(test.seen).toEqual([true])
      }
    )
  })
})
