import type { DaemonFileLog } from '../observability/daemon-file-log'
import type { TerminalHostOptions } from '../terminal-host/terminal-host-options'
import type { TerminalSpawnAdmissionMode } from '../admission/terminal-spawn-admission-mode'
import type { HostTerminalPolicy } from '../admission/host-terminal-policy'

export type DaemonServerOptions = {
  /**
   * Pane process ownership (#44), stage 2, observe only: where its log lines go and the one-word mode file
   * (`off` / `observe`; missing or unknown = observe). Absent: no sampler (direct-construction tests).
   */
  paneOwnership?: {
    log: (event: string, details: Record<string, unknown>) => void
    modeFilePath: string | null
  }
  socketPath: string
  tokenPath: string
  pidPath?: string
  launchNonce?: string
  startedAtMs?: number
  publishEndpointOwnership?: () => void
  entryPath?: string
  appVersion?: string
  spawnerExecPath?: string
  protocolVersion?: number
  onIdleShutdown?: () => void
  onRpcShutdown?: () => void
  onShutdownRequested?: () => void
  initialAdoptionTestConfig?: {
    timeoutMs: number
    clock: {
      setTimeout(callback: () => void, delayMs: number): unknown
      clearTimeout(handle: unknown): void
      now(): number
    }
  }
  ptySpawnHealthCheck?: () => Promise<void>
  preparePtySpawn?: () => Promise<void>
  onPtySessionExit?: (sessionId: string) => void
  onAuthenticatedClientPair?: () => void
  log?: DaemonFileLog
  /** Headless hosts enforce; desktop only observes until the client handles deferral. */
  spawnAdmission?: TerminalSpawnAdmissionMode
  /** Crash-recovery state for automatic restores. */
  automaticWorkMarkerPath?: string
  /** Shared terminal counts for the host-wide cap. */
  hostTerminalLedgerDir?: string
  terminalLimitPolicy?: HostTerminalPolicy
  spawnSubprocess: TerminalHostOptions['spawnSubprocess']
}
