import '../../pty-subprocess/testing/mock-descendant-sweep'
import { describe, expect, it, vi } from 'vitest'
import type { SubprocessHandle } from '../../sessions/session-subprocess-handle'
import { TerminalHost } from '../terminal-host'
import type { PaneOwnershipHooks } from '../terminal-host-options'

function subprocess(foreground: string): SubprocessHandle & {
  exit: () => void
  signalCalls: () => number
} {
  let onExit: ((code: number) => void) | null = null
  const exitSoon = (): void => queueMicrotask(() => onExit?.(0))
  const kill = vi.fn(exitSoon)
  const forceKill = vi.fn(exitSoon)
  return {
    pid: 99_999,
    getForegroundProcess: () => foreground,
    write: vi.fn(),
    resize: vi.fn(),
    kill,
    terminateOwnedTree: () => 'unavailable' as const,
    forceKill,
    signal: vi.fn(),
    onData: () => {},
    onExit: (listener) => {
      onExit = listener
    },
    dispose: vi.fn(),
    exit: () => onExit?.(0),
    signalCalls: () => kill.mock.calls.length + forceKill.mock.calls.length
  }
}

async function hostWith(
  hooks: PaneOwnershipHooks | undefined,
  launchAgent: 'claude' | null = 'claude'
): Promise<{ host: TerminalHost; child: ReturnType<typeof subprocess> }> {
  const children: ReturnType<typeof subprocess>[] = []
  const host = new TerminalHost({
    ...(hooks ? { paneOwnership: hooks } : {}),
    spawnSubprocess: () => {
      const child = subprocess(launchAgent ?? 'bash')
      children.push(child)
      return child
    }
  })
  await host.createOrAttach({
    sessionId: 's1',
    cols: 80,
    rows: 24,
    ...(launchAgent ? { launchAgent } : {}),
    streamClient: { onData: vi.fn(), onExit: vi.fn() }
  })
  return { host, child: children[0] }
}

describe('TerminalHost and pane ownership (#44 stage 2, observe only)', () => {
  it('notes the close BEFORE the kill and observes only after kill() has returned and its sweep settled', async () => {
    const order: string[] = []
    const hooks: PaneOwnershipHooks = {
      noteClose: (id, reason) => order.push(`note ${id} ${reason}`),
      observeClose: async (id, reason) => {
        order.push(`observe ${id} ${reason}`)
      },
      onRootExit: (id) => order.push(`exit ${id}`)
    }
    const { host } = await hostWith(hooks)
    expect(host.listAgentRoots()).toEqual([{ sessionId: 's1', rootPid: 99_999 }])
    const killed = host.kill('s1', { reason: 'restart' })
    order.push('kill returned')
    await killed
    await vi.waitFor(() => expect(order).toContain('observe s1 restart'))
    expect(order.slice(0, 2)).toEqual(['note s1 restart', 'kill returned'])
    expect(order.filter((o) => o.startsWith('observe'))).toEqual(['observe s1 restart'])
    await host.dispose()
  })

  it('a kill without a reason is a close', async () => {
    const reasons: string[] = []
    const { host } = await hostWith({
      noteClose: (_id, r) => reasons.push(r),
      observeClose: async () => {},
      onRootExit: () => {}
    })
    await host.kill('s1')
    expect(reasons).toEqual(['close'])
    await host.dispose()
  })

  it('S1: hooks that throw, reject or never settle leave the kill exactly as without them', async () => {
    const plain = await hostWith(undefined)
    await plain.host.kill('s1')
    const baseline = plain.child.signalCalls()
    await plain.host.dispose()

    const observed: string[] = []
    const throwing = await hostWith({
      noteClose: () => {
        throw new Error('note')
      },
      observeClose: () => {
        observed.push('observe')
        throw new Error('observe')
      },
      onRootExit: () => {
        throw new Error('exit')
      }
    })
    await expect(throwing.host.kill('s1')).resolves.toBeUndefined()
    await vi.waitFor(() => expect(observed).toEqual(['observe']))
    expect(throwing.child.signalCalls()).toBe(baseline)
    await throwing.host.dispose()

    const hanging = await hostWith({
      noteClose: () => {},
      observeClose: () => new Promise(() => {}),
      onRootExit: () => {}
    })
    await expect(hanging.host.kill('s1')).resolves.toBeUndefined()
    await hanging.host.dispose()

    const rejecting = await hostWith({
      noteClose: () => {},
      observeClose: () => Promise.reject(new Error('x')),
      onRootExit: () => {}
    })
    await expect(rejecting.host.kill('s1')).resolves.toBeUndefined()
    await rejecting.host.dispose()
  })

  it('the agent exiting by itself is reported once, as a root exit', async () => {
    const exits: string[] = []
    const { host, child } = await hostWith({
      noteClose: () => {},
      observeClose: async () => {},
      onRootExit: (id) => exits.push(id)
    })
    child.exit()
    await vi.waitFor(() => expect(exits).toEqual(['s1']))
    await host.dispose()
  })

  it('a plain terminal never reaches the hooks and is not an agent root', async () => {
    const calls: string[] = []
    const { host } = await hostWith(
      {
        noteClose: () => calls.push('note'),
        observeClose: async () => void calls.push('observe'),
        onRootExit: () => calls.push('exit')
      },
      null
    )
    expect(host.listAgentRoots()).toEqual([])
    await host.kill('s1')
    await host.dispose()
    expect(calls).toEqual([])
  })
})
