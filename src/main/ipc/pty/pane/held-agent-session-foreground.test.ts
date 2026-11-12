import { describe, expect, it, vi } from 'vitest'
import type { WslGuestProcessRow } from '../../../persistence/moving-wsl-projects/wsl-move-guest-foreground'
import {
  readHolderForeground,
  type HeldSessionForegroundReads,
  type HeldSessionPaneHost
} from './held-agent-session-foreground'
import {
  formatAgentSessionHeldRefusal,
  parseAgentSessionHeldRefusal
} from '../../../../shared/agent-session/lifecycle/held-agent-session-refusal'

const PANE = 'tab-a:leaf-a'

function reads(
  host: HeldSessionPaneHost,
  overrides: Partial<HeldSessionForegroundReads> = {}
): HeldSessionForegroundReads {
  return {
    paneHost: () => host,
    localShowsBareShell: async () => false,
    remoteForeground: async () => 'unknown',
    ...overrides
  }
}

function guestRow(row: Partial<WslGuestProcessRow> & Pick<WslGuestProcessRow, 'pid' | 'comm'>) {
  return { ppid: 1, sid: 100, argc: 1, paneKey: PANE, ...row }
}

describe('readHolderForeground', () => {
  it('reads a local pane by its foreground name, as before', async () => {
    await expect(
      readHolderForeground(
        'pty',
        reads({ kind: 'local' }, { localShowsBareShell: async () => true })
      )
    ).resolves.toBe('bare-shell')
    await expect(readHolderForeground('pty', reads({ kind: 'local' }))).resolves.toBe('not-shell')
    // A local pane is never "remote, cannot confirm": an unread one simply holds.
    await expect(
      readHolderForeground(
        'pty',
        reads({ kind: 'local' }, { localShowsBareShell: () => Promise.reject(new Error('gone')) })
      )
    ).resolves.toBe('not-shell')
  })

  it("reads an SSH pane through the runtime's relay check for the agent it launched", async () => {
    const remoteForeground = vi.fn(async () => 'shell' as const)
    await expect(
      readHolderForeground('pty-ssh', reads({ kind: 'ssh', agent: 'codex' }, { remoteForeground }))
    ).resolves.toBe('bare-shell')
    expect(remoteForeground).toHaveBeenCalledWith('pty-ssh', 'codex')

    await expect(
      readHolderForeground(
        'pty-ssh',
        reads({ kind: 'ssh', agent: 'claude' }, { remoteForeground: async () => 'agent' })
      )
    ).resolves.toBe('not-shell')
  })

  it('names an SSH pane the relay cannot read as unconfirmed', async () => {
    await expect(
      readHolderForeground('pty-ssh', reads({ kind: 'ssh', agent: 'claude' }))
    ).resolves.toEqual({ unconfirmed: 'ssh' })
    await expect(
      readHolderForeground(
        'pty-ssh',
        reads(
          { kind: 'ssh', agent: 'claude' },
          { remoteForeground: () => Promise.reject(new Error('relay detached')) }
        )
      )
    ).resolves.toEqual({ unconfirmed: 'ssh' })
  })

  it('reads a WSL pane inside its distro: an idle shell does not hold the session', async () => {
    const wslGuestRows = vi.fn(async () => [guestRow({ pid: 10, comm: 'bash' })])
    await expect(
      readHolderForeground(
        'pty-wsl',
        reads({ kind: 'wsl', distro: 'Ubuntu', paneKey: PANE }, { wslGuestRows })
      )
    ).resolves.toBe('bare-shell')
    expect(wslGuestRows).toHaveBeenCalledWith('Ubuntu')
  })

  it('counts a WSL pane whose shell still runs its agent as holding', async () => {
    const rows = [
      guestRow({ pid: 10, comm: 'bash' }),
      guestRow({ pid: 11, ppid: 10, comm: 'claude', argc: 3 })
    ]
    await expect(
      readHolderForeground(
        'pty-wsl',
        reads({ kind: 'wsl', distro: 'Ubuntu', paneKey: PANE }, { wslGuestRows: async () => rows })
      )
    ).resolves.toBe('not-shell')
  })

  it('names a WSL pane as unconfirmed when its distro, pane key or shell cannot be read', async () => {
    const wsl = { kind: 'wsl', distro: 'Ubuntu', paneKey: PANE } as const
    // Off Windows, or no guest read wired.
    await expect(readHolderForeground('pty-wsl', reads(wsl))).resolves.toEqual({
      unconfirmed: 'wsl'
    })
    await expect(
      readHolderForeground(
        'pty-wsl',
        reads({ ...wsl, paneKey: null }, { wslGuestRows: async () => [] })
      )
    ).resolves.toEqual({ unconfirmed: 'wsl' })
    await expect(
      readHolderForeground('pty-wsl', reads(wsl, { wslGuestRows: async () => null }))
    ).resolves.toEqual({ unconfirmed: 'wsl' })
    // No shell carries the pane key.
    await expect(
      readHolderForeground(
        'pty-wsl',
        reads(wsl, {
          wslGuestRows: async () => [guestRow({ pid: 10, comm: 'bash', paneKey: 'x' })]
        })
      )
    ).resolves.toEqual({ unconfirmed: 'wsl' })
  })
})

describe('unconfirmed remote refusal line', () => {
  it('still names the holder, and says which remote pane could not be confirmed', () => {
    const titled = formatAgentSessionHeldRefusal('pty-ssh', 'box', 'ssh')
    expect(titled).toContain('(remote pane, cannot confirm: SSH)')
    expect(parseAgentSessionHeldRefusal(titled)).toEqual({
      holderPtyId: 'pty-ssh',
      holderTitle: 'box',
      unconfirmed: 'ssh'
    })
    expect(
      parseAgentSessionHeldRefusal(formatAgentSessionHeldRefusal('pty-wsl', null, 'wsl'))
    ).toEqual({ holderPtyId: 'pty-wsl', holderTitle: null, unconfirmed: 'wsl' })
    expect(parseAgentSessionHeldRefusal(formatAgentSessionHeldRefusal('pty-a', 'A'))).toEqual({
      holderPtyId: 'pty-a',
      holderTitle: 'A',
      unconfirmed: null
    })
  })
})
