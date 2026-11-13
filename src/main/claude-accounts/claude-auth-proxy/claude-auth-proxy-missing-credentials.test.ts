import { createServer, type Server } from 'node:http'
import { once } from 'node:events'
import { afterEach, describe, expect, it } from 'vitest'
import { createClaudeAuthProxy, type ClaudeAuthProxy } from './claude-auth-proxy'

const TOKEN_A = 'token-alpha-do-not-log'
const TOKEN_B = 'token-beta-do-not-log'

describe('Claude auth proxy missing credentials', () => {
  let proxy: ClaudeAuthProxy
  let upstream: Server

  afterEach(async () => {
    await proxy?.stop()
    if (upstream) {
      upstream.closeAllConnections()
      await new Promise<void>((resolve) => upstream.close(() => resolve()))
    }
  })

  async function started(readToken: (accountId: string) => Promise<string | null>) {
    const seen: { authorization: string | undefined }[] = []
    const lines: string[] = []
    upstream = createServer((req, res) => {
      seen.push({ authorization: req.headers.authorization })
      req.resume()
      res.end('{}')
    })
    upstream.listen(0, '127.0.0.1')
    await once(upstream, 'listening')
    const address = upstream.address()
    if (!address || typeof address === 'string') {
      throw new Error('no upstream port')
    }
    proxy = createClaudeAuthProxy({
      readToken,
      upstream: `http://127.0.0.1:${address.port}`,
      log: (line) => {
        lines.push(line)
      }
    })
    await proxy.start()
    return { proxy, seen, lines }
  }

  it.each(['missing', 'empty', 'unreadable'])(
    'quarantines a known slot with %s credentials and never uses client authorization',
    async (credentialState) => {
      const { proxy, seen, lines } = await started(async (accountId) => {
        if (accountId === 'account-b') {
          return TOKEN_B
        }
        if (credentialState === 'unreadable') {
          throw new Error(TOKEN_A)
        }
        return credentialState === 'empty' ? '' : null
      })
      const slot = proxy.allocateSlot('account-a')
      const base = proxy.slotBaseUrl(slot)
      for (const headers of [undefined, { authorization: `Bearer ${TOKEN_A}` }]) {
        const response = await fetch(`${base}v1/messages`, {
          method: 'POST',
          headers,
          body: 'BODY_SENTINEL'
        })
        expect(response.status).toBe(401)
        expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8')
        expect(await response.json()).toMatchObject({
          type: 'error',
          error: { type: 'authentication_error' }
        })
      }
      expect(seen).toEqual([])
      expect(proxy.status().lastError).toMatchObject({ status: 401, accountId: 'account-a' })
      expect(lines.join('\n')).toContain('quarantined')
      expect(lines.join('\n')).not.toContain(TOKEN_A)
      expect(lines.join('\n')).not.toContain('BODY_SENTINEL')
      expect(proxy.assignSlot(slot, 'account-b')).toBe(true)
      expect((await fetch(`${base}v1/messages`)).status).toBe(200)
      expect(seen.map((entry) => entry.authorization)).toEqual([`Bearer ${TOKEN_B}`])
    }
  )

  it('keeps missing credentials quarantined until adoption and forgets quarantine on release', async () => {
    let token: string | null = null
    const { proxy, seen } = await started(async () => token)
    const slot = proxy.allocateSlot('account-a')
    const url = `${proxy.slotBaseUrl(slot)}v1/messages`
    expect((await fetch(url)).status).toBe(401)
    token = TOKEN_A
    expect((await fetch(url)).status).toBe(401)
    expect(seen).toEqual([])
    expect(proxy.adoptSlot(slot, 'account-a')).toBe(true)
    expect((await fetch(url)).status).toBe(200)
    token = null
    proxy.invalidateToken('account-a')
    expect((await fetch(url)).status).toBe(401)
    proxy.releaseSlot(slot)
    proxy.endStartupGrace()
    expect((await fetch(url)).status).toBe(502)
    expect(proxy.accountIdForSlot(slot)).toBeNull()
  })

  it('does not quarantine a new assignment while the old account credential read finishes', async () => {
    let finishRead!: (token: string | null) => void
    let startedRead!: () => void
    const reading = new Promise<void>((resolve) => {
      startedRead = resolve
    })
    const oldToken = new Promise<string | null>((resolve) => {
      finishRead = resolve
    })
    const { proxy, seen } = await started(async (accountId) => {
      if (accountId === 'account-b') {
        return TOKEN_B
      }
      startedRead()
      return oldToken
    })
    const slot = proxy.allocateSlot('account-a')
    const url = `${proxy.slotBaseUrl(slot)}v1/messages`
    const oldRequest = fetch(url)
    await reading
    expect(proxy.assignSlot(slot, 'account-b')).toBe(true)
    finishRead(null)
    expect((await oldRequest).status).toBe(401)
    expect((await fetch(url)).status).toBe(200)
    expect(seen.map((entry) => entry.authorization)).toEqual([`Bearer ${TOKEN_B}`])
  })
})
