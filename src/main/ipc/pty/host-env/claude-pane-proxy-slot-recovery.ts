import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import {
  claudeAuthProxySlotId,
  claudeAuthProxySlotPort
} from '../../../claude-accounts/claude-auth-proxy/claude-auth-proxy-url'

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

const BASE_URL_IN_ENV = /(?:^|[\s\0])ANTHROPIC_BASE_URL=(\S+?)(?=[\s\0]|$)/

/**
 * `ANTHROPIC_BASE_URL` of a live process this user owns, read without a shell: `/proc/<pid>/environ`
 * on Linux, `ps -E` on macOS. Null on Windows, on a denied read, or when the variable is absent.
 */
export function readProcessAnthropicBaseUrl(
  pid: number | null | undefined,
  platform: NodeJS.Platform = process.platform
): string | null {
  if (!pid || !Number.isInteger(pid) || pid <= 1) {
    return null
  }
  try {
    const env =
      platform === 'linux'
        ? readFileSync(`/proc/${pid}/environ`, 'utf8')
        : platform === 'darwin'
          ? execFileSync('/bin/ps', ['-wwE', '-o', 'command=', '-p', String(pid)], {
              encoding: 'utf8',
              timeout: 1_000,
              stdio: ['ignore', 'pipe', 'ignore']
            })
          : ''
    return BASE_URL_IN_ENV.exec(env)?.[1] ?? null
  } catch {
    return null
  }
}
