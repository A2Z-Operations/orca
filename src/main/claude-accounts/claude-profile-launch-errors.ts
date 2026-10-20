import {
  CLAUDE_ACCOUNT_UNKNOWN_MESSAGE,
  CLAUDE_ACCOUNT_WSL_UNSUPPORTED_MESSAGE,
  CLAUDE_PROFILE_MISSING_MESSAGE,
  CLAUDE_PROFILE_SETUP_FAILED_MESSAGE
} from '../../shared/claude-profile-routing'
import { AgentSessionPreSpawnError } from '../native-chat/agent-session-wire/structured-agent-session-adapter'

// Typed so a chat names the situation; a terminal reads the same message.
export function claudeProfileMissing(): AgentSessionPreSpawnError {
  return new AgentSessionPreSpawnError(new Error(CLAUDE_PROFILE_MISSING_MESSAGE), {
    reason: 'claudeAccountFolderMissing'
  })
}

export function claudeProfileSetupFailed(): AgentSessionPreSpawnError {
  return new AgentSessionPreSpawnError(new Error(CLAUDE_PROFILE_SETUP_FAILED_MESSAGE), {
    reason: 'claudeAccountSetupFailed'
  })
}

// Why no reason: both are Orca bugs (a mover naming a bad id), which only the log reads.
export function claudeAccountUnknown(): AgentSessionPreSpawnError {
  return new AgentSessionPreSpawnError(new Error(CLAUDE_ACCOUNT_UNKNOWN_MESSAGE))
}

export function claudeAccountWslUnsupported(): AgentSessionPreSpawnError {
  return new AgentSessionPreSpawnError(new Error(CLAUDE_ACCOUNT_WSL_UNSUPPORTED_MESSAGE))
}
