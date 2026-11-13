import { identityFixture, originalLogin, saved } from './claude-auth-proxy-identity-test-fixtures'
import { rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindClaudeAuthProxyAccountDir } from './claude-auth-proxy-account-credentials'

let current: Awaited<ReturnType<typeof identityFixture>>
async function fixture(route: string) {
  current = await identityFixture(route)
  return current
}
afterEach(async () => {
  await current?.close()
})

describe('Claude proxy credential identity', () => {
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

    it.each([
      'different email',
      'different organization',
      'missing organization',
      'missing email',
      'missing',
      'unreadable'
    ])(
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
                        : replacement === 'missing organization'
                          ? { emailAddress: originalLogin.emailAddress }
                          : replacement === 'missing email'
                            ? { organizationUuid: originalLogin.organizationUuid }
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
