import type { GlobalSettings } from '../../../../shared/global-settings-types'
import {
  forgetClaudePaneAccount,
  getClaudePaneAccount,
  recordClaudePaneAccount
} from '../../../claude-accounts/claude-pane-account-registry'
import { claudePaneAccountPersistence } from '../../../claude-accounts/claude-pane-account-persistence'
import { getClaudeAuthProxy } from '../../../claude-accounts/claude-auth-proxy/claude-auth-proxy-host'
import type { ClaudeEnvPatch } from '../../../claude-accounts/environment'
import type { ClaudeRuntimeAuthPreparation } from '../../../claude-accounts/runtime-auth-service'
import {
  getSelectedClaudeAccountIdForTarget,
  type ClaudeAccountSelectionTarget
} from '../../../claude-accounts/runtime-selection'
import {
  proxySlotFromUrl,
  readProcessAnthropicBaseUrl,
  recoverReattachedProxySlot,
  type ReattachSlotProxy
} from './claude-pane-proxy-slot-recovery'

const REJECTED_PROFILE_IDS = new Set(['unavailable', 'undefined', 'null'])

type ClaudePaneAccountSettings = Partial<
  Pick<GlobalSettings, 'activeClaudeManagedAccountId' | 'activeClaudeManagedAccountIdsByRuntime'>
>

/**
 * `profile:<id>` (or `profile:<id>:wsl:<distro>`) names the account; `system` (or `wsl:<distro>:system`) means System default,
 * which runs the named account when supplied, otherwise the selected account; anything else names no managed account.
 */
export function claudeAccountIdFromProvenance(
  provenance: string,
  settings: ClaudePaneAccountSettings | undefined,
  target: ClaudeAccountSelectionTarget,
  claudeAccountId?: string
): string | null {
  if (provenance.startsWith('profile:')) {
    const id = provenance.split(':')[1]
    // Why: upstream builds `profile:${profile?.accountId}`, so a missing id arrives as '' or the
    // literal 'undefined' / 'null'; none of those names an account.
    return id && !REJECTED_PROFILE_IDS.has(id) ? id : null
  }
  // Why: a System-default pane consumes the quota of the account System default covers, because
  // that login IS the account's; record that account, not "no account".
  // Why WSL too: a WSL System-default pane (`wsl:<distro>:system`) runs the selected WSL account the
  // same way the host one does; the caller's target is that WSL runtime.
  if (provenance === 'system' && claudeAccountId !== undefined) {
    return claudeAccountId
  }
  if (provenance === 'system' || /^wsl:[^:]+:system$/.test(provenance)) {
    return getSelectedClaudeAccountIdForTarget(settings ?? {}, target)
  }
  return null
}

/** Slot id from `http://127.0.0.1:<port>/p/<slot>/`. A trailing slash is required for URL joining. */
function proxySlotFromBaseUrl(envPatch: ClaudeEnvPatch): string | undefined {
  const base = envPatch.ANTHROPIC_BASE_URL
  if (!base) {
    return undefined
  }
  try {
    return new URL(base).pathname.match(/^\/p\/([^/]+)\/?$/)?.[1]
  } catch {
    return undefined
  }
}

type ReattachSources = {
  pid?: number | null
  /** Defaults to the live listener. Tests pass a fake. */
  proxy?: ReattachSlotProxy | null
  /** Defaults to reading the process environment. Tests pass a fake. */
  readBaseUrl?: (pid: number | null | undefined) => string | null
}

function reattachProxy(sources: ReattachSources): ReattachSlotProxy | null {
  return sources.proxy === undefined ? getClaudeAuthProxy() : sources.proxy
}

/** The slot a reattached process still carries, read from its environment. */
function slotFromProcessEnv(sources: ReattachSources, accountId: string): string | undefined {
  const read = sources.readBaseUrl ?? readProcessAnthropicBaseUrl
  return recoverReattachedProxySlot({
    recovered: proxySlotFromUrl(read(sources.pid)),
    accountId,
    proxy: reattachProxy(sources)
  })
}

/**
 * A reattach after a restart: the persisted row names the account the launch recorded and the
 * slot its process carries. Returns false when nothing was persisted for this PTY.
 */
function recordReattachedFromPersisted(
  args: { ptyId: string; paneKey: string | null } & ReattachSources
): boolean {
  const persisted = claudePaneAccountPersistence()?.read(args.ptyId)
  if (!persisted) {
    return false
  }
  const { proxyPort, proxySlot, ...row } = persisted
  const billed = row.assignedAccountId ?? row.accountId
  const slot = proxySlot
    ? recoverReattachedProxySlot({
        recovered: { slot: proxySlot, port: proxyPort ?? null },
        accountId: billed,
        proxy: reattachProxy(args)
      })
    : slotFromProcessEnv(args, billed)
  recordClaudePaneAccount({
    ...row,
    paneKey: args.paneKey ?? row.paneKey,
    ...(slot ? { proxySlot: slot } : {})
  })
  return true
}

/**
 * Records the account a Claude launch runs on; both spawn choke points (renderer pty:spawn and the
 * runtime controller) call this after the spawn committed and its pane key was remembered, so the
 * stored paneKey equals ptyPaneKey's.
 */
export function recordClaudePaneAccountForSpawn(
  args: {
    ptyId: string
    paneKey: string | null
    isClaudeLaunch: boolean
    isReattach: boolean
    claudeAuth: ClaudeRuntimeAuthPreparation | null
    claudeAccountId?: string
    settings: ClaudePaneAccountSettings | undefined
    target: ClaudeAccountSelectionTarget
    now?: number
  } & ReattachSources
): void {
  // Why: a reattach inherits the baked environment; re-recording it under today's selection would
  // erase the account the launch recorded. An empty registry (the process restarted) reads the
  // persisted row, so the pane keeps its account and the slot its process still carries.
  if (args.isReattach && getClaudePaneAccount(args.ptyId)) {
    return
  }
  if (args.isReattach && recordReattachedFromPersisted(args)) {
    return
  }
  if (!args.isClaudeLaunch || !args.claudeAuth) {
    if (!args.isReattach) {
      forgetClaudePaneAccount(args.ptyId)
    }
    return
  }
  const accountId = claudeAccountIdFromProvenance(
    args.claudeAuth.provenance,
    args.settings,
    args.target,
    args.claudeAccountId
  )
  if (!accountId) {
    if (!args.isReattach) {
      forgetClaudePaneAccount(args.ptyId)
    }
    return
  }
  // The slot minted for this reattach never reached the process; only the one it was born with counts.
  const proxySlot = args.isReattach
    ? slotFromProcessEnv(args, accountId)
    : proxySlotFromBaseUrl(args.claudeAuth.envPatch)
  const pooled = args.claudeAuth.pooled === true
  recordClaudePaneAccount({
    ptyId: args.ptyId,
    paneKey: args.paneKey,
    accountId,
    configDir: args.claudeAuth.configDir || null,
    launchedAt: args.now ?? Date.now(),
    // Why false: Orca chose this folder; a session whose shell chose its own is learned from its
    // transcript later and marked pinned there.
    pinned: false,
    source: pooled ? 'pool' : 'spawn',
    ...(args.claudeAuth.appliedModel
      ? {
          model: args.claudeAuth.appliedModel.model,
          modelSource: args.claudeAuth.appliedModel.modelSource
        }
      : {}),
    // A pooled launch records the assignment even before a proxy slot exists.
    ...(proxySlot || pooled
      ? { ...(proxySlot ? { proxySlot } : {}), assignedAccountId: accountId }
      : {})
  })
}
