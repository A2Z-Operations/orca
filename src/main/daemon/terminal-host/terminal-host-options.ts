import type { PtyCreationDisposition } from '../../../shared/terminal/pty/lifecycle/pty-creation-disposition'
import type { StartupCommandDelivery } from '../../../shared/agent-launch/startup/codex-startup-delivery'
import type { TuiAgent } from '../../../shared/agent-launch/catalog/tui-agent'
import type { SubprocessHandle } from '../sessions/session-subprocess-handle'
import type { TakePendingOutputResult } from '../protocol/daemon-rpc-contract'
import type { TerminalSnapshot } from '../protocol/terminal-snapshot'
import type { TerminalSpawnGate } from '../admission/terminal-spawn-gate'

export type PaneCloseReason = 'close' | 'restart'

export type TerminalHostKillOptions = { immediate?: boolean; reason?: PaneCloseReason }

export type PaneOwnershipHooks = {
  noteClose: (sessionId: string, reason: PaneCloseReason) => void
  observeClose: (sessionId: string, reason: PaneCloseReason) => Promise<void>
  onRootExit: (sessionId: string) => void
  /** #44 (a): a new agent pane replaces `fromSessionId` at a restart (observe only; optional for older observers). */
  noteCarry?: (sessionId: string, fromSessionId: string) => void
}

export type TerminalHostOptions = {
  spawnSubprocess: (opts: {
    sessionId: string
    cols: number
    rows: number
    cwd?: string
    env?: Record<string, string>
    envToDelete?: string[]
    command?: string
    startupCommandDelivery?: StartupCommandDelivery
    launchAgent?: TuiAgent
    shellOverride?: string
    terminalShellArgs?: string[]
    terminalWindowsWslDistro?: string | null
    terminalWindowsPowerShellImplementation?: 'auto' | 'powershell.exe' | 'pwsh.exe'
    onCreationDisposition?: (disposition: PtyCreationDisposition) => void
    assertCreateAllowed?: () => void
    isCanceled?: () => boolean
    cancelSignal?: AbortSignal
  }) => SubprocessHandle | Promise<SubprocessHandle>
  // Login-session death detection needs exits even when no viewer is attached.
  onSessionReaped?: (sessionId: string) => void
  /** Use an injected file-log sink because detached daemon stdio is ignored. */
  reportReadinessEvent?: (event: string, details: Record<string, unknown>) => void
  // Finish shutdown checkpoints in-process before native teardown.
  onFinalCheckpoint?: (
    sessionId: string,
    snapshot: TerminalSnapshot,
    records: TakePendingOutputResult['records']
  ) => void
  /** Charged only on the branch that forks; attach and adoption never reach it. */
  spawnGate?: TerminalSpawnGate
  /**
   * Pane process ownership (#44), stage 2: OBSERVE ONLY. Told when an agent pane is closed, restarted or its agent exits,
   * after today's sweep; it never receives a way to signal, and the kill path never awaits it.
   */
  paneOwnership?: PaneOwnershipHooks
  // Allow deterministic eviction tests without creating thousands of sessions.
  maxTombstones?: number
}
