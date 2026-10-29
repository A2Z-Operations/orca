import { randomBytes } from 'node:crypto'
import {
  createServer,
  request as httpRequest,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type OutgoingHttpHeaders,
  type Server,
  type ServerResponse
} from 'node:http'
import { request as httpsRequest } from 'node:https'
import { ORCAD_LOOPBACK_BIND_HOST } from '../../orcad/orcad-bind-address'

const UPSTREAM_ORIGIN = 'https://api.anthropic.com'
const SLOT_PATH = /^\/p\/([^/]+)(\/.*)?$/

/** Hop-by-hop and length headers the proxy sets itself when it pipes the body. */
const DROPPED_REQUEST_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length'
])

const DROPPED_RESPONSE_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade'
])

export type ClaudeAuthProxy = {
  start: () => Promise<void>
  stop: () => Promise<void>
  port: () => number | null
  allocateSlot: (accountId: string) => string
  assignSlot: (slot: string, accountId: string) => boolean
  accountIdForSlot: (slot: string) => string | null
  /** Trailing slash so Claude's `/v1/...` join keeps the `/p/<slot>/` prefix. */
  slotBaseUrl: (slot: string) => string | null
  releaseSlot: (slot: string) => void
}

export type ClaudeAuthProxyOptions = {
  readToken: (accountId: string) => Promise<string | null>
  /** Defaults to https://api.anthropic.com. Tests inject a loopback upstream. */
  upstream?: string
  log?: (line: string) => void
  bindHost?: string
}

export function createClaudeAuthProxy(options: ClaudeAuthProxyOptions): ClaudeAuthProxy {
  const slots = new Map<string, string>()
  const bindHost = options.bindHost ?? ORCAD_LOOPBACK_BIND_HOST
  const upstream = options.upstream ?? UPSTREAM_ORIGIN
  const log = options.log ?? (() => {})
  const server = createServer((req, res) => {
    void handle(req, res).catch(() => {
      if (!res.headersSent) {
        res.writeHead(502)
      }
      res.end()
    })
  })
  let listening: Promise<void> | null = null

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

  async function stop(): Promise<void> {
    slots.clear()
    if (listening) {
      await listening.catch(() => {})
    }
    listening = null
    if (!server.listening) {
      return
    }
    await closeServer(server)
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
    const accountId = slot ? slots.get(slot) : undefined
    const method = req.method ?? 'GET'
    let token: string | null = null
    if (accountId) {
      try {
        token = await options.readToken(accountId)
      } catch {
        token = null
      }
    }
    const headers = forwardRequestHeaders(req.headers)
    if (token) {
      headers.authorization = `Bearer ${token}`
    }
    const target = new URL(`${upstreamPath}${requestUrl.search}`, upstream)
    const transport = target.protocol === 'https:' ? httpsRequest : httpRequest
    const upstreamReq = transport(target, { method, headers }, (upstreamRes) => {
      const status = upstreamRes.statusCode ?? 502
      log(`${method} ${upstreamPath} ${status} ${accountId ?? '-'}`)
      res.writeHead(status, forwardResponseHeaders(upstreamRes.headers))
      upstreamRes.pipe(res)
    })
    upstreamReq.on('error', () => {
      if (res.headersSent || res.writableEnded) {
        res.destroy()
        return
      }
      log(`${method} ${upstreamPath} 502 ${accountId ?? '-'}`)
      res.writeHead(502)
      res.end()
    })
    req.on('aborted', () => upstreamReq.destroy())
    req.pipe(upstreamReq)
  }

  return {
    start,
    stop,
    port,
    allocateSlot(accountId) {
      const slot = randomBytes(8).toString('hex')
      slots.set(slot, accountId)
      return slot
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
    }
  }
}

function forwardRequestHeaders(headers: IncomingHttpHeaders): OutgoingHttpHeaders {
  const forwarded: OutgoingHttpHeaders = {}
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined || DROPPED_REQUEST_HEADERS.has(name)) {
      continue
    }
    forwarded[name] = value
  }
  return forwarded
}

function forwardResponseHeaders(headers: IncomingHttpHeaders): OutgoingHttpHeaders {
  const forwarded: OutgoingHttpHeaders = {}
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined || DROPPED_RESPONSE_HEADERS.has(name)) {
      continue
    }
    forwarded[name] = value
  }
  return forwarded
}

function closeServer(server: Server): Promise<void> {
  server.closeAllConnections()
  return new Promise((resolve) => {
    server.close(() => resolve())
  })
}
