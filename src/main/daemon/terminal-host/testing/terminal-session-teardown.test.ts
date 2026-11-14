import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TerminalSessionTeardown } from '../terminal-session-teardown'
import type { Session } from '../../sessions/session'
import type { DescendantSnapshot } from '../../../pty/process-retirement/pty-descendant-termination'

const killWithDescendantSweepMock = vi.hoisted(() => vi.fn())
const terminateShutdownDescendantsMock = vi.hoisted(() => vi.fn())
const reapAgentPaneSessionMock = vi.hoisted(() => vi.fn())
vi.mock('../../sessions/terminal-descendant-shutdown', () => ({
  terminateShutdownDescendants: terminateShutdownDescendantsMock
}))
vi.mock('../../../pty/process-retirement/pty-descendant-termination', () => ({
  killWithDescendantSweep: killWithDescendantSweepMock
}))
vi.mock('../../../pty/process-retirement/agent-pane-session-reap', () => ({
  reapAgentPaneSession: reapAgentPaneSessionMock
}))

function createPlainShellSession(overrides: Partial<Session> = {}): Session {
  return {
    launchAgent: undefined,
    pid: 4242,
    isAlive: true,
    forceKillAndWaitForExit: vi.fn(async () => {}),
    beginTermination: vi.fn(() => true),
    terminateOwnedTree: vi.fn(() => 'terminated' as const),
    scheduleForceDisposeFallback: vi.fn(),
    signalTerminationRoot: vi.fn(),
    ...overrides
  } as unknown as Session
}

describe('TerminalSessionTeardown plain-shell teardown', () => {
  let platformDescriptor: PropertyDescriptor | undefined

  beforeEach(() => {
    platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')
    killWithDescendantSweepMock.mockReset()
    killWithDescendantSweepMock.mockResolvedValue(undefined)
    reapAgentPaneSessionMock.mockReset()
  })

  afterEach(() => {
    if (platformDescriptor) {
      Object.defineProperty(process, 'platform', platformDescriptor)
    }
  })

  it('waits for a late immediate escalation after graceful descendant verification settles', async () => {
    let finishDescendants = (): void => {}
    let finishRoot = (): void => {}
    const descendantVerification = new Promise<void>((resolve) => {
      finishDescendants = resolve
    })
    const rootCompletion = new Promise<void>((resolve) => {
      finishRoot = resolve
    })
    terminateShutdownDescendantsMock.mockReturnValueOnce(descendantVerification)
    const snapshot: DescendantSnapshot = {
      rootPgid: 4242,
      descendants: [],
      capturedAtMs: Date.now()
    }
    killWithDescendantSweepMock.mockImplementationOnce(
      async (
        _pid: number,
        killRoot: () => void,
        deps: {
          terminateDescendants?: (value: DescendantSnapshot) => Promise<unknown>
        }
      ) => {
        deps.terminateDescendants?.(snapshot)
        killRoot()
      }
    )
    const session = createPlainShellSession({
      launchAgent: 'claude',
      forceKillAndWaitForExit: vi.fn(() => rootCompletion)
    })
    const teardown = new TerminalSessionTeardown(new Map([['s1', session]]))

    reapAgentPaneSessionMock.mockImplementation(() => {
      expect(killWithDescendantSweepMock).not.toHaveBeenCalled()
    })
    const graceful = teardown.killSession('s1', session, false)
    expect(reapAgentPaneSessionMock).toHaveBeenCalledWith(4242)
    await Promise.resolve()
    const immediate = teardown.requestImmediate('s1')

    expect(immediate).not.toBe(graceful)
    let settled = false
    void immediate?.then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)
    finishDescendants()
    await Promise.resolve()
    expect(settled).toBe(false)
    finishRoot()
    await immediate
    expect(settled).toBe(true)
  })

  it('does not reap a user shell on immediate close', async () => {
    const session = createPlainShellSession()
    const teardown = new TerminalSessionTeardown(new Map([['s1', session]]))

    await teardown.killSession('s1', session, true)

    expect(reapAgentPaneSessionMock).not.toHaveBeenCalled()
  })
})
