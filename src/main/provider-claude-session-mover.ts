import { translateMain } from './i18n/main-i18n'
import type { RuntimePtyController } from './runtime/runtime-pty-controller-contract'
import { agentHookServer } from './agent-hooks/server'
import { getClaudeAuthProxy } from './claude-accounts/claude-auth-proxy/claude-auth-proxy-host'
import {
  assignClaudePaneAccount,
  getClaudePaneAccount,
  listClaudePaneAccounts,
  recordClaudePaneAccount,
  rememberClaudeSessionAssignment,
  setClaudePaneModel
} from './claude-accounts/claude-pane-account-registry'
import {
  createClaudeSessionMover,
  type ClaudeSessionMoveNotice,
  type ClaudeSessionMover
} from './claude-accounts/claude-session-mover'
import {
  createProxyMoveStrategy,
  createResumeMoveStrategy
} from './claude-accounts/claude-session-move-strategy'
import { publishClaudeAccountModelChanged } from './claude-accounts/claude-account-plugin-publish'
import {
  claudeModelFlips,
  rememberClaudeModelFlip
} from './claude-accounts/claude-model-flip-history'
import { createClaudeModelPolicyTicker } from './claude-accounts/claude-model-policy-ticker'
import {
  claudeAccountUsageReading,
  claudeAccountUsageWindows
} from './claude-accounts/claude-account-usage-windows'
import { getSelectedClaudeAccountIdForTarget } from './claude-accounts/runtime-selection'
import { getPtyIdForPaneKey, ptyPaneKey } from './ipc/pty/pane/key-state'
import { listRegisteredPtys } from './memory/pty-registry'
import type { Store } from './persistence'
import type { ProviderAccountServices } from './provider-account-services'

export type StartedClaudeSessionMover = ClaudeSessionMover & { stop: () => void }

let stopModelPolicyTicker: (() => void) | null = null

/** Stops the model ticker when the session mover itself was not started. */
export function stopClaudeModelPolicyTicker(): void {
  stopModelPolicyTicker?.()
  stopModelPolicyTicker = null
}

export type ProviderClaudeSessionMoverOptions = {
  headless: boolean
  getController: () =>
    | (Pick<RuntimePtyController, 'spawn' | 'getCwd' | 'getSize' | 'write'> &
        Partial<Pick<RuntimePtyController, 'serializeBuffer'>>)
    | null
  onNotice: (notice: ClaudeSessionMoveNotice) => void
}

export function createProviderClaudeSessionMover(
  store: Store,
  services: Pick<ProviderAccountServices, 'rateLimits' | 'claudeAccounts' | 'claudeRuntimeAuth'>,
  options: ProviderClaudeSessionMoverOptions | undefined
): StartedClaudeSessionMover | null {
  const { rateLimits, claudeAccounts, claudeRuntimeAuth } = services
  const sessionMover = options
    ? createClaudeSessionMover({
        getSettings: () => store.getSettings(),
        rateLimits,
        accounts: claudeAccounts,
        hooks: agentHookServer,
        registry: { list: listClaudePaneAccounts, record: recordClaudePaneAccount },
        resolvePaneKey: (ptyId) => ptyPaneKey.get(ptyId) ?? null,
        resolvePtyIdForPaneKey: (paneKey) => getPtyIdForPaneKey(paneKey) ?? null,
        resolveWorktreeId: (ptyId) =>
          listRegisteredPtys().find((pty) => pty.ptyId === ptyId)?.worktreeId ?? null,
        // Why the System-default home too: a pane on System default records the COVERED account's id (Task 1
        // convention), so transcript inference must own ~/.claude for that account or the two sources disagree.
        accountHomes: (accountId) =>
          claudeRuntimeAuth.router.coveredBySystemDefault(accountId)
            ? [
                claudeRuntimeAuth.router.accountHome(accountId),
                claudeRuntimeAuth.router.systemDefaultHome()
              ]
            : [claudeRuntimeAuth.router.accountHome(accountId)],
        strategy: createResumeMoveStrategy({
          getController: options.getController,
          getSettings: () => store.getSettings(),
          platform: process.platform,
          hooks: agentHookServer,
          translate: translateMain
        }),
        proxyStrategy: createProxyMoveStrategy({
          getPane: getClaudePaneAccount,
          assignSlot: (slot, accountId) =>
            getClaudeAuthProxy()?.assignSlot(slot, accountId) ?? false,
          assignAccount: assignClaudePaneAccount,
          rememberSession: rememberClaudeSessionAssignment
        }),
        headless: options.headless,
        onNotice: options.onNotice
      })
    : null
  claudeAccounts.setUsageWindowsProvider((accounts) => {
    const settings = store.getSettings()
    const state = rateLimits.getState()
    return claudeAccountUsageWindows({
      accounts,
      selectedAccountId: getSelectedClaudeAccountIdForTarget(settings, state.claudeTarget),
      selectedLimits: state.claude,
      inactiveAccounts: state.inactiveClaudeAccounts
    })
  })
  stopClaudeModelPolicyTicker()
  const ticker = createClaudeModelPolicyTicker({
    getSettings: () => store.getSettings(),
    panes: listClaudePaneAccounts,
    usageFor: (accountId) => {
      const settings = store.getSettings()
      const state = rateLimits.getState()
      const account = claudeAccounts
        .listAccounts()
        .accounts.find((candidate) => candidate.id === accountId)
      if (!account) {
        return null
      }
      return claudeAccountUsageReading({
        account,
        selectedAccountId: getSelectedClaudeAccountIdForTarget(settings, state.claudeTarget),
        selectedLimits: state.claude,
        inactiveAccounts: state.inactiveClaudeAccounts
      })
    },
    subscribe: (listener) => rateLimits.onStateChange(() => listener()),
    subscribeSettings: (listener) =>
      store.onSettingsChanged((updates) => {
        if (updates && !('claudeModelPolicy' in updates)) {
          return
        }
        listener()
      }),
    apply: (flip) => {
      setClaudePaneModel(flip.ptyId, flip.to, 'policy')
      rememberClaudeModelFlip(flip)
      publishClaudeAccountModelChanged({
        ptyId: flip.ptyId,
        accountId: flip.accountId,
        from: flip.from,
        to: flip.to,
        reason: flip.reason
      })
    },
    onWarning: (ptyId, warning) => {
      console.warn(`[claude-model-policy] ${ptyId}: ${warning}`)
    }
  })
  stopModelPolicyTicker = ticker.start()
  claudeAccounts.setSessionMovesProvider(() => {
    const moves = sessionMover?.lastDecisions() ?? []
    return [...moves, ...claudeModelFlips()].sort((left, right) => right.at - left.at)
  })
  if (sessionMover) {
    const stopMover = sessionMover.start()
    return {
      ...sessionMover,
      stop: () => {
        stopMover()
        stopClaudeModelPolicyTicker()
      }
    }
  }
  return null
}
