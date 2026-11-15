import { describe, expect, it, vi } from 'vitest'
import type { KillRequest } from '../protocol/daemon-rpc-contract'
import { handleDaemonTerminalKill } from './daemon-terminal-kill'

type KillDeps = Parameters<typeof handleDaemonTerminalKill>[2]

function deps(): { kill: ReturnType<typeof vi.fn>; deps: KillDeps } {
  const kill = vi.fn(async () => {})
  const fake = {
    host: { kill },
    preparations: { cancel: () => false },
    attachments: { clearInput: () => {} },
    log: { log: () => {} }
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: handleDaemonTerminalKill uses only host.kill, preparations.cancel, attachments.clearInput and log.log, all of which the fake provides.
  return { kill, deps: fake as unknown as KillDeps }
}

describe('daemon kill: the #44 close reason', () => {
  it('passes restart through; absent or close pass no reason (the host then closes)', async () => {
    const cases: [KillRequest['payload'], Record<string, string>][] = [
      [{ sessionId: 's1', immediate: true, reason: 'restart' }, { reason: 'restart' }],
      [{ sessionId: 's1', immediate: true }, {}],
      [{ sessionId: 's1', immediate: true, reason: 'close' }, {}]
    ]
    for (const [payload, want] of cases) {
      const d = deps()
      await handleDaemonTerminalKill('client', payload, d.deps)
      expect(d.kill).toHaveBeenCalledWith('s1', { immediate: true, ...want })
    }
  })

  it('an unknown reason from a newer or broken client is a close', async () => {
    const d = deps()
    const payload = JSON.parse('{"sessionId":"s1","immediate":true,"reason":"bogus"}')
    await handleDaemonTerminalKill('client', payload, d.deps)
    expect(d.kill).toHaveBeenCalledWith('s1', { immediate: true })
  })
})
