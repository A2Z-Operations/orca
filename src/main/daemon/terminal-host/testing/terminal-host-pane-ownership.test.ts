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

  describe('#44 (a) restart carry-over: a replacement names the session it replaces', () => {
    async function create(
      hooks: PaneOwnershipHooks,
      extra: { carriesFrom?: string; launchAgent?: 'claude'; attachOnly?: boolean }
    ): Promise<TerminalHost> {
      const host = new TerminalHost({
        paneOwnership: hooks,
        spawnSubprocess: () => subprocess('claude')
      })
      await host
        .createOrAttach({
          sessionId: 's2',
          cols: 80,
          rows: 24,
          ...extra,
          streamClient: { onData: vi.fn(), onExit: vi.fn() }
        })
        .catch(() => {})
      return host
    }
    const base = (): PaneOwnershipHooks & { carries: string[] } => {
      const carries: string[] = []
      return {
        carries,
        noteClose: () => {},
        observeClose: async () => {},
        onRootExit: () => {},
        noteCarry: (id, from) => carries.push(`${from} -> ${id}`)
      }
    }

    it('a created agent pane with carriesFrom tells the observer, once', async () => {
      const hooks = base()
      const host = await create(hooks, { carriesFrom: 's1', launchAgent: 'claude' })
      expect(hooks.carries).toEqual(['s1 -> s2'])
      await host.dispose()
    })

    it('#70 S1: an ATTACH to an existing agent pane never carries, even naming carriesFrom', async () => {
      const hooks = base()
      const host = await create(hooks, { launchAgent: 'claude' })
      await host.createOrAttach({
        sessionId: 's2',
        cols: 80,
        rows: 24,
        launchAgent: 'claude',
        attachOnly: true,
        carriesFrom: 's1',
        streamClient: { onData: vi.fn(), onExit: vi.fn() }
      })
      expect(hooks.carries).toEqual([])
      await host.dispose()
    })

    it('no carry for a plain shell or without carriesFrom', async () => {
      const shell = base()
      const a = await create(shell, { carriesFrom: 's1' })
      const none = base()
      const b = await create(none, { launchAgent: 'claude' })
      expect(shell.carries).toEqual([])
      expect(none.carries).toEqual([])
      await a.dispose()
      await b.dispose()
    })

    it('a throwing noteCarry never changes the creation; an observer without noteCarry is fine', async () => {
      const throwing = {
        ...base(),
        noteCarry: () => {
          throw new Error('boom')
        }
      }
      const host = new TerminalHost({
        paneOwnership: throwing,
        spawnSubprocess: () => subprocess('claude')
      })
      await expect(
        host.createOrAttach({
          sessionId: 's2',
          cols: 80,
          rows: 24,
          launchAgent: 'claude',
          carriesFrom: 's1',
          streamClient: { onData: vi.fn(), onExit: vi.fn() }
        })
      ).resolves.toBeDefined()
      const { noteCarry: _omit, ...older } = base()
      const host2 = await create(older, { carriesFrom: 's1', launchAgent: 'claude' })
      expect(host.listAgentRoots()).toHaveLength(1)
      await host.dispose()
      await host2.dispose()
    })
  })
})
