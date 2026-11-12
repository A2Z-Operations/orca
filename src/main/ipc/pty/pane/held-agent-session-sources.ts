import { agentHookServer } from '../../../agent-hooks/server/agent-hook-server'
import { listClaudePaneAccounts } from '../../../claude-accounts/claude-pane-account-registry'
import type { OrcaRuntimeService } from '../../../runtime/orca-runtime'
import type { WorkspaceSessionState } from '../../../../shared/workspace-session/workspace-session-state-types'
import { getPtyIdForPaneKey } from './key-state'
import type { HeldAgentSessionSources } from './held-agent-session-resume'

type HeldAgentSessionRuntime = Pick<
  OrcaRuntimeService,
  'getPtyLivenessVerdict' | 'ptyForegroundShowsBareShell'
>

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
    showsBareShell: async (ptyId) => (await runtime?.ptyForegroundShowsBareShell?.(ptyId)) === true,
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
