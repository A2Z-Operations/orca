// What a PTY that a row says holds a session runs now, read the way its host allows: a local pane by
// its foreground name, an SSH pane by the relay's fenced foreground evidence, a WSL pane inside its
// distro by the processes that carry its pane key. Windows itself sees only `wsl.exe` for every WSL pane.

import type { TuiAgent } from '../../../../shared/agent-launch/catalog/tui-agent'
import {
  classifyWslGuestPaneForeground,
  type WslGuestProcessRow
} from '../../../persistence/moving-wsl-projects/wsl-move-guest-foreground'
import type { HolderForeground } from './held-agent-session-resume'

export type HeldSessionPaneHost =
  | { kind: 'local' }
  | { kind: 'ssh'; agent: TuiAgent }
  | { kind: 'wsl'; distro: string; paneKey: string | null }

export type HeldSessionForegroundReads = {
  paneHost: (ptyId: string) => HeldSessionPaneHost
  /** True only when a local PTY's foreground was read and is a bare shell. */
  localShowsBareShell: (ptyId: string) => Promise<boolean>
  /** The runtime's host-aware launched-agent read (relay evidence for SSH). */
  remoteForeground: (ptyId: string, agent: TuiAgent) => Promise<'agent' | 'shell' | 'unknown'>
  /** Every process in a distro with Orca's pane keys; null when it could not be read in full. Absent off Windows. */
  wslGuestRows?: (distro: string) => Promise<readonly WslGuestProcessRow[] | null>
}

export async function readHolderForeground(
  ptyId: string,
  reads: HeldSessionForegroundReads
): Promise<HolderForeground> {
  const host = reads.paneHost(ptyId)
  if (host.kind === 'local') {
    return (await reads.localShowsBareShell(ptyId).catch(() => false)) ? 'bare-shell' : 'not-shell'
  }
  if (host.kind === 'ssh') {
    const foreground = await reads
      .remoteForeground(ptyId, host.agent)
      .catch(() => 'unknown' as const)
    return foreground === 'shell'
      ? 'bare-shell'
      : foreground === 'agent'
        ? 'not-shell'
        : { unconfirmed: 'ssh' }
  }
  if (!host.paneKey || !reads.wslGuestRows) {
    return { unconfirmed: 'wsl' }
  }
  const paneKey = host.paneKey
  const rows = await reads.wslGuestRows(host.distro).catch(() => null)
  if (!rows) {
    return { unconfirmed: 'wsl' }
  }
  const guest = classifyWslGuestPaneForeground(rows, paneKey)
  return guest === 'shell-idle'
    ? 'bare-shell'
    : guest === 'unverifiable'
      ? { unconfirmed: 'wsl' }
      : 'not-shell'
}
