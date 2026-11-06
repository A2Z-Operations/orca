import { readFile } from 'node:fs/promises'
import { runProcess } from '@orca/process-host'
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

/** Environment block of a live process this user owns; '' where the platform offers none. */
async function readProcessEnvironment(pid: number, platform: NodeJS.Platform): Promise<string> {
  if (platform === 'linux') {
    return readFile(`/proc/${pid}/environ`, 'utf8')
  }
  if (platform !== 'darwin') {
    return ''
  }
  const result = await runProcess({
    program: '/bin/ps',
    args: ['-wwE', '-o', 'command=', '-p', String(pid)],
    timeoutMs: 1_000,
    maxOutputBytes: 256 * 1024
  })
  return result.code === 0 ? result.stdout : ''
}

/**
 * `ANTHROPIC_BASE_URL` of a live process this user owns, read without a shell: `/proc/<pid>/environ`
 * on Linux, `ps -E` on macOS. Null on Windows, on a denied read, or when the variable is absent.
 * Asynchronous so a reattach never blocks the main thread on `ps`.
 */
export async function readProcessAnthropicBaseUrl(
  pid: number | null | undefined,
  platform: NodeJS.Platform = process.platform
): Promise<string | null> {
  if (!pid || !Number.isInteger(pid) || pid <= 1) {
    return null
  }
  try {
    return BASE_URL_IN_ENV.exec(await readProcessEnvironment(pid, platform))?.[1] ?? null
  } catch {
    return null
  }
}
