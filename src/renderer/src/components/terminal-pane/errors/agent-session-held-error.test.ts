import { describe, expect, it } from 'vitest'
import { formatAgentSessionHeldRefusal } from '../../../../../shared/agent-session/lifecycle/held-agent-session-refusal'
import { humanizeTerminalError, isExplainedTerminalError } from './terminal-error-display'
import { terminalTabTitleOfPty } from './agent-session-held-error'

const ipcWrapped = (message: string) =>
  `Error invoking remote method 'pty:spawn': Error: ${message}`

describe('held agent session refusal copy', () => {
  it('names the tab that holds the session instead of a raw PTY id', () => {
    const error = ipcWrapped(formatAgentSessionHeldRefusal('pty-holder', 'Saved title'))

    const shown = humanizeTerminalError(error, 'claude', undefined, (ptyId) =>
      ptyId === 'pty-holder' ? 'Z8 Features' : null
    )

    expect(shown).toBe(
      'This agent session is still running in the terminal "Z8 Features". Switch to that terminal instead of resuming the session again.'
    )
    expect(shown).not.toContain('pty-holder')
    expect(shown).not.toContain('agent_session_held_by_live_terminal')
    // Explained copy: no "report an issue" link.
    expect(isExplainedTerminalError(error)).toBe(true)
  })

  it("falls back to main's saved title, then to a terminal no tab shows", () => {
    expect(humanizeTerminalError(formatAgentSessionHeldRefusal('pty-holder', 'Saved title'))).toBe(
      'This agent session is still running in the terminal "Saved title". Switch to that terminal instead of resuming the session again.'
    )
    expect(humanizeTerminalError(ipcWrapped(formatAgentSessionHeldRefusal('pty-orphan')))).toBe(
      'This agent session is still running in a terminal that no tab shows. Run `orca terminal list` to find it, then switch to it or stop it instead of resuming the session again.'
    )
  })

  it('keeps the remote-pane note when an SSH or WSL holder could not be confirmed', () => {
    expect(
      humanizeTerminalError(ipcWrapped(formatAgentSessionHeldRefusal('pty-ssh', 'box', 'ssh')))
    ).toBe(
      'This agent session is still running in the terminal "box". Switch to that terminal instead of resuming the session again. That is a remote pane (SSH), so Orca cannot confirm its agent is still running; if it has exited, close that terminal and resume again.'
    )
    expect(humanizeTerminalError(formatAgentSessionHeldRefusal('pty-wsl', null, 'wsl'))).toContain(
      'That is a remote pane (WSL), so Orca cannot confirm'
    )
  })

  it('finds the tab whose tab or split leaf names the PTY', () => {
    const state = {
      tabsByWorktree: {
        'wt-1': [
          { id: 'tab-a', ptyId: 'pty-a', title: 'claude', customTitle: null },
          { id: 'tab-b', ptyId: 'pty-b1', title: 'claude', customTitle: ' Z8 Buzz ' }
        ]
      },
      terminalLayoutsByTabId: { 'tab-b': { ptyIdsByLeafId: { left: 'pty-b1', right: 'pty-b2' } } }
    }

    expect(terminalTabTitleOfPty(state, 'pty-a')).toBe('claude')
    expect(terminalTabTitleOfPty(state, 'pty-b2')).toBe('Z8 Buzz')
    expect(terminalTabTitleOfPty(state, 'pty-none')).toBeNull()
  })
})
