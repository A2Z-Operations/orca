import type { IncomingMessage, ServerResponse } from 'node:http'

/**
 * After a restart the panes' first requests can land before their slots are adopted again. Until
 * the host reports every persisted pane back, an unknown slot is answered 503 + Retry-After so
 * Claude retries; this caps that window. A 401 here would log the pane out.
 */
export const CLAUDE_AUTH_PROXY_STARTUP_GRACE_MS = 60_000
export const CLAUDE_AUTH_PROXY_UNKNOWN_SLOT_RETRY_AFTER_S = 2

export type ClaudeAuthProxyStartupGrace = {
  /** The listener is up: the grace runs from now to its cap. */
  begin: () => void
  /** Every persisted slot is adopted: an unknown slot is stale from here on. */
  end: () => void
  active: () => boolean
}

export function createClaudeAuthProxyStartupGrace(
  now: () => number,
  graceMs: number = CLAUDE_AUTH_PROXY_STARTUP_GRACE_MS
): ClaudeAuthProxyStartupGrace {
  /** When the grace ends. Null before listen and once the host closes it. */
  let until: number | null = null
  return {
    begin() {
      until = now() + graceMs
    },
    end() {
      until = null
    },
    active() {
      return until !== null && now() < until
    }
  }
}

/**
 * A slot this listener does not map is never forwarded: without a bearer upstream answers 401
 * and Claude treats that as logged out. During the grace the pane's slot may still be on its way
 * back (the PTY reattach adopts it), so the answer asks for a retry; after it the slot is stale.
 * Returns the status sent.
 */
export function refuseClaudeAuthProxyUnknownSlot(
  req: IncomingMessage,
  res: ServerResponse,
  startupGrace: boolean
): 503 | 502 {
  const status = startupGrace ? 503 : 502
  const body = startupGrace ? 'slot not registered yet, retry\n' : 'slot not registered\n'
  refuse(
    req,
    res,
    status,
    body,
    startupGrace ? { 'retry-after': String(CLAUDE_AUTH_PROXY_UNKNOWN_SLOT_RETRY_AFTER_S) } : {}
  )
  return status
}

/**
 * A path with no `/p/<slot>/` prefix names nothing on this listener. Every URL this host mints is a
 * slot URL (`slotBaseUrl`), and Claude Code joins its `/v1/...` and `/api/hello` onto that base, so
 * a bare path is a hand-typed base URL or a stray client; `claude-auth-proxy-url.ts` likewise reads
 * a loopback URL without the prefix as a user base URL, not this proxy. Forwarding it would go up
 * bearer-less, so it is 404 and never opened upstream. Returns the status sent.
 */
export function refuseClaudeAuthProxyWithoutSlot(req: IncomingMessage, res: ServerResponse): 404 {
  refuse(req, res, 404, 'no proxy slot in path\n', {})
  return 404
}

export function refuseClaudeAuthProxyMissingCredentials(
  req: IncomingMessage,
  res: ServerResponse,
  accountId: string
): 401 {
  refuse(
    req,
    res,
    401,
    JSON.stringify({
      type: 'error',
      error: {
        type: 'authentication_error',
        message: `Claude account "${accountId}" is no longer signed in or its credentials are unavailable. Select a signed-in account in Orca and resume this pane.`
      }
    }),
    { 'content-type': 'application/json; charset=utf-8' }
  )
  return 401
}

function refuse(
  req: IncomingMessage,
  res: ServerResponse,
  status: number,
  body: string,
  extraHeaders: Record<string, string>
): void {
  res.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'content-length': String(Buffer.byteLength(body)),
    ...extraHeaders
  })
  res.end(body)
  // Drain the body so the keep-alive socket is reusable.
  req.resume()
}
