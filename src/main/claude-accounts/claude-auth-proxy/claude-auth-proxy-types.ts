import type { ClaudeAuthProxyStatus } from '../../../shared/claude-auth-proxy-status'
import type { ClaudeProxySlotModel } from './claude-auth-proxy-model-body'
import type { createClaudeAuthProxyRequestLog } from './claude-auth-proxy-request-log'

export type ClaudeAuthProxy = {
  start: () => Promise<void>
  /** Stops accepting. In-flight responses finish; idle keep-alives close. */
  stop: () => Promise<void>
  port: () => number | null
  allocateSlot: (accountId: string) => string
  assignSlot: (slot: string, accountId: string) => boolean
  /** Re-registers a slot a reattached PTY still carries. False for a malformed id. */
  adoptSlot: (slot: string, accountId: string) => boolean
  accountIdForSlot: (slot: string) => string | null
  /** Trailing slash so Claude's `/v1/...` join keeps the `/p/<slot>/` prefix. */
  slotBaseUrl: (slot: string) => string | null
  releaseSlot: (slot: string) => void
  /** Drops one account, or every account when `accountId` is omitted. */
  invalidateToken: (accountId?: string) => void
  /**
   * Closes the startup grace before its cap: every persisted slot is adopted, so an unknown slot
   * is stale from here on and gets 502 instead of 503.
   */
  endStartupGrace: () => void
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
  /** Port of the previous listener. Taken or absent means an ephemeral port. */
  preferredPort?: number | null
  /** Cap on the startup grace. Defaults to 60 s (claude-auth-proxy-unknown-slot.ts). */
  startupGraceMs?: number
  /** Each request's method, path, status, account, and whether its slot was unknown. A path without a slot is a 404 row. */
  onRequest?: Parameters<typeof createClaudeAuthProxyRequestLog>[2]
}
