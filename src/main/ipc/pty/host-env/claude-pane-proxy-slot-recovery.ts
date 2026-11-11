import {
  claudeAuthProxySlotId,
  claudeAuthProxySlotPort
} from '../../../claude-accounts/claude-auth-proxy/claude-auth-proxy-url'
export {
  readProcessAnthropicBaseUrl,
  readProcessAnthropicBaseUrls
} from '../../../claude-accounts/claude-auth-proxy/claude-auth-proxy-process-env'

/** The proxy calls a reattach needs. `getClaudeAuthProxy()` satisfies it. */
export type ReattachSlotProxy = {
  port: () => number | null
  accountIdForSlot: (slot: string) => string | null
  adoptSlot: (slot: string, accountId: string) => boolean
}

export type RecoveredProxySlot = { slot: string; port: number | null }

/**
 * The slot a reattached PTY keeps, or undefined when its URL no longer reaches this listener.
 * Live: this listener still maps the slot. Adopted: the listener restarted on the slot's old port,
 * so the PTY's baked URL reaches it again once the slot is re-registered for the billed account.
 * Anything else (no listener, another port, malformed id) leaves the pane to the resume strategy.
 */
export function recoverReattachedProxySlot(input: {
  recovered: RecoveredProxySlot | null
  accountId: string
  proxy: ReattachSlotProxy | null
}): string | undefined {
  const { recovered, proxy } = input
  if (!recovered || !proxy) {
    return undefined
  }
  if (proxy.accountIdForSlot(recovered.slot) !== null) {
    return recovered.slot
  }
  const port = proxy.port()
  if (port === null || recovered.port !== port) {
    return undefined
  }
  return proxy.adoptSlot(recovered.slot, input.accountId) ? recovered.slot : undefined
}

/** Slot and port of a `/p/<slot>/` loopback URL. Null for a user base URL or no URL. */
export function proxySlotFromUrl(url: string | undefined | null): RecoveredProxySlot | null {
  const slot = url ? claudeAuthProxySlotId(url) : null
  return slot && url ? { slot, port: claudeAuthProxySlotPort(url) } : null
}
