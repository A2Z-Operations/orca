import {
  identityFixture,
  identityMocks,
  originalLogin,
  saved
} from './claude-auth-proxy-identity-test-fixtures'
import { stat, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  bindClaudeAuthProxyAccountDir,
  clearClaudeAuthProxyAccountDirs
} from './claude-auth-proxy-account-credentials'

let test: Awaited<ReturnType<typeof identityFixture>>
afterEach(async () => {
  await test?.close()
})

describe('Claude proxy admission regressions', () => {
  it('refuses a foreign login already present at the first guest bind', async () => {
    test = await identityFixture('guest')
    clearClaudeAuthProxyAccountDirs()
    await writeFile(
      test.stateFile,
      JSON.stringify({
        oauthAccount: { emailAddress: 'second@example.invalid', organizationUuid: 'org-second' }
      })
    )
    await test.writeToken(true)
    bindClaudeAuthProxyAccountDir(saved.id, test.configDir)
    expect(await test.request()).toBe(401)
    expect(test.seen).toEqual([])
  })

  it('rechecks an unknown registration after the quarantine deadline without adopting the folder', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    test = await identityFixture('guest')
    test.setAccounts([])
    await test.writeToken()
    expect(await test.request()).toBe(401)
    expect(info.mock.calls.flat().join('\n')).toContain('identity unknown')
    test.advance()
    expect(await test.request()).toBe(401)
    test.setAccounts([{ ...saved }])
    expect(await test.request()).toBe(401)
    test.advance()
    expect(await test.request()).toBe(200)
    expect(test.seen).toEqual([true])
  })

  it.each([null, '', undefined])('refuses saved organization %s', async (organizationUuid) => {
    test = await identityFixture('managed')
    test.setAccounts([{ ...saved, organizationUuid }])
    await test.writeToken()
    expect(await test.request()).toBe(401)
    expect(test.seen).toEqual([])
  })

  it('refuses a swapped credential while the login file still matches', async () => {
    test = await identityFixture('managed')
    await test.writeToken(true)
    expect(await test.request()).toBe(401)
    expect(test.seen).toEqual([])
  })

  it.each(['foreign bearer', 'foreign login', 'unpublished bearer'])(
    'refuses refresh replay with %s',
    async (replacement) => {
      test = await identityFixture('managed')
      await test.writeToken()
      test.setUpstreamStatus(401)
      identityMocks.refresh.mockImplementation(async () => {
        if (replacement !== 'unpublished bearer') {
          await test.writeToken(true)
        }
        if (replacement === 'foreign login') {
          await writeFile(
            test.stateFile,
            JSON.stringify({
              oauthAccount: { ...originalLogin, emailAddress: 'second@example.invalid' }
            })
          )
        }
        return { outcome: 'refreshed', accessToken: 'synthetic-foreign-credential' }
      })
      expect(await test.request()).toBe(401)
      expect(test.seen).toEqual([true])
    }
  )

  it('keeps the verified bearer inside the cache and refuses a changed folder after expiry', async () => {
    test = await identityFixture('managed')
    await test.writeToken()
    expect(await test.request()).toBe(200)
    await test.writeToken(true)
    await writeFile(
      test.stateFile,
      JSON.stringify({ oauthAccount: { ...originalLogin, organizationUuid: 'org-other' } })
    )
    expect(await test.request()).toBe(200)
    test.advance(20_000)
    expect(await test.request()).toBe(401)
    expect(test.seen).toEqual([true, true])
  })

  it('limits concurrent quarantined retries and never prints credentials', async () => {
    const logs = (['info', 'warn', 'error'] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation(() => {})
    )
    test = await identityFixture('managed')
    expect(await test.request()).toBe(401)
    await test.writeToken(true)
    test.advance()
    const statuses = await Promise.all(Array.from({ length: 25 }, () => test.request()))
    expect(statuses.every((status) => status === 401)).toBe(true)
    expect(test.seen).toEqual([])
    const logged = logs.flatMap((log) => log.mock.calls.flat()).join('\n')
    expect(logged.match(/account changed under slot/g)).toHaveLength(1)
    expect(/synthetic-|example.invalid|authorization/i.test(logged)).toBe(false)
  })

  it('keeps a removed id refused when the account is registered under a new id', async () => {
    test = await identityFixture('guest')
    await test.writeToken()
    test.setAccounts([{ ...saved, id: 'account-new' }])
    expect(await test.request()).toBe(401)
    bindClaudeAuthProxyAccountDir('account-new', test.configDir)
    const slot = test.proxy.allocateSlot('account-new')
    expect(await test.request(slot)).toBe(200)
    test.advance()
    expect(await test.request()).toBe(401)
    expect(test.seen).toEqual([true])
  })

  it('detects same-size and same-mtime login replacement', async () => {
    test = await identityFixture('managed')
    await test.writeToken()
    expect(await test.request()).toBe(200)
    const before = await stat(test.stateFile)
    await writeFile(
      test.stateFile,
      JSON.stringify({ oauthAccount: { ...originalLogin, organizationUuid: 'org-other' } })
    )
    await utimes(test.stateFile, before.atime, before.mtime)
    test.advance(20_000)
    expect(await test.request()).toBe(401)
    expect(test.seen).toEqual([true])
  })

  it('uses a nonempty legacy login but refuses a bearer owned by the current-file login', async () => {
    test = await identityFixture('managed')
    await writeFile(
      join(test.configDir, '.config.json'),
      JSON.stringify({ oauthAccount: originalLogin })
    )
    await writeFile(
      test.stateFile,
      JSON.stringify({
        oauthAccount: { emailAddress: 'second@example.invalid', organizationUuid: 'org-second' }
      })
    )
    await test.writeToken(true)
    expect(await test.request()).toBe(401)
    expect(test.seen).toEqual([])
  })

  it('reads the current login beside an empty legacy file as Claude Code 2.1.323 does', async () => {
    test = await identityFixture('managed')
    await writeFile(join(test.configDir, '.config.json'), '')
    await test.writeToken()
    expect(await test.request()).toBe(200)
    expect(test.seen).toEqual([true])
  })

  it.skipIf(process.platform !== 'darwin')(
    'refuses disagreeing keychain and credential-file bearers',
    async () => {
      test = await identityFixture('managed')
      await test.writeToken(true)
      identityMocks.keychain.mockResolvedValue(
        JSON.stringify({ claudeAiOauth: { accessToken: 'synthetic-recovery-credential' } })
      )
      expect(await test.request()).toBe(401)
      expect(test.seen).toEqual([])
    }
  )
})
