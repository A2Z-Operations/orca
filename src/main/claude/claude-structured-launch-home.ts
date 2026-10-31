import { join } from 'node:path'
import { claudeAuthProxyListeningPort } from '../claude-accounts/claude-auth-proxy/claude-auth-proxy-host'
import {
  claudeAuthProxySlotId,
  isForeignClaudeAuthProxyUrl
} from '../claude-accounts/claude-auth-proxy/claude-auth-proxy-url'
import type { ClaudeProfileRouter } from '../claude-accounts/claude-profile-router'
import { applyClaudeEnvPatch } from '../claude-accounts/environment'
import { resolveClaudeLaunchModel } from '../claude-accounts/claude-model-policy-launch'
import type { ClaudeRuntimeAuthPreparation } from '../claude-accounts/runtime-auth/runtime-auth-types'
import {
  forgetClaudePaneAccount,
  getClaudePaneAccount,
  recordClaudePaneAccount
} from '../claude-accounts/claude-pane-account-registry'
import { AgentSessionPreSpawnError } from '../native-chat/agent-session-wire/structured-agent-session-adapter'
import { resolveSessionFilePath } from '../native-chat/session-file-resolver'
import { resolveStructuredClaudeAccountHomePath } from '../runtime/structured-agent-account-home'
import {
  applyStructuredClaudeProxySlot,
  prepareStructuredClaudeAccount,
  preparedClaudeProxySlot,
  releasePreparedClaudeSlot,
  structuredLaunchAccountId
} from './claude-structured-pane-account'
import { structuredClaudeSessionKey } from './claude-structured-session-key'

export type ClaudeStructuredLaunchSession = {
  sessionId: string
  providerSessionId: string
  workspaceId?: string
}

/** Follow the current account selection and pin its environment for this launch. */
export async function resolveClaudeStructuredLaunchHome(
  router: ClaudeProfileRouter | undefined,
  env: Record<string, string>,
  recordHome: string,
  session?: ClaudeStructuredLaunchSession
): Promise<string> {
  if (!router) {
    return recordHome
  }
  const userDir = env.CLAUDE_CONFIG_DIR?.trim() || undefined
  dropForeignProxyUrl(env)
  const userPinnedUrl = Boolean(
    env.ANTHROPIC_BASE_URL && claudeAuthProxySlotId(env.ANTHROPIC_BASE_URL) === null
  )
  if (!session) {
    const preparation = await router.prepareLaunch()
    const launchHome = pinClaudeLaunchHome(router, env, preparation, userDir)
    releasePreparedClaudeSlot(
      preparation,
      preparedClaudeProxySlot({ ANTHROPIC_BASE_URL: env.ANTHROPIC_BASE_URL })
    )
    return launchHome
  }
  const sessionKey = structuredClaudeSessionKey(session.sessionId)
  const existing = getClaudePaneAccount(sessionKey)
  const chosen = await prepareStructuredClaudeAccount({
    router,
    existing,
    providerSessionId: session.providerSessionId,
    // A folder the user set is the launch. The pool still chooses when only the base URL is pinned.
    allowPool: !userDir
  })
  const launchHome = pinClaudeLaunchHome(router, env, chosen.preparation, userDir)
  const proxySlot = applyStructuredClaudeProxySlot({
    env,
    preparation: chosen.preparation,
    existing,
    reuseRecordedSlot: chosen.reuseRecordedSlot && !userPinnedUrl,
    userPinnedUrl
  })
  const accountId = structuredLaunchAccountId(
    chosen.preparation.provenance,
    router.selectedAccountId()
  )
  if (!accountId) {
    if (proxySlot) {
      releasePreparedClaudeSlot(chosen.preparation)
    }
    forgetClaudePaneAccount(sessionKey)
    return launchHome
  }
  const recorded = chosen.keepRecordedAccount ? existing : null
  const billed = recorded ? (recorded.assignedAccountId ?? recorded.accountId) : accountId
  recordClaudePaneAccount({
    ptyId: sessionKey,
    paneKey: sessionKey,
    surface: 'chat',
    launchSelectionId: router.selectedAccountId(),
    accountId: recorded ? recorded.accountId : accountId,
    configDir: launchHome,
    launchedAt: recorded?.launchedAt ?? Date.now(),
    pinned: Boolean(userDir) || userPinnedUrl,
    source: chosen.pooled ? 'pool' : recorded ? recorded.source : 'spawn',
    ...(chosen.preparation.appliedModel
      ? {
          model: chosen.preparation.appliedModel.model,
          modelSource: chosen.preparation.appliedModel.modelSource
        }
      : {}),
    providerSessionId: session.providerSessionId,
    ...(session.workspaceId || recorded?.worktreeId
      ? { worktreeId: session.workspaceId ?? recorded?.worktreeId }
      : {}),
    ...(proxySlot || chosen.pooled || recorded?.assignedAccountId
      ? {
          ...(proxySlot ? { proxySlot } : {}),
          assignedAccountId: billed
        }
      : {})
  })
  return launchHome
}

function dropForeignProxyUrl(env: Record<string, string>): void {
  const url = env.ANTHROPIC_BASE_URL
  if (url && isForeignClaudeAuthProxyUrl(url, claudeAuthProxyListeningPort())) {
    delete env.ANTHROPIC_BASE_URL
  }
}

function pinClaudeLaunchHome(
  router: ClaudeProfileRouter,
  env: Record<string, string>,
  preparation: ClaudeRuntimeAuthPreparation,
  userDir: string | undefined
): string {
  // Read before patching: System default preserves the launch environment's CLAUDE_CONFIG_DIR.
  const launchHome =
    preparation.provenance === 'system'
      ? resolveStructuredClaudeAccountHomePath({
          launchEnv: env,
          wslDistro: null,
          getClaudeConfigDirectory: () => router.systemDefaultHome()
        })
      : preparation.configDir
  const applied = resolveClaudeLaunchModel({
    env,
    policy: preparation.policyModel ?? null
  })
  applyClaudeEnvPatch(env, preparation.envPatch)
  if (applied) {
    preparation.appliedModel = { model: applied.model, modelSource: applied.modelSource }
    if (applied.inject) {
      env.ANTHROPIC_MODEL = applied.inject
    }
  }
  if (userDir) {
    env.CLAUDE_CONFIG_DIR = userDir
    return userDir
  }
  return launchHome
}

async function claudeTranscriptExists(input: {
  providerSessionId: string
  claudeConfigDir: string
}): Promise<boolean> {
  const path = await resolveSessionFilePath('claude', input.providerSessionId, {
    claudeProjectsDir: join(input.claudeConfigDir, 'projects')
  })
  return path !== null
}

/** A stored leaf implies resume; refuse known history in another account instead of starting fresh. */
export async function claudeLaunchResumesTranscript(input: {
  router: ClaudeProfileRouter | undefined
  leafUuid: string | null
  providerSessionId: string
  claudeConfigDir: string
  hasTranscript?: typeof claudeTranscriptExists
}): Promise<boolean> {
  const { router, providerSessionId, claudeConfigDir } = input
  if (!router && input.leafUuid !== null) {
    return true
  }
  const hasTranscript = input.hasTranscript ?? claudeTranscriptExists
  if (await hasTranscript({ providerSessionId, claudeConfigDir })) {
    return true
  }
  if (input.leafUuid === null) {
    return false
  }
  const otherHomes = router ? [...router.accountHomes(), router.systemDefaultHome()] : []
  for (const home of otherHomes.filter((home) => home !== claudeConfigDir)) {
    if (await hasTranscript({ providerSessionId, claudeConfigDir: home })) {
      throw new AgentSessionPreSpawnError(
        new Error('claude transcript is not in the selected account'),
        { reason: 'historyInOtherAccount' }
      )
    }
  }
  // A stored leaf still requires resume when its transcript folder is no longer known.
  return true
}
