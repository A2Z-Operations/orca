import { createServer, request as httpRequest, type IncomingMessage, type Server } from 'node:http'
import { once } from 'node:events'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createClaudeAuthProxy,
  type ClaudeAuthProxy,
  type ClaudeAuthProxyOptions
} from './claude-auth-proxy'
import { claudeProxyShouldRewriteModel } from './claude-auth-proxy-model-body'
import { CLAUDE_FABLE_MODEL_ID, CLAUDE_OPUS_MODEL_ID } from '../claude-model-policy'

const TOKEN = 'token-alpha-do-not-log'

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
  init: { method?: string; headers?: Record<string, string>; body?: string }
): Promise<{ status: number; chunks: string[]; headers: IncomingMessage['headers'] }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      url,
      { method: init.method ?? 'POST', headers: init.headers },
      (res) => {
        const chunks: string[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk.toString('utf8')))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, chunks, headers: res.headers }))
        res.on('error', reject)
      }
    )
    req.on('error', reject)
    req.end(init.body)
  })
}

describe('claude auth proxy model rewrite', () => {
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
    options: Pick<ClaudeAuthProxyOptions, 'modelForSlot' | 'modelRewriteBufferCap'> = {}
  ) {
    const seen: {
      method?: string
      body: string
      contentLength?: string
      beta?: string
    }[] = []
    let release = (): void => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const upstream = createServer(async (req, res) => {
      const body = await readBody(req)
      const length = req.headers['content-length']
      const beta = req.headers['anthropic-beta']
      seen.push({
        method: req.method,
        body,
        contentLength: typeof length === 'string' ? length : undefined,
        beta: typeof beta === 'string' ? beta : undefined
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
    const proxy = createClaudeAuthProxy({
      ...options,
      readToken: async () => TOKEN,
      upstream: `http://127.0.0.1:${port}`
    })
    proxies.push(proxy)
    await proxy.start()
    const slot = proxy.allocateSlot('account-a')
    return { proxy, seen, release, url: `${proxy.slotBaseUrl(slot)}v1/messages` }
  }

  function jsonHeaders(body: string, extra: Record<string, string> = {}): Record<string, string> {
    return {
      'content-type': 'application/json',
      'content-length': String(Buffer.byteLength(body)),
      'anthropic-beta': 'interleaved-thinking-2025-05-14',
      ...extra
    }
  }

  it('buffers a JSON body, rewrites the model, fixes Content-Length, and pipes the SSE response', async () => {
    const { seen, release, url } = await started({
      modelForSlot: () => ({ model: 'opus', modelSource: 'policy' })
    })
    const source = JSON.stringify({
      model: CLAUDE_FABLE_MODEL_ID,
      thinking: { type: 'enabled', budget_tokens: 1024 },
      tool_choice: { type: 'any' },
      output_config: { effort: 'high' },
      messages: [{ model: CLAUDE_FABLE_MODEL_ID, content: 'hi' }]
    })
    let first = ''
    const response = new Promise<{ status: number; text: string; contentType: string | undefined }>(
      (resolve, reject) => {
        const req = httpRequest(
          url,
          {
            method: 'POST',
            headers: { ...jsonHeaders(source), 'x-stream': '1' }
          },
          (res) => {
            const chunks: Buffer[] = []
            res.on('data', (chunk: Buffer) => {
              chunks.push(chunk)
              if (!first) {
                first = chunk.toString('utf8')
                release()
              }
            })
            res.on('end', () =>
              resolve({
                status: res.statusCode ?? 0,
                text: Buffer.concat(chunks).toString('utf8'),
                contentType:
                  typeof res.headers['content-type'] === 'string'
                    ? res.headers['content-type']
                    : undefined
              })
            )
            res.on('error', reject)
          }
        )
        req.on('error', reject)
        req.end(source)
      }
    )
    const result = await response
    expect(first).toBe('data: one\n\n')
    expect(result.status).toBe(200)
    expect(result.contentType).toBe('text/event-stream')
    expect(result.text).toBe('data: one\n\ndata: two\n\n')
    expect(JSON.parse(seen[0]?.body ?? '{}')).toMatchObject({
      model: CLAUDE_OPUS_MODEL_ID,
      thinking: { type: 'adaptive' },
      tool_choice: { type: 'auto' },
      output_config: { effort: 'high' },
      messages: [{ model: CLAUDE_FABLE_MODEL_ID, content: 'hi' }]
    })
    expect(seen[0]?.contentLength).toBe(String(Buffer.byteLength(seen[0]?.body ?? '')))
    expect(seen[0]?.beta).toBe('interleaved-thinking-2025-05-14')
  })

  it('streams a model swap above the cap and leaves thinking alone', async () => {
    const source = JSON.stringify({
      model: CLAUDE_FABLE_MODEL_ID,
      thinking: { type: 'enabled', budget_tokens: 1024 },
      messages: [{ model: CLAUDE_FABLE_MODEL_ID }]
    })
    const { seen, url } = await started({
      modelForSlot: () => ({ model: CLAUDE_OPUS_MODEL_ID, modelSource: 'policy' }),
      modelRewriteBufferCap: 8
    })
    const response = await proxyRequest(url, { headers: jsonHeaders(source), body: source })
    expect(response.status).toBe(200)
    expect(response.chunks).toEqual(['{"ok":true}'])
    const text = seen[0]?.body ?? ''
    expect(text).toContain(`"model":"${CLAUDE_OPUS_MODEL_ID}"`)
    expect(text).toContain(`"model":"${CLAUDE_FABLE_MODEL_ID}"`)
    expect(text).toContain('"type":"enabled"')
    expect(text).toContain('"budget_tokens":1024')
    expect(seen[0]?.contentLength).toBe(String(Buffer.byteLength(text)))
    expect(Buffer.byteLength(text) - Buffer.byteLength(source)).toBe(
      CLAUDE_OPUS_MODEL_ID.length - CLAUDE_FABLE_MODEL_ID.length
    )
  })

  it('passes a non-JSON body, a GET, a pin, and a non-policy model through unchanged', async () => {
    const policy = { model: 'opus', modelSource: 'policy' as const }
    expect(claudeProxyShouldRewriteModel('GET', 'application/json', policy)).toBe(false)
    expect(claudeProxyShouldRewriteModel('HEAD', 'application/json', policy)).toBe(false)
    expect(claudeProxyShouldRewriteModel('POST', 'text/plain', policy)).toBe(false)
    expect(
      claudeProxyShouldRewriteModel('POST', 'application/json', {
        model: 'opus',
        modelSource: 'pinned'
      })
    ).toBe(false)

    const plain = 'not-json'
    const pinned = await started({
      modelForSlot: () => ({ model: 'opus', modelSource: 'pinned' })
    })
    const fable = JSON.stringify({ model: CLAUDE_FABLE_MODEL_ID })
    await proxyRequest(pinned.url, { headers: jsonHeaders(fable), body: fable })
    expect(pinned.seen[0]?.body).toBe(fable)
    await proxyRequest(pinned.url, {
      headers: { 'content-type': 'text/plain', 'content-length': String(plain.length) },
      body: plain
    })
    expect(pinned.seen[1]).toMatchObject({ method: 'POST', body: plain })

    const get = await started({
      modelForSlot: () => ({ model: 'opus', modelSource: 'policy' })
    })
    const got = await proxyRequest(get.url, {
      method: 'GET',
      headers: { 'content-type': 'application/json' }
    })
    expect(got.status).toBe(200)
    expect(get.seen[0]).toMatchObject({ method: 'GET', body: '' })

    const sonnetBody = JSON.stringify({ model: 'claude-sonnet-4-6', messages: [] })
    const sonnet = await started({
      modelForSlot: () => ({ model: 'opus', modelSource: 'policy' })
    })
    await proxyRequest(sonnet.url, { headers: jsonHeaders(sonnetBody), body: sonnetBody })
    expect(sonnet.seen[0]?.body).toBe(sonnetBody)
    expect(sonnet.seen[0]?.contentLength).toBe(String(Buffer.byteLength(sonnetBody)))
  })
})
