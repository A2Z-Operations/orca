import { describe, expect, it, vi } from 'vitest'
import {
  parseLinuxProcStatProcessGroup,
  parseLinuxProcStatSessionId
} from './posix-pty-process-table'
import {
  reapAgentPaneSession,
  selectAgentPaneSessionGroups,
  type AgentPaneSessionMember
} from './agent-pane-session-reap'

const rootPid = 10
const currentPid = 99

function members(selfSid: number): AgentPaneSessionMember[] {
  return [
    { pid: rootPid, pgid: 10, sid: 50, tty: 'ttys010' },
    { pid: 11, pgid: 11, sid: 50, tty: '??' },
    { pid: 12, pgid: 12, sid: 99, tty: '??' },
    { pid: 13, pgid: 1, sid: 50, tty: '??' },
    { pid: 14, pgid: 20, sid: 50, tty: 'ttys010' },
    { pid: currentPid, pgid: 20, sid: selfSid, tty: 'ttys000' }
  ]
}

describe('selectAgentPaneSessionGroups', () => {
  it('kills same-session groups, including a tty-less orphan, and skips every other group', () => {
    expect(selectAgentPaneSessionGroups(members(7), rootPid, currentPid)).toEqual({
      sid: 50,
      rootPgid: 10,
      groups: [11, 10]
    })
  })

  it('returns null when this process is already in the pane session', () => {
    expect(selectAgentPaneSessionGroups(members(50), rootPid, currentPid)).toBeNull()
  })
})

describe('reapAgentPaneSession', () => {
  it('signals the selected groups and skips a root that is already gone', async () => {
    const signalProcessGroup = vi.fn()
    await reapAgentPaneSession(rootPid, {
      platform: 'darwin',
      currentPid,
      pidExists: () => true,
      readMembers: () => members(7),
      signalProcessGroup
    })
    expect(signalProcessGroup.mock.calls.map((call) => call[0])).toEqual([11, 10])

    signalProcessGroup.mockClear()
    await reapAgentPaneSession(4242, {
      platform: 'darwin',
      pidExists: () => false,
      readMembers: () => {
        throw new Error('a dead root must not be scanned')
      },
      signalProcessGroup
    })
    expect(signalProcessGroup).not.toHaveBeenCalled()
  })

  it('does nothing on Windows, where the PTY job already owns reparented children', async () => {
    const signalProcessGroup = vi.fn()
    await reapAgentPaneSession(rootPid, {
      platform: 'win32',
      pidExists: () => true,
      readMembers: () => {
        throw new Error('Windows must not scan the POSIX session')
      },
      signalProcessGroup
    })
    expect(signalProcessGroup).not.toHaveBeenCalled()
  })
})

describe('linux /proc stat identity', () => {
  const stat = '123 (my proc) S 1 456 99 0 0'

  it('reads the process group and session past a comm that contains spaces', () => {
    expect(parseLinuxProcStatProcessGroup(stat)).toBe(456)
    expect(parseLinuxProcStatSessionId(stat)).toBe(99)
  })
})
