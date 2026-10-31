import {
  claudePolicyModelForAccount,
  claudePoolAccountForLaunch
} from '../claude-accounts/claude-account-pool-launch'
import {
  getClaudeAuthProxy,
  releaseOwnClaudeAuthProxySlot
} from '../claude-accounts/claude-auth-proxy/claude-auth-proxy-host'
import { claudeAuthProxySlotId } from '../claude-accounts/claude-auth-proxy/claude-auth-proxy-url'
import type { ClaudeProfileRouter } from '../claude-accounts/claude-profile-router'
import type { ClaudeEnvPatch } from '../claude-accounts/environment'
import { claudeAccountIdFromProvenance } from '../ipc/pty/host-env/claude-pane-account'
import type { ClaudeRuntimeAuthPreparation } from '../claude-accounts/runtime-auth/runtime-auth-types'
import type { ClaudePaneAccountRecord } from '../claude-accounts/claude-pane-account-registry'

const HOST = { runtime: 'host' } as const

export type StructuredClaudePreparation = {
  preparation: ClaudeRuntimeAuthPreparation
  pooled: boolean
  /** Keep the spawn account already recorded for this chat. */
  keepRecordedAccount: boolean
  /** The recorded slot still belongs to this launch. A dead slot falls through to the new one. */
  reuseRecordedSlot: boolean
}

/** Managed account a preparation bills. System default names the selected account. */
export function structuredLaunchAccountId(
  provenance: string,
  selectedAccountId: string | null
): string | null {
  return claudeAccountIdFromProvenance(
    provenance,
    {},
    HOST,
    provenance === 'system' ? (selectedAccountId ?? undefined) : undefined
  )
}

export function preparedClaudeProxySlot(patch: ClaudeEnvPatch | undefined): string | undefined {
  const url = patch?.ANTHROPIC_BASE_URL
  if (!url) {
    return undefined
  }
  return claudeAuthProxySlotId(url) ?? undefined
}

/** Drop a slot this launch prepared and then did not put on the child. */
export function releasePreparedClaudeSlot(
  preparation: ClaudeRuntimeAuthPreparation,
  keep?: string
): void {
  const slot = preparedClaudeProxySlot(preparation.envPatch)
  if (slot && slot !== keep) {
    releaseOwnClaudeAuthProxySlot(slot)
  }
}

/**
 * Same account order as a PTY launch: a remembered move, then the recorded chat while the
 * selection is unchanged, then the pool, then the selected account. A user config dir skips the pool.
 */
export async function prepareStructuredClaudeAccount(input: {
  router: ClaudeProfileRouter
  existing: ClaudePaneAccountRecord | null
  providerSessionId: string | null
  allowPool: boolean
}): Promise<StructuredClaudePreparation> {
  const resumed = input.providerSessionId
    ? input.router.assignedAccountForResume(input.providerSessionId)
    : null
  if (resumed) {
    const billed = input.existing
      ? (input.existing.assignedAccountId ?? input.existing.accountId)
      : null
    return {
      preparation: attachPolicyModel(await input.router.prepareLaunchFor(resumed), resumed),
      pooled: false,
      keepRecordedAccount: billed === resumed,
      reuseRecordedSlot: Boolean(input.existing?.proxySlot) && billed === resumed
    }
  }
  if (input.existing && input.existing.launchSelectionId === input.router.selectedAccountId()) {
    return keepRecordedPreparation(input.router, input.existing)
  }
  if (input.existing) {
    const selected = await input.router.prepareLaunch()
    return finishFreshPreparation(input.router, input.allowPool, selected)
  }
  return finishFreshPreparation(input.router, input.allowPool, null)
}

/** The user did not switch accounts, so a pool pick and its slot stay with this chat. */
async function keepRecordedPreparation(
  router: ClaudeProfileRouter,
  existing: ClaudePaneAccountRecord
): Promise<StructuredClaudePreparation> {
  const selected = await router.prepareLaunch()
  const billed = existing.assignedAccountId ?? existing.accountId
  const selectedAccount = structuredLaunchAccountId(selected.provenance, router.selectedAccountId())
  if (selectedAccount === billed) {
    return {
      preparation: attachPolicyModel(selected, billed),
      pooled: existing.source === 'pool',
      keepRecordedAccount: true,
      reuseRecordedSlot: Boolean(existing.proxySlot)
    }
  }
  try {
    const preparation = await router.prepareLaunchFor(billed)
    releasePreparedClaudeSlot(selected)
    return {
      preparation: attachPolicyModel(preparation, billed),
      pooled: existing.source === 'pool',
      keepRecordedAccount: true,
      reuseRecordedSlot: Boolean(existing.proxySlot)
    }
  } catch (error) {
    console.warn(
      '[claude-account-pool] Could not keep the chat on its recorded account; using the selected account:',
      error
    )
    return {
      preparation: selected,
      pooled: false,
      keepRecordedAccount: false,
      reuseRecordedSlot: false
    }
  }
}

function attachPolicyModel(
  preparation: ClaudeRuntimeAuthPreparation,
  accountId: string | null
): ClaudeRuntimeAuthPreparation {
  if (preparation.policyModel || !accountId) {
    return preparation
  }
  const choice = claudePolicyModelForAccount(accountId)
  if (!choice || choice.reason === 'off') {
    return preparation
  }
  return {
    ...preparation,
    policyModel: { model: choice.model, modelId: choice.modelId, reason: choice.reason }
  }
}

function withPoolModel(
  preparation: ClaudeRuntimeAuthPreparation,
  pool: ReturnType<typeof claudePoolAccountForLaunch>,
  accountId: string | null
): ClaudeRuntimeAuthPreparation {
  if (pool?.model && pool.modelId) {
    return {
      ...preparation,
      policyModel: {
        model: pool.model,
        modelId: pool.modelId,
        reason: pool.modelReason ?? pool.model
      }
    }
  }
  return attachPolicyModel(preparation, accountId)
}

async function finishFreshPreparation(
  router: ClaudeProfileRouter,
  allowPool: boolean,
  selected: ClaudeRuntimeAuthPreparation | null
): Promise<StructuredClaudePreparation> {
  const pool = allowPool ? claudePoolAccountForLaunch(HOST) : null
  if (pool?.named) {
    try {
      const prepared = await router.prepareLaunchFor(pool.accountId)
      if (selected) {
        releasePreparedClaudeSlot(selected)
      }
      return {
        preparation: withPoolModel(prepared, pool, pool.accountId),
        pooled: pool.pooled !== false,
        keepRecordedAccount: false,
        reuseRecordedSlot: false
      }
    } catch (error) {
      console.warn(
        '[claude-account-pool] Could not launch the pooled account; using the selected account:',
        error
      )
    }
  }
  const preparation = selected ?? (await router.prepareLaunch())
  const accountId = structuredLaunchAccountId(preparation.provenance, router.selectedAccountId())
  return {
    preparation: withPoolModel(preparation, pool, accountId),
    pooled: Boolean(pool && !pool.named && pool.pooled !== false),
    keepRecordedAccount: false,
    reuseRecordedSlot: false
  }
}

/**
 * Put this chat's slot URL on the child. A user base URL wins and the unused slot is released.
 * A second resolution of the same chat reuses the recorded slot instead of taking another one.
 */
export function applyStructuredClaudeProxySlot(input: {
  env: Record<string, string>
  preparation: ClaudeRuntimeAuthPreparation
  existing: ClaudePaneAccountRecord | null
  reuseRecordedSlot: boolean
  userPinnedUrl: boolean
}): string | undefined {
  const fresh = preparedClaudeProxySlot(input.preparation.envPatch)
  if (input.userPinnedUrl) {
    if (fresh) {
      releaseOwnClaudeAuthProxySlot(fresh)
    }
    return undefined
  }
  const recorded = input.reuseRecordedSlot ? input.existing?.proxySlot : undefined
  if (recorded) {
    const reused = getClaudeAuthProxy()?.slotBaseUrl(recorded) ?? null
    if (reused) {
      if (fresh && fresh !== recorded) {
        releaseOwnClaudeAuthProxySlot(fresh)
      }
      input.env.ANTHROPIC_BASE_URL = reused
      return recorded
    }
  }
  return fresh
}
