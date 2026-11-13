import {
  Agent as HttpAgent,
  createServer,
  type IncomingMessage,
  type ServerResponse
} from 'node:http'
import { Agent as HttpsAgent } from 'node:https'
import {
  bindHostIsNetworkExposed,
  ORCAD_LOOPBACK_BIND_HOST
} from '../../../shared/orcad-bind-address'
import type { ClaudeAuthProxy, ClaudeAuthProxyOptions } from './claude-auth-proxy-types'
export type { ClaudeAuthProxy, ClaudeAuthProxyOptions } from './claude-auth-proxy-types'
import { forwardRequestHeaders, forwardResponseHeaders } from './claude-auth-proxy-headers'
import {
  claudeProxyShouldRewriteModel,
  readIncomingMessageBody,
  rewriteClaudeProxyBody
} from './claude-auth-proxy-model-body'
import { createClaudeAuthProxyRequestLog } from './claude-auth-proxy-request-log'
import { createClaudeAuthProxyTokenCache } from './claude-auth-proxy-token-cache'
import {
  allocateClaudeAuthProxySlot,
  CLAUDE_AUTH_PROXY_SLOT_ID,
  listenClaudeAuthProxy
} from './claude-auth-proxy-listen'
import {
  createClaudeAuthProxyStartupGrace,
  refuseClaudeAuthProxyUnknownSlot,
  refuseClaudeAuthProxyWithoutSlot,
  refuseClaudeAuthProxyMissingCredentials
} from './claude-auth-proxy-unknown-slot'
import { CLAUDE_MODEL_REWRITE_BUFFER_CAP } from '../claude-model-body-rewrite'
import {
  finishBufferedClaudeAuthProxy,
  headerContentLength,
  pipeClaudeAuthProxy,
  readBoundedProxyBody,
  streamOverflowClaudeAuthProxy,
  type ClaudeAuthProxyExchange
} from './claude-auth-proxy-replay'

const UPSTREAM_ORIGIN = 'https://api.anthropic.com'
const SLOT_PATH = /^\/p\/([^/]+)(\/.*)?$/
/**
 * Claude Code's own request budget is 10 minutes of inactivity. Node's default
 * requestTimeout is 5 minutes and would cut a live stream first, so it is disabled
 * on this loopback listener and the socket idle timer carries the 10 minute budget.
 */
export const CLAUDE_AUTH_PROXY_IDLE_TIMEOUT_MS = 10 * 60 * 1000
/**
 * A macOS `security` lookup measured ~317 ms median on 2026-10-29, past the 5 ms
 * re-read budget. A hit serves the last token; a snapshot change drops it sooner.
 */
export const CLAUDE_AUTH_PROXY_TOKEN_TTL_MS = 20_000

export function createClaudeAuthProxy(options: ClaudeAuthProxyOptions): ClaudeAuthProxy {
  const bindHost = options.bindHost ?? ORCAD_LOOPBACK_BIND_HOST
  if (bindHostIsNetworkExposed(bindHost)) {
    throw new Error('claude auth proxy only binds to loopback')
  }
  const slots = new Map<string, string>()
  const quarantinedSlots = new Set<string>()
  const upstream = options.upstream ?? UPSTREAM_ORIGIN
  const log = options.log ?? (() => {})
  const now = options.now ?? Date.now
  const tokens = createClaudeAuthProxyTokenCache({
    ttlMs: options.tokenTtlMs ?? CLAUDE_AUTH_PROXY_TOKEN_TTL_MS,
    now,
    readToken: options.readToken
  })
  const requests = createClaudeAuthProxyRequestLog(now, log, options.onRequest)
  const idleTimeoutMs = options.idleTimeoutMs ?? CLAUDE_AUTH_PROXY_IDLE_TIMEOUT_MS
  const httpAgent = new HttpAgent({ keepAlive: true })
  const httpsAgent = new HttpsAgent({ keepAlive: true })
  const server = createServer((req, res) => {
    void handle(req, res).catch(() => {
      if (!res.headersSent) {
        res.writeHead(502)
      }
      res.end()
    })
  })
  // The 5-minute default aborts the whole request, including a long SSE body.
  server.requestTimeout = 0
  server.timeout = idleTimeoutMs
  server.headersTimeout = 60_000
  const startupGrace = createClaudeAuthProxyStartupGrace(now, options.startupGraceMs)
  let listening: Promise<void> | null = null
  let stopping: Promise<void> | null = null
  let closing = false

  function port(): number | null {
    const address = server.address()
    return address && typeof address === 'object' ? address.port : null
  }

  function start(): Promise<void> {
    if (server.listening) {
      return Promise.resolve()
    }
    if (listening) {
      return listening
    }
    listening = listenClaudeAuthProxy(server, bindHost, options.preferredPort).then(() => {
      startupGrace.begin()
    })
    return listening
  }

  function stop(): Promise<void> {
    if (stopping) {
      return stopping
    }
    closing = true
    const finish = (): void => {
      tokens.invalidate()
      slots.clear()
      quarantinedSlots.clear()
      httpAgent.destroy()
      httpsAgent.destroy()
    }
    if (!server.listening) {
      stopping = Promise.resolve().then(finish)
      return stopping
    }
    // Drop keep-alives that have no request. Active responses stay until they end.
    server.closeIdleConnections()
    stopping = new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error)
          return
        }
        resolve()
      })
    }).then(finish, (error: unknown) => {
      finish()
      throw error
    })
    return stopping
  }

  function releaseIdleAfterClose(res: ServerResponse): void {
    res.on('close', () => {
      if (!closing) {
        return
      }
      setImmediate(() => {
        if (closing) {
          server.closeIdleConnections()
        }
      })
    })
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const requestUrl = new URL(req.url ?? '/', 'http://127.0.0.1')
    const method = req.method ?? 'GET'
    const match = requestUrl.pathname.match(SLOT_PATH)
    const slot = match?.[1]
    const rest = match?.[2]
    if (!slot) {
      // No `/p/<slot>/`: nothing this host launched. Never forwarded (it would go up bearer-less).
      const status = refuseClaudeAuthProxyWithoutSlot(req, res)
      requests.observeNoSlot(method, requestUrl.pathname, status)
      return
    }
    const upstreamPath = rest && rest !== '/' ? rest : '/'
    const accountId = slots.get(slot) ?? null
    if (accountId === null) {
      // Never forwarded: a bearer-less request would come back 401 and log the pane out.
      const grace = startupGrace.active()
      const status = refuseClaudeAuthProxyUnknownSlot(req, res, grace)
      requests.observeUnknownSlot(method, upstreamPath, status, grace)
      return
    }
    // Read before opening upstream so a slot flip during this body cannot change it.
    const token = quarantinedSlots.has(slot) ? null : await tokens.tokenFor(accountId)
    if (!token) {
      // Retain the account for repeat refusals; assignment or adoption clears quarantine.
      if (slots.get(slot) === accountId && !quarantinedSlots.has(slot)) {
        quarantinedSlots.add(slot)
        log(`quarantined slot for account ${accountId}: credentials unavailable`)
      }
      const status = refuseClaudeAuthProxyMissingCredentials(req, res, accountId)
      requests.observe(method, upstreamPath, status, accountId)
      return
    }
    const headers = forwardRequestHeaders(req.headers)
    headers.authorization = `Bearer ${token}`
    const contentTypeHeader = req.headers['content-type']
    const contentType = Array.isArray(contentTypeHeader) ? contentTypeHeader[0] : contentTypeHeader
    const slotModel = options.modelForSlot?.(slot) ?? null
    // Snapshot the model before the body, same as the token: a flip mid-body stays on the next request.
    const rewrite = claudeProxyShouldRewriteModel(method, contentType, slotModel)
    const cap = options.modelRewriteBufferCap ?? CLAUDE_MODEL_REWRITE_BUFFER_CAP
    const declaredLength = headerContentLength(req.headers['content-length'])
    const refresh = options.refreshAccessToken
    const target = new URL(`${upstreamPath}${requestUrl.search}`, upstream)
    releaseIdleAfterClose(res)
    const exchange: ClaudeAuthProxyExchange = {
      req,
      res,
      method,
      upstreamPath,
      accountId,
      headers,
      target,
      httpAgent,
      httpsAgent,
      idleTimeoutMs,
      observe: (status) => requests.observe(method, upstreamPath, status, accountId),
      invalidate: (id) => tokens.invalidate(id),
      ...(refresh ? { refresh } : {}),
      deliver: deliverUpstream
    }

    if (rewrite) {
      const raw = await readIncomingMessageBody(req)
      const rewritten = slotModel ? rewriteClaudeProxyBody(raw, slotModel.model, cap) : null
      const payload = rewritten?.body ?? raw
      if (rewritten) {
        headers['content-length'] = String(payload.length)
      }
      await finishBufferedClaudeAuthProxy(exchange, payload, payload.length <= cap, token)
      return
    }

    if (refresh && (declaredLength === null || declaredLength <= cap)) {
      const read = await readBoundedProxyBody(req, cap)
      if (read.kind === 'overflow') {
        await streamOverflowClaudeAuthProxy(exchange, read.prefix, read.restChunk)
        return
      }
      headers['content-length'] = String(read.body.length)
      await finishBufferedClaudeAuthProxy(exchange, read.body, true, token)
      return
    }

    pipeClaudeAuthProxy(exchange, token, true)

    function deliverUpstream(status: number, upstreamRes: IncomingMessage): void {
      requests.observe(method, upstreamPath, status, accountId)
      if (res.headersSent || res.writableEnded) {
        upstreamRes.resume()
        return
      }
      res.writeHead(status, forwardResponseHeaders(upstreamRes.headers))
      upstreamRes.on('error', () => {
        if (!res.writableEnded) {
          res.destroy()
        }
      })
      // pipe pauses upstream when the client stops reading.
      upstreamRes.pipe(res)
    }
  }

  return {
    start,
    stop,
    port,
    allocateSlot(accountId) {
      return allocateClaudeAuthProxySlot(slots, accountId)
    },
    assignSlot(slot, accountId) {
      if (!slots.has(slot)) {
        return false
      }
      slots.set(slot, accountId)
      quarantinedSlots.delete(slot)
      return true
    },
    adoptSlot(slot, accountId) {
      if (!CLAUDE_AUTH_PROXY_SLOT_ID.test(slot)) {
        return false
      }
      slots.set(slot, accountId)
      quarantinedSlots.delete(slot)
      return true
    },
    accountIdForSlot(slot) {
      return slots.get(slot) ?? null
    },
    slotBaseUrl(slot) {
      const current = port()
      if (current === null || !slots.has(slot)) {
        return null
      }
      return `http://${bindHost}:${current}/p/${slot}/`
    },
    releaseSlot(slot) {
      slots.delete(slot)
      quarantinedSlots.delete(slot)
    },
    invalidateToken(accountId) {
      tokens.invalidate(accountId)
    },
    endStartupGrace() {
      startupGrace.end()
    },
    status() {
      return {
        listening: server.listening,
        host: bindHost,
        port: port(),
        slots: [...slots.entries()].map(([slot, accountId]) => ({ slot, accountId })),
        ...requests.snapshot()
      }
    }
  }
}
