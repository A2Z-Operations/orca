import type { ClaudeAuthProxyStatus } from './claude-auth-proxy-status'

/** An upstream error this recent is still news; an older one is history. */
export const CLAUDE_AUTH_PROXY_RECENT_ERROR_MS = 60 * 60 * 1000

export type ClaudeAuthProxyHealthView = {
  /** Warn: a pane is talking to a slot the listener lost, or an upstream error came back within the hour. */
  warn: boolean
  unknownSlotRequests: number
  lastError: ClaudeAuthProxyStatus['lastError']
  recentError: boolean
}

export function claudeAuthProxyHealthView(
  health: Pick<ClaudeAuthProxyStatus, 'unknownSlotRequests' | 'lastError'>,
  now: number
): ClaudeAuthProxyHealthView {
  const recentError =
    health.lastError !== null && now - health.lastError.at <= CLAUDE_AUTH_PROXY_RECENT_ERROR_MS
  return {
    warn: health.unknownSlotRequests > 0 || recentError,
    unknownSlotRequests: health.unknownSlotRequests,
    lastError: health.lastError,
    recentError
  }
}
