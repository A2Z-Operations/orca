import { agentHookServer } from '../../../agent-hooks/server/agent-hook-server'
import { listClaudePaneAccounts } from '../../../claude-accounts/claude-pane-account-registry'
import type { OrcaRuntimeService } from '../../../runtime/orca-runtime'
import type { WorkspaceSessionState } from '../../../../shared/workspace-session/workspace-session-state-types'
import { readWslGuestProcessTable } from '../../../wsl/execution/wsl-guest-process-table'
import { LOCAL_EXECUTION_HOST_ID } from '../../../../shared/execution-host'
import { resolvePtyExecutionHost } from '../provider/registry'
import { getPtyIdForPaneKey, ptyPaneKey } from './key-state'
import type { HeldAgentSessionSources } from './held-agent-session-resume'
import { readHolderForeground, type HeldSessionPaneHost } from './held-agent-session-foreground'

type HeldAgentSessionRuntime = Pick<
  OrcaRuntimeService,
  | 'getPtyLivenessVerdict'
  | 'ptyForegroundShowsBareShell'
  | 'heldSessionPaneHost'
  | 'readLaunchedAgentForeground'
>

/** The runtime's record first; an id that names another host is an SSH pane even before it is recorded. */
function paneHostOf(
  runtime: Partial<HeldAgentSessionRuntime> | null | undefined,
  ptyId: string
): HeldSessionPaneHost {
  const recorded = runtime?.heldSessionPaneHost?.(ptyId)
  if (recorded) {
    // The window's pane key is fresher than the runtime's before a relaunch reopens the pane.
    return recorded.kind === 'wsl'
      ? { ...recorded, paneKey: ptyPaneKey.get(ptyId) ?? recorded.paneKey }
      : recorded
  }
  return resolvePtyExecutionHost(ptyId) === LOCAL_EXECUTION_HOST_ID
    ? { kind: 'local' }
    : { kind: 'ssh', agent: 'claude' }
}

/** The live agents' own reports, and the per-PTY session rows that cover a pane before its agent reports again. */
export function heldAgentSessionSources(
  runtime: Partial<HeldAgentSessionRuntime> | null | undefined,
  store?: { getWorkspaceSession?: () => WorkspaceSessionState | null | undefined } | null
): HeldAgentSessionSources {
  return {
    providerSessionIdentities: () => agentHookServer.getProviderSessionIdentities(),
    ptyIdForPaneKey: getPtyIdForPaneKey,
    recordedPtySessions: listClaudePaneAccounts,
    isKnownExited: (ptyId) => runtime?.getPtyLivenessVerdict?.(ptyId)?.status === 'exited',
    readForeground: (ptyId) =>
      readHolderForeground(ptyId, {
        paneHost: (id) => paneHostOf(runtime, id),
        localShowsBareShell: async (id) =>
          (await runtime?.ptyForegroundShowsBareShell?.(id)) === true,
        remoteForeground: async (id, agent) =>
          (await runtime?.readLaunchedAgentForeground?.(id, agent)) ?? 'unknown',
        // Windows sees only wsl.exe for a WSL pane; its processes are read inside the distro.
        ...(process.platform === 'win32' ? { wslGuestRows: readWslGuestProcessTable } : {})
      }),
    holderTitle: (ptyId) => savedTabTitleOfPty(store?.getWorkspaceSession?.(), ptyId)
  }
}

function savedTabTitleOfPty(
  session: WorkspaceSessionState | null | undefined,
  ptyId: string
): string | null {
  if (!session) {
    return null
  }
  for (const tabs of Object.values(session.tabsByWorktree ?? {})) {
    for (const tab of tabs) {
      const leaves = session.terminalLayoutsByTabId?.[tab.id]?.ptyIdsByLeafId ?? {}
      if (tab.ptyId === ptyId || Object.values(leaves).includes(ptyId)) {
        return tab.customTitle?.trim() || tab.title?.trim() || null
      }
    }
  }
  return null
}
