import { join } from 'node:path'
import {
  identityFixture,
  identityMocks,
  originalLogin,
  saved
} from './claude-auth-proxy-identity-test-fixtures'
import { rm, writeFile } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import {
  bindClaudeAuthProxyAccountDir,
  clearClaudeAuthProxyAccountDirs
} from './claude-auth-proxy-account-credentials'

let test: Awaited<ReturnType<typeof identityFixture>>
afterEach(async () => {
  await test?.close()
})

describe('Claude bearer verification', () => {
  it.each([
    'missing organization',
    'different organization',
    'different account',
    'unavailable',
    'malformed',
    'redirect',
    'throws'
  ])('refuses a profile that is %s', async (fault) => {
    test = await identityFixture('managed')
    await test.writeToken()
    identityMocks.profile.mockImplementation(async () => {
      if (fault === 'throws') {
        throw new Error('synthetic-secret-in-error')
      }
      if (fault === 'unavailable') {
        return new Response(null, { status: 503 })
      }
      if (fault === 'redirect') {
        return new Response(null, { status: 302 })
      }
      if (fault === 'malformed') {
        return new Response('{')
      }
      return Response.json({
        account: {
          email: fault === 'different account' ? 'second@example.invalid' : 'first@example.invalid'
        },
        organization:
          fault === 'missing organization'
            ? {}
            : { uuid: fault === 'different organization' ? 'org-second' : 'org-first' }
      })
    })
    expect(await test.request()).toBe(401)
    expect(test.seen).toEqual([])
  })

  it('recovers after a guest binds before any login exists', async () => {
    test = await identityFixture('guest')
    clearClaudeAuthProxyAccountDirs()
    await rm(test.stateFile)
    bindClaudeAuthProxyAccountDir(saved.id, test.configDir)
    expect(await test.request()).toBe(401)
    await writeFile(test.stateFile, JSON.stringify({ oauthAccount: originalLogin }))
    await test.writeToken()
    bindClaudeAuthProxyAccountDir(saved.id, test.configDir)
    test.advance()
    expect(await test.request()).toBe(200)
    expect(test.seen).toEqual([true])
  })

  it('replays a verified same-account refresh', async () => {
    test = await identityFixture('managed')
    await test.writeToken()
    test.setUpstreamStatus(401)
    identityMocks.refresh.mockImplementation(async () => {
      await writeFile(
        join(test.configDir, '.credentials.json'),
        JSON.stringify({ claudeAiOauth: { accessToken: 'synthetic-renewed-credential' } })
      )
      test.setUpstreamStatus(200)
      return { outcome: 'refreshed', accessToken: 'synthetic-renewed-credential' }
    })
    expect(await test.request()).toBe(200)
    expect(test.seen).toEqual([true, true])
  })

  it('refuses an account removed while bearer verification is pending', async () => {
    test = await identityFixture('managed')
    await test.writeToken()
    identityMocks.profile.mockImplementation(async () => {
      test.setAccounts([])
      return Response.json({
        account: { email: 'first@example.invalid' },
        organization: { uuid: 'org-first' }
      })
    })
    expect(await test.request()).toBe(401)
    expect(test.seen).toEqual([])
  })
})
