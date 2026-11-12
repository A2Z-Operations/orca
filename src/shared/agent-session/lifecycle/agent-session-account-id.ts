import {
  isLegacyAgentSessionAccountHome,
  type AgentSessionAccountHome
} from './agent-session-account-home'

/** A managed Claude home is `<data root>/claude-profiles/<account id>/home` in the host's path syntax. */
const CLAUDE_PROFILE_HOME = /[\\/]claude-profiles[\\/]([A-Za-z0-9_-]{1,128})[\\/]home[\\/]*$/

/** The managed account whose folder a Claude chat's home names. Undefined: System default, another
 *  agent, or a home Orca did not make. Whether the account still exists is the reader's question. */
export function agentSessionManagedAccountId(
  provider: string,
  home: AgentSessionAccountHome
): string | undefined {
  if (provider !== 'claude' || !isLegacyAgentSessionAccountHome(home)) {
    return undefined
  }
  return CLAUDE_PROFILE_HOME.exec(home.path)?.[1]
}
