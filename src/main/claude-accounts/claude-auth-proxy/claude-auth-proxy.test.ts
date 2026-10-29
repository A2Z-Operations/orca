import { createServer, request as httpRequest, type IncomingMessage, type Server } from 'node:http'
import { once } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createClaudeAuthProxy, type ClaudeAuthProxy } from './claude-auth-proxy'

const TOKEN_A = 'token-alpha-do-not-log'
const TOKEN_B = 'token-beta-do-not-log'

async function listen(server: Server): Promise<number> {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('upstream did not bind')
  }
  return address.port
}

function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  return new Promise((resolve, reject) => {
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function proxyRequest(
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string } = {}
): Promise<{ status: number; chunks: string[] }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(url, { method: init.method ?? 'GET', headers: init.headers }, (res) => {
      const chunks: string[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk.toString('utf8')))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, chunks }))
      res.on('error', reject)
    })
    req.on('error', reject)
    if (init.body !== undefined) {
      req.end(init.body)
    } else {
      req.end()
    }
  })
}

describe('claude auth proxy', () => {
  const proxies: ClaudeAuthProxy[] = []
  const upstreams: Server[] = []

  afterEach(async () => {
    await Promise.all(proxies.splice(0).map((proxy) => proxy.stop()))
    await Promise.all(
      upstreams.splice(0).map(
        (server) =>
          new Promise<void>((resolve) => {
            server.closeAllConnections()
            server.close(() => resolve())
          })
      )
    )
  })

  async function started(
    readToken: (accountId: string) => Promise<string | null>,
    log?: (line: string) => void
  ) {
    const seen: { method?: string; url?: string; authorization?: string; body: string }[] = []
    let release = (): void => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const upstream = createServer(async (req, res) => {
      const body = await readBody(req)
      seen.push({
        method: req.method,
        url: req.url,
        authorization: req.headers.authorization,
        body
      })
      if (req.headers['x-stream'] === '1') {
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        res.write('data: one\n\n')
        await gate
        res.end('data: two\n\n')
        return
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{"ok":true}')
    })
    upstreams.push(upstream)
    const port = await listen(upstream)
    const lines: string[] = []
    const proxy = createClaudeAuthProxy({
      readToken,
      upstream: `http://127.0.0.1:${port}`,
      log: (line) => {
        lines.push(line)
        log?.(line)
      }
    })
    proxies.push(proxy)
    await proxy.start()
    return { proxy, seen, lines, release }
  }

  it('replaces Authorization, forwards the request, and does not log the token', async () => {
    const readToken = vi.fn(async () => TOKEN_A)
    const { proxy, seen, lines } = await started(readToken)
    const slot = proxy.allocateSlot('account-a')
    const base = proxy.slotBaseUrl(slot)
    expect(base).toMatch(/\/p\/[0-9a-f]+\/$/)

    const response = await proxyRequest(`${base}v1/messages?beta=true`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer from-claude',
        'content-type': 'application/json',
        host: '127.0.0.1'
      },
      body: '{"hi":1}'
    })

    expect(response.status).toBe(200)
    expect(response.chunks.join('')).toBe('{"ok":true}')
    expect(seen).toEqual([
      {
        method: 'POST',
        url: '/v1/messages?beta=true',
        authorization: `Bearer ${TOKEN_A}`,
        body: '{"hi":1}'
      }
    ])
    expect(seen[0]?.authorization).not.toContain('from-claude')
    expect(readToken).toHaveBeenCalledTimes(1)
    expect(readToken).toHaveBeenCalledWith('account-a')
    expect(lines).toEqual(['POST /v1/messages 200 account-a'])
    expect(lines.join('\n')).not.toContain(TOKEN_A)
    expect(lines.join('\n')).not.toContain('beta=true')
  })

  it('streams an SSE response before the upstream finishes', async () => {
    const { proxy, release } = await started(async () => TOKEN_A)
    const slot = proxy.allocateSlot('account-a')
    const url = `${proxy.slotBaseUrl(slot)}v1/messages`
    const first = new Promise<string>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('SSE chunk was buffered until the upstream ended')),
        1500
      )
      const req = httpRequest(url, { method: 'POST', headers: { 'x-stream': '1' } }, (res) => {
        res.once('data', (chunk: Buffer) => {
          clearTimeout(timer)
          resolve(chunk.toString('utf8'))
        })
        res.on('error', reject)
      })
      req.on('error', (error) => {
        clearTimeout(timer)
        reject(error)
      })
      req.end('{}')
    })
    await expect(first).resolves.toBe('data: one\n\n')
    release()
  })

  it('keeps the incoming Authorization for an unknown slot and does not read a token', async () => {
    const readToken = vi.fn(async () => TOKEN_A)
    const { proxy, seen } = await started(readToken)
    const base = proxy.slotBaseUrl(proxy.allocateSlot('account-a'))
    const port = new URL(base!).port
    const response = await proxyRequest(`http://127.0.0.1:${port}/p/missing/v1/messages`, {
      headers: { authorization: 'Bearer from-claude' }
    })
    expect(response.status).toBe(200)
    expect(seen[0]?.authorization).toBe('Bearer from-claude')
    expect(readToken).not.toHaveBeenCalled()
  })

  it('keeps the incoming Authorization when the account has no token', async () => {
    const { proxy, seen } = await started(async () => null)
    const base = proxy.slotBaseUrl(proxy.allocateSlot('account-a'))
    await proxyRequest(`${base}v1/messages`, { headers: { authorization: 'Bearer from-claude' } })
    expect(seen[0]?.authorization).toBe('Bearer from-claude')
  })

  it('re-reads the token on the next request and follows a slot flip', async () => {
    const tokens = [TOKEN_A, TOKEN_B]
    const readToken = vi.fn(async () => tokens.shift() ?? null)
    const { proxy, seen } = await started(readToken)
    const slot = proxy.allocateSlot('account-a')
    const base = proxy.slotBaseUrl(slot)
    await proxyRequest(`${base}v1/messages`)
    expect(proxy.assignSlot(slot, 'account-b')).toBe(true)
    expect(proxy.assignSlot('missing', 'account-b')).toBe(false)
    await proxyRequest(`${base}v1/messages`)
    expect(readToken).toHaveBeenCalledTimes(2)
    expect(seen.map((entry) => entry.authorization)).toEqual([
      `Bearer ${TOKEN_A}`,
      `Bearer ${TOKEN_B}`
    ])
    expect(proxy.accountIdForSlot(slot)).toBe('account-b')
  })
})
