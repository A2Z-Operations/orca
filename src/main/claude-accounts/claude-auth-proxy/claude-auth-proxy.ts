import { randomBytes } from 'node:crypto'
import {
  Agent as HttpAgent,
  createServer,
  type IncomingMessage,
  type ServerResponse
} from 'node:http'
import { Agent as HttpsAgent } from 'node:https'
import { bindHostIsNetworkExposed, ORCAD_LOOPBACK_BIND_HOST } from '../../orcad/orcad-bind-address'
import type { ClaudeAuthProxyStatus } from '../../../shared/claude-auth-proxy-status'
import { forwardRequestHeaders, forwardResponseHeaders } from './claude-auth-proxy-headers'
import {
  claudeProxyShouldRewriteModel,
  readIncomingMessageBody,
  rewriteClaudeProxyBody,
  type ClaudeProxySlotModel
} from './claude-auth-proxy-model-body'
import { createClaudeAuthProxyRequestLog } from './claude-auth-proxy-request-log'
import { createClaudeAuthProxyTokenCache } from './claude-auth-proxy-token-cache'
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
/** 16 bytes: a slot id is an unguessable capability, not a sequential id. */
const SLOT_ID_BYTES = 16
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

export type ClaudeAuthProxy = {
  start: () => Promise<void>
  /** Stops accepting. In-flight responses finish; idle keep-alives close. */
  stop: () => Promise<void>
  port: () => number | null
  allocateSlot: (accountId: string) => string
  assignSlot: (slot: string, accountId: string) => boolean
  accountIdForSlot: (slot: string) => string | null
  /** Trailing slash so Claude's `/v1/...` join keeps the `/p/<slot>/` prefix. */
  slotBaseUrl: (slot: string) => string | null
  releaseSlot: (slot: string) => void
  /** Drops one account, or every account when `accountId` is omitted. */
  invalidateToken: (accountId?: string) => void
  status: () => ClaudeAuthProxyStatus
}

export type ClaudeAuthProxyOptions = {
  readToken: (accountId: string) => Promise<string | null>
  /** Defaults to https://api.anthropic.com. Tests inject a loopback upstream. */
  upstream?: string
  log?: (line: string) => void
  /** Literal loopback IP. Anything routable is refused. */
  bindHost?: string
  /** Defaults to {@link CLAUDE_AUTH_PROXY_TOKEN_TTL_MS}. `0` re-reads every request. */
  tokenTtlMs?: number
  /** Socket inactivity budget. Defaults to Claude's 10 minutes. */
  idleTimeoutMs?: number
  now?: () => number
  /** Effective model for a slot. A pinned model is not rewritten. */
  modelForSlot?: (slot: string) => ClaudeProxySlotModel | null
  /** Bodies over this size swap the model string instead of parsing. Tests set a small cap. */
  modelRewriteBufferCap?: number
  /**
   * On an upstream 401, refresh the slot's account and replay the buffered body once.
   * A body over the rewrite cap is not replayed; the refresh still runs for the next request.
   */
  refreshAccessToken?: (accountId: string) => Promise<string | null>
}

export function createClaudeAuthProxy(options: ClaudeAuthProxyOptions): ClaudeAuthProxy {
  const bindHost = options.bindHost ?? ORCAD_LOOPBACK_BIND_HOST
  if (bindHostIsNetworkExposed(bindHost)) {
    throw new Error('claude auth proxy only binds to loopback')
  }
  const slots = new Map<string, string>()
  const upstream = options.upstream ?? UPSTREAM_ORIGIN
  const log = options.log ?? (() => {})
  const now = options.now ?? Date.now
  const tokens = createClaudeAuthProxyTokenCache({
    ttlMs: options.tokenTtlMs ?? CLAUDE_AUTH_PROXY_TOKEN_TTL_MS,
    now,
    readToken: options.readToken
  })
  const requests = createClaudeAuthProxyRequestLog(now, log)
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
    listening = new Promise<void>((resolve, reject) => {
      const fail = (error: Error): void => {
        server.off('listening', ready)
        reject(error)
      }
      const ready = (): void => {
        server.off('error', fail)
        resolve()
      }
      server.once('error', fail)
      server.once('listening', ready)
      server.listen(0, bindHost)
    })
    return listening
  }

  function destroyAgents(): void {
    httpAgent.destroy()
    httpsAgent.destroy()
  }

  function stop(): Promise<void> {
    if (stopping) {
      return stopping
    }
    closing = true
    const finish = (): void => {
      tokens.invalidate()
      slots.clear()
      destroyAgents()
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
    const match = requestUrl.pathname.match(SLOT_PATH)
    const slot = match?.[1]
    const upstreamPath = match
      ? match[2] && match[2] !== '/'
        ? match[2]
        : '/'
      : requestUrl.pathname
    const knownAccount = slot ? slots.get(slot) : undefined
    const unknownSlot = Boolean(slot && knownAccount === undefined)
    const accountId = knownAccount ?? null
    const method = req.method ?? 'GET'
    // Read before opening upstream so a slot flip during this body cannot change it.
    const token = accountId ? await tokens.tokenFor(accountId) : null
    const headers = forwardRequestHeaders(req.headers)
    if (token) {
      headers.authorization = `Bearer ${token}`
    }
    const contentTypeHeader = req.headers['content-type']
    const contentType = Array.isArray(contentTypeHeader) ? contentTypeHeader[0] : contentTypeHeader
    const slotModel = slot ? (options.modelForSlot?.(slot) ?? null) : null
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
      unknownSlot,
      headers,
      target,
      httpAgent,
      httpsAgent,
      idleTimeoutMs,
      observe: (status) => requests.observe(method, upstreamPath, status, accountId, unknownSlot),
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
      requests.observe(method, upstreamPath, status, accountId, unknownSlot)
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
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const slot = randomBytes(SLOT_ID_BYTES).toString('hex')
        if (!slots.has(slot)) {
          slots.set(slot, accountId)
          return slot
        }
      }
      throw new Error('claude auth proxy could not allocate a slot')
    },
    assignSlot(slot, accountId) {
      if (!slots.has(slot)) {
        return false
      }
      slots.set(slot, accountId)
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
    },
    invalidateToken(accountId) {
      tokens.invalidate(accountId)
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
