import { join } from 'node:path'
import { claudeAuthProxyListeningPort } from '../../../claude-accounts/claude-auth-proxy/claude-auth-proxy-host'
import {
  claudeAuthProxySlotId,
  isForeignClaudeAuthProxyUrl
} from '../../../claude-accounts/claude-auth-proxy/claude-auth-proxy-url'
import type { ClaudeProfileRouter } from '../../../claude-accounts/claude-profile-router'
import { applyClaudeEnvPatch } from '../../../claude-accounts/environment'
import { resolveClaudeLaunchModel } from '../../../claude-accounts/claude-model-policy-launch'
import type { ClaudeRuntimeAuthPreparation } from '../../../claude-accounts/runtime-auth/runtime-auth-types'
import {
  forgetClaudePaneAccount,
  getClaudePaneAccount,
  recordClaudePaneAccount
} from '../../../claude-accounts/claude-pane-account-registry'
import { AgentSessionPreSpawnError } from '../../../native-chat/agent-session-wire/providers/structured-agent-session-adapter-errors'
import { resolveSessionFilePath } from '../../../native-chat/session-file-resolver'
import { resolveStructuredClaudeAccountHomePath } from '../../../runtime/agent-session/environment/structured-agent-account-home'
import type { ClaudeAccountRecipe } from '../../../../shared/agent-session/lifecycle/agent-session-acquired-account'
import {
  applyStructuredClaudeProxySlot,
  prepareStructuredClaudeAccount,
  preparedClaudeProxySlot,
  releasePreparedClaudeSlot,
  structuredLaunchAccountId
} from '../../claude-structured-pane-account'
import { structuredClaudeSessionKey } from '../../claude-structured-session-key'
import { pinStructuredClaudeLaunchModel } from '../../claude-structured-launch-model'

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
  return (await prepareClaudeStructuredLaunchAccount(router, env, recordHome, session)).home
}

/** A chat launch: the account (pool, proxy slot, registry row) and the model it pins or the policy chose. */
export async function prepareClaudeLaunch(
  router: ClaudeProfileRouter | undefined,
  env: Record<string, string>,
  input: ClaudeStructuredLaunchSession & { recordHome: string; fixedModel: unknown }
): Promise<{ accountRecipe: ClaudeAccountRecipe; policyModelId?: string }> {
  const accountRecipe = await prepareClaudeStructuredLaunchAccount(
    router,
    env,
    input.recordHome,
    input
  )
  return {
    accountRecipe,
    ...pinStructuredClaudeLaunchModel(input.sessionId, input.fixedModel, env)
  }
}

/** The account a launch runs under; the receipt records what it used. A session also pins pool, proxy slot and registry row. */
export async function prepareClaudeStructuredLaunchAccount(
  router: ClaudeProfileRouter | undefined,
  env: Record<string, string>,
  recordHome: string,
  session?: ClaudeStructuredLaunchSession
): Promise<ClaudeAccountRecipe> {
  if (!router) {
    return { route: 'system', home: recordHome, configDir: env.CLAUDE_CONFIG_DIR ?? null }
  }
  // Why no folder pin: upstream strips inherited CLAUDE_CONFIG_DIR before a launch, so the router's
  // selection owns the home; System default still honours the env folder through the router.
  dropForeignProxyUrl(env)
  const userPinnedUrl = Boolean(
    env.ANTHROPIC_BASE_URL && claudeAuthProxySlotId(env.ANTHROPIC_BASE_URL) === null
  )
  if (!session) {
    const preparation = await router.prepareLaunch()
    const launchHome = await pinClaudeLaunchHome(router, env, preparation)
    releasePreparedClaudeSlot(
      preparation,
      preparedClaudeProxySlot({ ANTHROPIC_BASE_URL: env.ANTHROPIC_BASE_URL })
    )
    return accountRecipe(preparation.provenance, launchHome, env)
  }
  const sessionKey = structuredClaudeSessionKey(session.sessionId)
  const existing = getClaudePaneAccount(sessionKey)
  const chosen = await prepareStructuredClaudeAccount({
    router,
    existing,
    providerSessionId: session.providerSessionId,
    // The pool still chooses when only the base URL is pinned.
    allowPool: true
  })
  const launchHome = await pinClaudeLaunchHome(router, env, chosen.preparation)
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
    return accountRecipe(chosen.preparation.provenance, launchHome, env)
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
    pinned: userPinnedUrl,
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
  return accountRecipe(chosen.preparation.provenance, launchHome, env)
}

function accountRecipe(
  provenance: string,
  home: string,
  env: Record<string, string>
): ClaudeAccountRecipe {
  return provenance.startsWith('profile:')
    ? { route: 'managed', accountId: provenance.slice('profile:'.length), home }
    : { route: 'system', home, configDir: env.CLAUDE_CONFIG_DIR ?? null }
}

function dropForeignProxyUrl(env: Record<string, string>): void {
  const url = env.ANTHROPIC_BASE_URL
  if (url && isForeignClaudeAuthProxyUrl(url, claudeAuthProxyListeningPort())) {
    delete env.ANTHROPIC_BASE_URL
  }
}

async function pinClaudeLaunchHome(
  router: ClaudeProfileRouter,
  env: Record<string, string>,
  preparation: ClaudeRuntimeAuthPreparation
): Promise<string> {
  // Read before patching: System default preserves the launch environment's CLAUDE_CONFIG_DIR.
  const launchHome =
    preparation.provenance === 'system'
      ? await resolveStructuredClaudeAccountHomePath({
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
  return launchHome
}

async function claudeTranscriptExists(input: {
  providerSessionId: string
  claudeConfigDir: string
  cwd?: string
}): Promise<boolean> {
  const path = await resolveSessionFilePath('claude', input.providerSessionId, {
    claudeProjectsDir: join(input.claudeConfigDir, 'projects'),
    cwd: input.cwd
  })
  return path !== null
}

/** A stored leaf implies resume; refuse known history in another account instead of starting fresh. */
export async function claudeLaunchResumesTranscript(input: {
  router: ClaudeProfileRouter | undefined
  leafUuid: string | null
  providerSessionId: string
  claudeConfigDir: string
  recordHome: string
  /** The launch cwd; Claude keeps its transcript in this folder's project bucket. */
  cwd?: string
  hasTranscript?: typeof claudeTranscriptExists
}): Promise<boolean> {
  const { router, providerSessionId, claudeConfigDir, cwd } = input
  if (!router && input.leafUuid !== null) {
    return true
  }
  const hasTranscript = input.hasTranscript ?? claudeTranscriptExists
  if (await hasTranscript({ providerSessionId, claudeConfigDir, cwd })) {
    return true
  }
  if (input.leafUuid === null) {
    return false
  }
  const otherHomes = router
    ? [input.recordHome, ...router.accountHomes(), router.systemDefaultHome()]
    : []
  for (const home of otherHomes.filter((home) => home !== claudeConfigDir)) {
    if (await hasTranscript({ providerSessionId, claudeConfigDir: home, cwd })) {
      throw new AgentSessionPreSpawnError(
        new Error('claude transcript is not in the selected account'),
        { reason: 'historyInOtherAccount' }
      )
    }
  }
  // A stored leaf still requires resume when its transcript folder is no longer known.
  return true
}
