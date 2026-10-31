import type { ClaudeSessionMoverSetting } from '../../shared/claude-account-switch-settings'
import { claudeTokenRefreshFields, installClaudeTokenRefresh } from './claude-token-refresh-list'
import type {
  ClaudeManagedAccount,
  ClaudeManagedAccountSummary,
  ClaudeSessionMoveSummary,
  ClaudeRateLimitAccountsState
} from '../../shared/managed-account-types'
import type { GlobalSettings } from '../../shared/global-settings-types'
import type { RateLimitService } from '../rate-limits/service'
import { claudeStateFile, readClaudeFolderLogin } from './claude-account-folder'
import {
  savedClaudeManagedAccountSummary,
  summarizeClaudeManagedAccount
} from './claude-account-summary'
import { wslAuthProxyStatus } from './wsl-auth-proxy-status'
import type { ClaudeRuntimeAuthService } from './runtime-auth-service'
import { claudeModelPolicyEvaluations } from './claude-model-policy-evaluations'
import { resolveClaudeModelPolicy, type ClaudeModelPolicyPatch } from './claude-model-policy'
import { claudeListedPaneAccounts, listedPaneAssignments } from './claude-listed-pane-accounts'
import { listClaudePaneAccounts } from './claude-pane-account-registry'
import {
  getClaudeSelectionTargetForAccount,
  getClaudeWslSelectionKey,
  getSelectedClaudeAccountIdForTarget,
  normalizeClaudeAccountSelectionTarget,
  normalizeClaudeRuntimeSelection,
  pruneInvalidClaudeRuntimeSelection,
  removeClaudeAccountIdFromSelection,
  setSelectedClaudeAccountIdForTarget,
  type ClaudeAccountSelectionTarget
} from './runtime-selection'

export const CLAUDE_ACCOUNT_NEEDS_SIGN_IN_MESSAGE =
  'Sign in to this Claude account again before selecting it.'

export const CLAUDE_ACCOUNT_FOLDER_IN_USE_MESSAGE =
  "Orca couldn't delete this Claude account's folder. Quit any Claude running in this account, then remove it again."

export type ClaudeAccountSettings = Pick<
  GlobalSettings,
  | 'claudeManagedAccounts'
  | 'activeClaudeManagedAccountId'
  | 'activeClaudeManagedAccountIdsByRuntime'
  | 'claudeAutoSwitchEnabled'
  | 'claudeSessionMover'
  | 'claudeAuthProxy'
  | 'claudeAccountTokenRefresh'
  | 'claudeAccountPool'
  | 'claudeModelPolicy'
>

export type ClaudeAccountStore = {
  getSettings: () => ClaudeAccountSettings
  updateSettings: (
    patch: Partial<ClaudeAccountSettings>,
    options?: { notifyListeners?: boolean }
  ) => unknown
}

export type ClaudeAccountRuntime = Pick<
  ClaudeRuntimeAuthService,
  'syncForCurrentSelection' | 'publishAll' | 'removeAccountFolder' | 'prepareAccountFolder'
> & {
  router: Pick<
    ClaudeRuntimeAuthService['router'],
    | 'accountHome'
    | 'userConfigDir'
    | 'systemDefaultHome'
    | 'copiedLoginIntoSystemDefault'
    | 'coveredBySystemDefault'
  >
}

export type ClaudeAccountUsage = Pick<
  RateLimitService,
  'evictInactiveClaudeCache' | 'refreshForClaudeAccountChange'
>

type ClaudeUsageWindows = NonNullable<ClaudeRateLimitAccountsState['usageWindows']>

export class ClaudeAccountSelection {
  constructor(
    private readonly store: ClaudeAccountStore,
    private readonly rateLimits: ClaudeAccountUsage,
    private readonly runtimeAuth: ClaudeAccountRuntime
  ) {
    installClaudeTokenRefresh(this.store)
  }

  private sessionMovesProvider: (() => ClaudeSessionMoveSummary[]) | null = null
  // Accounts are passed in. The provider must not call list(); list() is the caller.
  private usageWindowsProvider:
    | ((accounts: readonly ClaudeManagedAccountSummary[]) => ClaudeUsageWindows)
    | null = null

  setSessionMovesProvider(provider: (() => ClaudeSessionMoveSummary[]) | null): void {
    this.sessionMovesProvider = provider
  }

  setUsageWindowsProvider(
    provider: ((accounts: readonly ClaudeManagedAccountSummary[]) => ClaudeUsageWindows) | null
  ): void {
    this.usageWindowsProvider = provider
  }

  setModelPolicy(patch: ClaudeModelPolicyPatch): ClaudeRateLimitAccountsState {
    const current = this.store.getSettings().claudeModelPolicy
    const resolved = resolveClaudeModelPolicy({
      claudeModelPolicy: {
        enabled: patch.enabled ?? current?.enabled,
        fableLine: patch.fableLine ?? current?.fableLine,
        weeklyGuard: patch.weeklyGuard ?? current?.weeklyGuard
      }
    })
    this.saveSettings({ claudeModelPolicy: resolved })
    return this.list()
  }

  setSessionMover(setting: ClaudeSessionMoverSetting): ClaudeRateLimitAccountsState {
    this.saveSettings({ claudeSessionMover: setting })
    return this.list()
  }

  setAuthProxy(enabled: boolean): ClaudeRateLimitAccountsState {
    this.saveSettings({ claudeAuthProxy: enabled })
    return this.list()
  }

  setTokenRefresh(enabled: boolean): ClaudeRateLimitAccountsState {
    this.saveSettings({ claudeAccountTokenRefresh: enabled })
    return this.list()
  }

  setAccountPool(enabled: boolean): ClaudeRateLimitAccountsState {
    this.saveSettings({ claudeAccountPool: enabled ? 'on' : 'off' })
    return this.list()
  }

  list(): ClaudeRateLimitAccountsState {
    this.pruneSelection()
    const settings = this.store.getSettings()
    const selection = normalizeClaudeRuntimeSelection(settings)
    const accounts = settings.claudeManagedAccounts
      .map((account): ClaudeManagedAccountSummary => {
        try {
          return this.summarize(account)
        } catch (error) {
          console.warn('[claude-accounts] Could not read account folder:', error)
          return { ...savedClaudeManagedAccountSummary(account), needsSignIn: true }
        }
      })
      .sort((a, b) => b.updatedAt - a.updatedAt)
    const paneRecords = listClaudePaneAccounts()
    const { paneAccounts, assignedSessions } = claudeListedPaneAccounts(accounts, paneRecords)
    const paneAssignments = listedPaneAssignments(paneRecords)
    const userConfigDir = this.runtimeAuth.router.userConfigDir()
    // Throttle parsing of the large, frequently rewritten personal state file.
    const systemDefault =
      accounts.length > 0 ? readClaudeFolderLogin(claudeStateFile(userConfigDir), 5_000) : null
    const wslAuthProxy =
      process.platform === 'win32' ? wslAuthProxyStatus(settings.claudeManagedAccounts) : undefined
    const modelPolicyEvaluations = claudeModelPolicyEvaluations()
    return {
      accounts,
      activeAccountId: selection.host,
      activeAccountIdsByRuntime: selection,
      autoSwitchEnabled: settings.claudeAutoSwitchEnabled === true,
      sessionMover: settings.claudeSessionMover ?? 'ask',
      ...claudeTokenRefreshFields(settings, accounts),
      accountPool: settings.claudeAccountPool === 'on' ? 'on' : 'off',
      pool: settings.claudeAccountPool === 'on' ? 'on' : 'off',
      modelPolicy: resolveClaudeModelPolicy(settings),
      ...(this.usageWindowsProvider ? { usageWindows: this.usageWindowsProvider(accounts) } : {}),
      ...(modelPolicyEvaluations.length > 0 ? { modelPolicyEvaluations } : {}),
      assignedSessions,
      paneAccounts,
      sessionMoves: this.sessionMovesProvider?.() ?? [],
      ...(wslAuthProxy ? { wslAuthProxy } : {}),
      ...(paneAssignments.length > 0 ? { paneAssignments } : {}),
      ...(accounts.length > 0
        ? { systemDefaultHome: this.runtimeAuth.router.systemDefaultHome() }
        : {}),
      ...(systemDefault ? { systemDefaultEmail: systemDefault.email } : {}),
      ...(systemDefault?.organizationUuid
        ? { systemDefaultOrganizationUuid: systemDefault.organizationUuid }
        : {}),
      ...(systemDefault && this.runtimeAuth.router.copiedLoginIntoSystemDefault()
        ? { systemDefaultMayBeCopied: true }
        : {})
    }
  }

  setAutoSwitch(enabled: boolean): ClaudeRateLimitAccountsState {
    this.saveSettings({ claudeAutoSwitchEnabled: enabled })
    return this.list()
  }

  private summarize(account: ClaudeManagedAccount): ClaudeManagedAccountSummary {
    return summarizeClaudeManagedAccount(account, this.runtimeAuth.router)
  }

  async remove(accountId: string): Promise<ClaudeRateLimitAccountsState> {
    const account = this.requireAccount(accountId)
    const settings = this.store.getSettings()
    const target = getClaudeSelectionTargetForAccount(account)
    const wasSelected = getSelectedClaudeAccountIdForTarget(settings, target) === accountId
    const nextSelection = removeClaudeAccountIdFromSelection(
      normalizeClaudeRuntimeSelection(settings),
      accountId
    )
    this.saveSettings({
      activeClaudeManagedAccountId:
        settings.activeClaudeManagedAccountId === accountId ? null : nextSelection.host,
      activeClaudeManagedAccountIdsByRuntime: nextSelection
    })
    // Stop new launches from selecting the folder before deleting it.
    await this.runtimeAuth.syncForCurrentSelection(target)
    try {
      await this.runtimeAuth.removeAccountFolder(accountId, target)
    } catch (error) {
      // Keep the account available to retry folder deletion.
      console.warn('[claude-accounts] Could not delete the account folder:', error)
      throw new Error(CLAUDE_ACCOUNT_FOLDER_IN_USE_MESSAGE)
    }
    this.saveSettings({
      claudeManagedAccounts: this.store
        .getSettings()
        .claudeManagedAccounts.filter((entry) => entry.id !== accountId)
    })
    // Removing the last account also removes the selection file.
    await this.runtimeAuth.syncForCurrentSelection(target)
    this.rateLimits.evictInactiveClaudeCache(accountId)
    this.refreshUsage(wasSelected ? accountId : undefined, target)
    return this.list()
  }

  async select(
    accountId: string | null,
    target?: ClaudeAccountSelectionTarget
  ): Promise<ClaudeRateLimitAccountsState> {
    let effectiveTarget = target
    if (accountId !== null) {
      const account = this.requireAccount(accountId)
      const accountTarget = getClaudeSelectionTargetForAccount(account)
      const requested = normalizeClaudeAccountSelectionTarget(target ?? accountTarget)
      const owned = normalizeClaudeAccountSelectionTarget(accountTarget)
      if (
        requested.runtime !== owned.runtime ||
        (requested.wslDistro !== null &&
          getClaudeWslSelectionKey(requested.wslDistro) !==
            getClaudeWslSelectionKey(owned.wslDistro))
      ) {
        throw new Error('That Claude account belongs to a different runtime.')
      }
      // CLI and paired clients bypass the renderer's sign-in check.
      if (this.summarize(account).needsSignIn) {
        throw new Error(CLAUDE_ACCOUNT_NEEDS_SIGN_IN_MESSAGE)
      }
      effectiveTarget = accountTarget
    }
    const previous = this.store.getSettings()
    const outgoingAccountId = getSelectedClaudeAccountIdForTarget(previous, effectiveTarget)
    const nextSelection = setSelectedClaudeAccountIdForTarget(
      normalizeClaudeRuntimeSelection(previous),
      accountId,
      effectiveTarget
    )
    this.saveSettings({
      activeClaudeManagedAccountId:
        effectiveTarget?.runtime === 'wsl' ? nextSelection.host : accountId,
      activeClaudeManagedAccountIdsByRuntime: nextSelection
    })
    try {
      await this.runtimeAuth.syncForCurrentSelection(effectiveTarget)
    } catch (error) {
      this.saveSettings({
        activeClaudeManagedAccountId: previous.activeClaudeManagedAccountId,
        activeClaudeManagedAccountIdsByRuntime: previous.activeClaudeManagedAccountIdsByRuntime
      })
      await this.runtimeAuth.publishAll().catch((rollbackError: unknown) => {
        console.warn('[claude-accounts] Rollback republish failed:', rollbackError)
      })
      throw error
    }
    this.refreshUsage(outgoingAccountId, effectiveTarget)
    return this.list()
  }

  /** Usage failures must not undo account changes. */
  refreshUsage(
    outgoingAccountId: string | null | undefined,
    target: ClaudeAccountSelectionTarget | undefined
  ): void {
    void this.rateLimits
      .refreshForClaudeAccountChange(outgoingAccountId ?? undefined, target)
      .catch((error: unknown) =>
        console.warn('[claude-accounts] Usage unavailable after account change:', error)
      )
  }

  findAccount(accountId: string): ClaudeManagedAccount | undefined {
    return this.store.getSettings().claudeManagedAccounts.find((entry) => entry.id === accountId)
  }

  requireAccount(accountId: string): ClaudeManagedAccount {
    const account = this.findAccount(accountId)
    if (!account) {
      throw new Error('That Claude account no longer exists.')
    }
    return account
  }

  // Notify every window of selections made by the CLI, paired clients, or other windows.
  saveSettings(patch: Partial<ClaudeAccountSettings>): void {
    this.store.updateSettings(patch, { notifyListeners: true })
  }

  private pruneSelection(): void {
    const settings = this.store.getSettings()
    const current = normalizeClaudeRuntimeSelection(settings)
    const next = pruneInvalidClaudeRuntimeSelection(current, settings.claudeManagedAccounts)
    if (
      next.host !== settings.activeClaudeManagedAccountId ||
      JSON.stringify(next) !== JSON.stringify(current)
    ) {
      this.store.updateSettings({
        activeClaudeManagedAccountId: next.host,
        activeClaudeManagedAccountIdsByRuntime: next
      })
    }
  }
}
