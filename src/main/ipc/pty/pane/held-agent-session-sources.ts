import { agentHookServer } from '../../../agent-hooks/server/agent-hook-server'
import { listClaudePaneAccounts } from '../../../claude-accounts/claude-pane-account-registry'
import type { OrcaRuntimeService } from '../../../runtime/orca-runtime'
import { getPtyIdForPaneKey } from './key-state'
import type { HeldAgentSessionSources } from './held-agent-session-resume'

/** The live agents' own reports, and the per-PTY session rows that cover a pane before its agent reports again. */
export function heldAgentSessionSources(
  runtime:
    | { getPtyLivenessVerdict?: OrcaRuntimeService['getPtyLivenessVerdict'] }
    | null
    | undefined
): HeldAgentSessionSources {
  return {
    providerSessionIdentities: () => agentHookServer.getProviderSessionIdentities(),
    ptyIdForPaneKey: getPtyIdForPaneKey,
    recordedPtySessions: listClaudePaneAccounts,
    isKnownExited: (ptyId) => runtime?.getPtyLivenessVerdict?.(ptyId)?.status === 'exited'
  }
}
