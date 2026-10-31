import { claudeProviderHandle } from '../../shared/agent-session-provider-handle-encoding'
import {
  AgentSessionAcquisitionExitUnprovenError,
  AgentSessionPreSpawnError,
  type StructuredAgentSessionAcquireInput
} from '../native-chat/agent-session-wire/structured-agent-session-adapter'
import { stopAgentSessionProviderRoot } from '../native-chat/agent-session-wire/structured-agent-session-provider-exit-proof'
import { withAgentSessionCreatePhase } from '../observability/agent-session-instrumentation'
import type { ClaudeStructuredLaunch } from './claude-structured-launch-resolution'
import {
  claudeStructuredSpawnOptions,
  type ClaudeStructuredSpawnOptions
} from './claude-structured-spawn-options'
import {
  getClaudePaneAccount,
  setClaudePaneModel
} from '../claude-accounts/claude-pane-account-registry'
import { claudePolicyModelLabel } from '../claude-accounts/claude-model-policy'
import { structuredClaudeSessionKey } from './claude-structured-session-key'
import {
  cancelClaudeAcquisitionAttempt,
  type ClaudeAcquisitionAttempt,
  type ClaudeAcquisitionRegistry,
  type ClaudeAcquireCallbacks,
  type ClaudeSession,
  type ClaudeSessionExit,
  type ClaudeStructuredSessionAdapterDeps
} from './structured/claude-structured-session-state'
import {
  claudeAcquisitionCleanupError,
  closeClaudePublishedSessionForDeps
} from './claude-structured-session-close'

export type ClaudeAcquisitionLaunch = ClaudeStructuredLaunch & {
  savedOptions: Omit<ClaudeStructuredSpawnOptions, 'sdkOptions'>
}

export async function resolveClaudeAcquisitionLaunch(args: {
  input: StructuredAgentSessionAcquireInput
  deps: ClaudeStructuredSessionAdapterDeps
  sessions: Map<string, ClaudeSession>
  acquisitions: ClaudeAcquisitionRegistry
  exits: Map<string, ClaudeSessionExit>
  callbacks: ClaudeAcquireCallbacks
  previous: ClaudeAcquisitionAttempt | undefined
  attempt: ClaudeAcquisitionAttempt
}): Promise<ClaudeAcquisitionLaunch> {
  const { input, deps, sessions, acquisitions, exits, callbacks, previous, attempt } = args
  const sessionId = input.identity.sessionId
  return withAgentSessionCreatePhase('auth_settle', input.recordPhase, async () => {
    if (previous && !(await cancelClaudeAcquisitionAttempt(previous))) {
      acquisitions.restoreIfCurrent(sessionId, attempt, previous)
      throw new AgentSessionAcquisitionExitUnprovenError(
        new Error(`claude acquisition for session ${sessionId} could not be stopped`)
      )
    }
    acquisitions.assertCurrent(sessionId, attempt)
    let resumeSession = sessions.get(sessionId)
    const closed = await stopAgentSessionProviderRoot(() =>
      closeClaudePublishedSessionForDeps(sessions, sessionId, deps)
    )
    if (!closed) {
      throw new AgentSessionAcquisitionExitUnprovenError(
        new Error(`claude session ${sessionId} could not be stopped`)
      )
    }
    const retainedExit = exits.get(sessionId)
    if (retainedExit) {
      const firstProof = retainedExit.closePromise ? await retainedExit.closePromise : false
      const proven = firstProof || (await retainedExit.connection.close().catch(() => false))
      if (!proven) {
        const cleanupError = claudeAcquisitionCleanupError(
          retainedExit.connection,
          retainedExit.error
        )
        // A proven root exit releases the lease even when descendant cleanup remains unverified.
        if (cleanupError instanceof AgentSessionAcquisitionExitUnprovenError) {
          throw cleanupError
        }
      }
      // Settle the old child before reusing its durable resume identity.
      await callbacks.settleExit(sessionId, retainedExit)
      resumeSession ??= retainedExit.session
    }
    acquisitions.assertCurrent(sessionId, attempt)
    const launchIdentity = resumeSession
      ? {
          ...input.identity,
          providerHandle: claudeProviderHandle(
            resumeSession.providerSessionId,
            resumeSession.turnEndLeafUuid
          )
        }
      : input.identity
    const launch = await deps
      .resolveLaunch({
        identity: launchIdentity,
        spawnToken: input.spawnToken,
        ...(input.permissionMode ? { permissionMode: input.permissionMode } : {})
      })
      .catch((error: unknown) => {
        throw error instanceof AgentSessionPreSpawnError
          ? error
          : new AgentSessionPreSpawnError(error)
      })
    acquisitions.assertCurrent(sessionId, attempt)
    const spawn = claudeStructuredSpawnOptions({ launch, saved: input.options })
    const savedModel = input.options?.model
    if (typeof savedModel === 'string' && savedModel.length > 0) {
      const sessionKey = structuredClaudeSessionKey(input.identity.sessionId)
      if (launch.env && getClaudePaneAccount(sessionKey)?.modelSource === 'policy') {
        delete launch.env.ANTHROPIC_MODEL
      }
      setClaudePaneModel(sessionKey, claudePolicyModelLabel(savedModel) ?? savedModel, 'pinned')
    }
    return {
      ...launch,
      options: spawn.sdkOptions,
      savedOptions: {
        options: spawn.options,
        fastModeAtStart: spawn.fastModeAtStart
      }
    }
  })
}
