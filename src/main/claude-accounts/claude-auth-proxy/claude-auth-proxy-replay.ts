import {
  type Agent as HttpAgent,
  request as httpRequest,
  type IncomingMessage,
  type OutgoingHttpHeaders,
  type ServerResponse
} from 'node:http'
import { type Agent as HttpsAgent, request as httpsRequest } from 'node:https'

export type ClaudeAuthProxyExchange = {
  req: IncomingMessage
  res: ServerResponse
  method: string
  upstreamPath: string
  accountId: string | null
  unknownSlot: boolean
  headers: OutgoingHttpHeaders
  target: URL
  httpAgent: HttpAgent
  httpsAgent: HttpsAgent
  idleTimeoutMs: number
  observe: (status: number) => void
  invalidate: (accountId: string) => void
  refresh?: (accountId: string) => Promise<string | null>
  deliver: (status: number, upstream: IncomingMessage) => void
}

type BoundedProxyBody =
  | { kind: 'buffered'; body: Buffer }
  | { kind: 'overflow'; prefix: Buffer; restChunk: Buffer }

export function headerContentLength(value: string | string[] | undefined): number | null {
  const raw = Array.isArray(value) ? value[0] : value
  if (raw === undefined || raw === '') {
    return null
  }
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

/**
 * Buffer until `cap`. Past it, return the bytes already kept and the chunk that crossed the cap.
 * The request stays open so the caller can pipe the rest.
 */
export function readBoundedProxyBody(req: IncomingMessage, cap: number): Promise<BoundedProxyBody> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    const cleanup = (): void => {
      req.off('data', onData)
      req.off('end', onEnd)
      req.off('error', onError)
    }
    const onData = (chunk: Buffer | string): void => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      if (size + buffer.length > cap) {
        req.pause()
        cleanup()
        resolve({ kind: 'overflow', prefix: Buffer.concat(chunks), restChunk: buffer })
        return
      }
      chunks.push(buffer)
      size += buffer.length
    }
    const onEnd = (): void => {
      cleanup()
      resolve({ kind: 'buffered', body: Buffer.concat(chunks) })
    }
    const onError = (error: Error): void => {
      cleanup()
      reject(error)
    }
    req.on('data', onData)
    req.on('end', onEnd)
    req.on('error', onError)
  })
}

export async function finishBufferedClaudeAuthProxy(
  exchange: ClaudeAuthProxyExchange,
  payload: Buffer,
  replayable: boolean,
  bearer: string | null
): Promise<void> {
  const send = (bearer: string | null): Promise<{ status: number; upstream: IncomingMessage }> =>
    new Promise((resolve, reject) => {
      const attemptHeaders = { ...exchange.headers }
      if (bearer) {
        attemptHeaders.authorization = `Bearer ${bearer}`
      } else {
        delete attemptHeaders.authorization
      }
      let settled = false
      const onResponse = (upstreamRes: IncomingMessage): void => {
        settled = true
        resolve({ status: upstreamRes.statusCode ?? 502, upstream: upstreamRes })
      }
      const upstreamReq =
        exchange.target.protocol === 'https:'
          ? httpsRequest(
              exchange.target,
              { method: exchange.method, headers: attemptHeaders, agent: exchange.httpsAgent },
              onResponse
            )
          : httpRequest(
              exchange.target,
              { method: exchange.method, headers: attemptHeaders, agent: exchange.httpAgent },
              onResponse
            )
      upstreamReq.setTimeout(exchange.idleTimeoutMs, () => upstreamReq.destroy())
      upstreamReq.on('error', (error) => {
        if (settled) {
          return
        }
        settled = true
        reject(error)
      })
      exchange.req.on('aborted', () => upstreamReq.destroy())
      upstreamReq.end(payload)
    })
  let attempt: { status: number; upstream: IncomingMessage }
  try {
    attempt = await send(bearer)
  } catch {
    if (!exchange.res.headersSent && !exchange.res.writableEnded) {
      exchange.observe(502)
      exchange.res.writeHead(502)
      exchange.res.end()
    }
    return
  }
  return replayBuffered(exchange, send, attempt, replayable)
}

async function replayBuffered(
  exchange: ClaudeAuthProxyExchange,
  send: (bearer: string | null) => Promise<{ status: number; upstream: IncomingMessage }>,
  attempt: { status: number; upstream: IncomingMessage },
  replayable: boolean
): Promise<void> {
  if (attempt.status === 401 && exchange.accountId && exchange.refresh) {
    exchange.invalidate(exchange.accountId)
    if (replayable) {
      discardUpstream(attempt.upstream)
      const next = await exchange.refresh(exchange.accountId).catch(() => null)
      if (next) {
        try {
          attempt = await send(next)
        } catch {
          if (!exchange.res.headersSent && !exchange.res.writableEnded) {
            exchange.observe(502)
            exchange.res.writeHead(502)
            exchange.res.end()
          }
          return
        }
      }
    } else {
      void exchange.refresh(exchange.accountId).catch(() => {})
    }
  }
  exchange.deliver(attempt.status, attempt.upstream)
}

export async function streamOverflowClaudeAuthProxy(
  exchange: ClaudeAuthProxyExchange,
  prefix: Buffer,
  restChunk: Buffer
): Promise<void> {
  await new Promise<void>((resolve) => {
    let settled = false
    const onResponse = (upstreamRes: IncomingMessage): void => {
      settled = true
      const status = upstreamRes.statusCode ?? 502
      if (status === 401 && exchange.accountId && exchange.refresh) {
        exchange.invalidate(exchange.accountId)
        void exchange.refresh(exchange.accountId).catch(() => {})
      }
      exchange.deliver(status, upstreamRes)
      resolve()
    }
    const upstreamReq =
      exchange.target.protocol === 'https:'
        ? httpsRequest(
            exchange.target,
            { method: exchange.method, headers: exchange.headers, agent: exchange.httpsAgent },
            onResponse
          )
        : httpRequest(
            exchange.target,
            { method: exchange.method, headers: exchange.headers, agent: exchange.httpAgent },
            onResponse
          )
    upstreamReq.setTimeout(exchange.idleTimeoutMs, () => upstreamReq.destroy())
    upstreamReq.on('error', () => {
      if (settled || exchange.res.headersSent || exchange.res.writableEnded) {
        if (!exchange.res.writableEnded) {
          exchange.res.destroy()
        }
        resolve()
        return
      }
      settled = true
      exchange.observe(502)
      exchange.res.writeHead(502)
      exchange.res.end()
      resolve()
    })
    exchange.req.on('aborted', () => upstreamReq.destroy())
    exchange.req.on('error', () => upstreamReq.destroy())
    // The overflowing chunk was already pulled off the request. Put it back ahead of the pipe.
    if (restChunk.length > 0) {
      exchange.req.unshift(restChunk)
    }
    if (prefix.length > 0) {
      exchange.req.unshift(prefix)
    }
    exchange.req.pipe(upstreamReq)
  })
}

export function pipeClaudeAuthProxy(
  exchange: ClaudeAuthProxyExchange,
  bearer: string | null,
  refreshOnUnauthorized: boolean
): void {
  if (bearer) {
    exchange.headers.authorization = `Bearer ${bearer}`
  }
  let settled = false
  const onResponse = (upstreamRes: IncomingMessage): void => {
    settled = true
    const status = upstreamRes.statusCode ?? 502
    if (refreshOnUnauthorized && status === 401 && exchange.accountId && exchange.refresh) {
      exchange.invalidate(exchange.accountId)
      void exchange.refresh(exchange.accountId).catch(() => {})
    }
    exchange.deliver(status, upstreamRes)
  }
  const upstreamReq =
    exchange.target.protocol === 'https:'
      ? httpsRequest(
          exchange.target,
          { method: exchange.method, headers: exchange.headers, agent: exchange.httpsAgent },
          onResponse
        )
      : httpRequest(
          exchange.target,
          { method: exchange.method, headers: exchange.headers, agent: exchange.httpAgent },
          onResponse
        )
  upstreamReq.setTimeout(exchange.idleTimeoutMs, () => upstreamReq.destroy())
  upstreamReq.on('error', () => {
    if (settled || exchange.res.headersSent || exchange.res.writableEnded) {
      if (!exchange.res.writableEnded) {
        exchange.res.destroy()
      }
      return
    }
    settled = true
    exchange.observe(502)
    exchange.res.writeHead(502)
    exchange.res.end()
  })
  const abortUpstream = (): void => {
    upstreamReq.destroy()
  }
  exchange.req.on('aborted', abortUpstream)
  exchange.req.on('error', abortUpstream)
  // Pipe the body. Do not buffer it: /compact posts are hundreds of kilobytes.
  exchange.req.pipe(upstreamReq)
}

/** Resume a rejected upstream so a replay does not leave its socket open. */
function discardUpstream(upstream: IncomingMessage): void {
  upstream.on('error', () => {})
  upstream.resume()
}
