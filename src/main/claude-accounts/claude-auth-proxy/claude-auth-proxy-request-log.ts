import type { ClaudeAuthProxyStatus } from '../../../shared/claude-auth-proxy-status'

const REQUEST_WINDOW_MS = 60 * 60 * 1000

type LoggedRequest = { accountId: string; at: number }

export function createClaudeAuthProxyRequestLog(
  now: () => number,
  log: (line: string) => void,
  /** Every observed request, for the durable account log. */
  onRequest?: (request: {
    method: string
    path: string
    status: number
    accountId: string | null
    unknownSlot: boolean
  }) => void
): {
  /** A request on a known slot (or no slot), with the status the client got. */
  observe: (method: string, upstreamPath: string, status: number, accountId: string | null) => void
  /**
   * A request the listener refused for a slot it does not map. During the startup grace it is the
   * expected noise of a restart and is not counted; after it the count is the warning Settings and
   * the CLI show. Neither sets `lastError`: that is the last upstream answer, and this never went up.
   */
  observeUnknownSlot: (
    method: string,
    upstreamPath: string,
    status: number,
    startupGrace: boolean
  ) => void
  snapshot: () => Pick<
    ClaudeAuthProxyStatus,
    'requestsLastHour' | 'unknownSlotRequests' | 'lastError'
  >
} {
  const requests: LoggedRequest[] = []
  let unknownSlotRequests = 0
  let lastError: ClaudeAuthProxyStatus['lastError'] = null

  function prune(at: number): void {
    const cutoff = at - REQUEST_WINDOW_MS
    let drop = 0
    while (drop < requests.length && requests[drop]!.at < cutoff) {
      drop += 1
    }
    if (drop > 0) {
      requests.splice(0, drop)
    }
  }

  return {
    observe(method, upstreamPath, status, accountId) {
      const at = now()
      log(`${method} ${upstreamPath} ${status} ${accountId ?? '-'}`)
      onRequest?.({ method, path: upstreamPath, status, accountId, unknownSlot: false })
      if (accountId) {
        requests.push({ accountId, at })
        prune(at)
      }
      if (status >= 400) {
        lastError = { at, method, path: upstreamPath, status, accountId }
      }
    },
    observeUnknownSlot(method, upstreamPath, status, startupGrace) {
      log(`${method} ${upstreamPath} ${status} -`)
      onRequest?.({ method, path: upstreamPath, status, accountId: null, unknownSlot: true })
      if (!startupGrace) {
        unknownSlotRequests += 1
      }
    },
    snapshot() {
      const at = now()
      prune(at)
      const counts = new Map<string, number>()
      for (const request of requests) {
        counts.set(request.accountId, (counts.get(request.accountId) ?? 0) + 1)
      }
      const requestsLastHour = [...counts.entries()]
        .map(([accountId, count]) => ({ accountId, count }))
        .sort((left, right) =>
          left.accountId < right.accountId ? -1 : left.accountId > right.accountId ? 1 : 0
        )
      return { requestsLastHour, unknownSlotRequests, lastError }
    }
  }
}
