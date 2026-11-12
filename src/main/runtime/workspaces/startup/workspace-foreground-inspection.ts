import { OrcaRuntimeWithListManagedWorktrees } from '../managed-workspace-operations'
import type { TuiAgent } from '../../../../shared/agent-launch/catalog/tui-agent'
import type { HeldSessionPaneHost } from '../../../ipc/pty/pane/held-agent-session-foreground'
import {
  describeLaunchedAgentHost,
  readLaunchedAgentForeground,
  type LaunchedAgentForeground,
  type LaunchedAgentHost
} from '../../terminal/wait/launched-agent-foreground'

export abstract class OrcaRuntimeWithForegroundInspection extends OrcaRuntimeWithListManagedWorktrees {
  launchedAgentTerminalIdentity(ptyId: string): unknown {
    return this.ptysById.get(ptyId)
  }

  /** Read at the physical owner; discard a result that outlived this runtime binding. */
  async readLaunchedAgentForeground(
    ptyId: string,
    agent: TuiAgent
  ): Promise<LaunchedAgentForeground> {
    const pty = this.ptysById.get(ptyId)
    const incarnation = pty?.incarnationId
    const host = this.launchedAgentHost(ptyId)
    const result = await readLaunchedAgentForeground(
      this.ptyController,
      host,
      ptyId,
      agent,
      incarnation ?? undefined
    )
    return this.ptysById.get(ptyId) === pty && pty?.incarnationId === incarnation
      ? result
      : 'unknown'
  }

  /** Whether the pane's execution host can find a launched agent in front: a Windows one cannot. */
  launchedAgentHostProvesAgent(ptyId: string): boolean {
    return !this.launchedAgentHost(ptyId).windows
  }

  /**
   * Where a PTY's foreground is read for the held-session guard: an SSH pane through its relay, a WSL
   * pane inside its distro by its pane key, anything else here. Null when this runtime has no record.
   */
  heldSessionPaneHost(ptyId: string): HeldSessionPaneHost | null {
    const pty = this.ptysById.get(ptyId)
    if (!pty) {
      return null
    }
    if (pty.connectionId) {
      return { kind: 'ssh', agent: pty.launchAgent ?? pty.launchCommandAgent ?? 'claude' }
    }
    const distro = pty.wslDistro ?? this.wslDistroByPtyId.get(ptyId) ?? null
    return distro ? { kind: 'wsl', distro, paneKey: this.paneOfPty(pty).paneKey ?? null } : null
  }

  launchedAgentHostProvesShellAlone(ptyId: string): boolean {
    return this.launchedAgentHost(ptyId).shellAloneProvable
  }

  private launchedAgentHost(ptyId: string): LaunchedAgentHost {
    const pty = this.ptysById.get(ptyId)
    return describeLaunchedAgentHost(pty, () => this.pathFlavorForPty(pty))
  }
}
