import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  CLAUDE_INJECTED_CONFIG_DIR_ENV,
  CLAUDE_PROFILE_POINTER_ENV,
  CLAUDE_PROFILE_SETUP_FAILED_MESSAGE,
  CLAUDE_USER_CONFIG_DIR_ENV
} from '../../shared/claude-profile-routing'
import { claudeProfileMissing } from './claude-profile-launch-errors'
import { ClaudeProfileSetupQueue } from './claude-profile-setup-queue'
import {
  chosenAccountLaunchEnv,
  chosenAccountPreparation,
  prepareChosenAccountLaunch,
  type ChosenAccountRouting
} from './claude-profile-chosen-account'
import {
  claudeAccountUsagePreparation,
  systemDefaultRunsAnotherAccount
} from './claude-profile-system-default-comparison'
import type { GlobalSettings } from '../../shared/global-settings-types'
import { writeFileAtomically } from '../codex-accounts/fs-utils'
import {
  describeClaudeProfile,
  type ClaudeProfileDescriptor,
  readUserClaudeConfigDir,
  readUserClaudeConfigDirAsSet,
  resolveClaudeDefaultHome
} from './claude-profile-paths'
import type { runClaudeProfileSetupInWorker } from './claude-profile-setup-worker'
import type { ClaudeEnvPatch } from './environment'
import type { ClaudeRuntimeAuthPreparation } from './runtime-auth/runtime-auth-types'
import {
  findClaudeAccount,
  getSelectedClaudeAccountIdForTarget,
  type ClaudeAccountSelectionTarget
} from './runtime-selection'
import { wslClaudeProfilePointer } from './claude-profile-wsl-paths'
import { isDirectory, listClaudeProfileHomes } from './claude-profile-installed-router'
import {
  claudeStateFile,
  readClaudeFolderLogin,
  removeClaudeAccountFolder,
  isSameClaudeLogin,
  type ClaudeFolderLogin
} from './claude-account-folder'
import { resolveLoginShellEnvironment } from '../startup/login-shell-environment'

export type ClaudeProfileRouterSettings = Pick<
  GlobalSettings,
  | 'claudeManagedAccounts'
  | 'activeClaudeManagedAccountId'
  | 'activeClaudeManagedAccountIdsByRuntime'
  | 'agentStatusHooksEnabled'
  | 'disabledTuiAgents'
>

/**
 * Routes this host's Claude launches to the selected account's folder. Settings own the selection;
 * the pointer file mirrors it for `claude` typed in an already-open terminal.
 */
export class ClaudeProfileRouter {
  readonly pointerPath: string
  private readonly setups: ClaudeProfileSetupQueue
  private env: NodeJS.ProcessEnv
  private readonly envReady: Promise<unknown>
  private envResolved: boolean
  constructor(
    private readonly args: {
      getSettings: () => ClaudeProfileRouterSettings
      dataRoot: string
      userHome?: string
      /** Tests replace the login shell's env. */
      env?: NodeJS.ProcessEnv
      /** Tests replace the worker. */
      runSetup?: typeof runClaudeProfileSetupInWorker
      /** Tests shorten how long a launch waits on a refresh. */
      refreshWaitMs?: number
    }
  ) {
    this.pointerPath = join(args.dataRoot, 'claude-profiles', 'selected-host')
    this.env = args.env ?? process.env
    // Why the login shell's: a Dock launch lacks the CLAUDE_CONFIG_DIR an rc exports. Chats share it.
    this.envResolved = Boolean(args.env)
    this.envReady = args.env
      ? Promise.resolve()
      : resolveLoginShellEnvironment().then((env) => {
          this.env = env
          this.envResolved = true
          // Why: a pointer written before then compared against the wrong System default.
          try {
            this.writePointer()
          } catch (error) {
            console.warn('[claude-profile] Could not update the Claude account pointer:', error)
          }
        })
    this.setups = new ClaudeProfileSetupQueue({
      ...args,
      userHome: () => this.userHome,
      userConfigDir: () => this.userConfigDir(),
      envReady: this.envReady
    })
  }

  private get userHome(): string {
    return this.args.userHome ?? homedir()
  }

  private selectedProfile(): ClaudeProfileDescriptor | null {
    const id = getSelectedClaudeAccountIdForTarget(this.args.getSettings(), { runtime: 'host' })
    return id ? this.describe(id) : null
  }

  /** The folder launches run in: the selected account's, unless System default covers it. */
  private routedProfile(): ClaudeProfileDescriptor | null {
    const profile = this.selectedProfile()
    return profile && !this.coveredBySystemDefault(profile.accountId) ? profile : null
  }

  /** The login an account's own folder holds; null until it signs in there. */
  accountLogin(accountId: string): ClaudeFolderLogin | null {
    return readClaudeFolderLogin(claudeStateFile(this.accountHome(accountId), this.userHome))
  }

  /** The login System default holds. */
  systemDefaultLogin(maxAgeMs = 0): ClaudeFolderLogin | null {
    return readClaudeFolderLogin(claudeStateFile(this.userConfigDir(), this.userHome), maxAgeMs)
  }

  /**
   * An account with no login of its own runs on System default while that is signed in to the
   * same email, so an account saved before per-account folders logs nobody out.
   */
  coveredBySystemDefault(accountId: string): boolean {
    if (this.accountLogin(accountId)) {
      return false
    }
    const saved = findClaudeAccount(this.args.getSettings(), accountId)
    const systemDefault = this.systemDefaultLogin()
    return Boolean(saved && systemDefault && isSameClaudeLogin(saved, systemDefault))
  }

  /** The user's System default: their own CLAUDE_CONFIG_DIR, else ~/.claude. */
  systemDefaultHome(): string {
    return resolveClaudeDefaultHome(this.userHome, this.userConfigDir())
  }

  /** Null for System default. Throws for a missing folder: falling back would run the wrong account. */
  routedHome(): string | null {
    const home = this.routedProfile()?.home ?? null
    if (home !== null && !isDirectory(home)) {
      throw claudeProfileMissing()
    }
    return home
  }

  /** Pointer first, then setup in the background, as superset does. No saved accounts means no pointer. */
  publish(): void {
    if (!this.writePointer()) {
      return
    }
    // Why even a missing or covered folder: setup creates it without a login, so a sign-in,
    // or Claude's own first run, signs in there.
    const profile = this.selectedProfile()
    if (profile) {
      this.setups.runInBackground(profile)
    }
  }

  /** The routed folder for the `claude` function; false when no account is saved, so no pointer. */
  private writePointer(): boolean {
    if (this.args.getSettings().claudeManagedAccounts.length === 0) {
      rmSync(this.pointerPath, { force: true })
      return false
    }
    const home = this.routedProfile()?.home ?? ''
    // Why compare first: launches re-sync it, and most find it unchanged.
    if (!existsSync(this.pointerPath) || readFileSync(this.pointerPath, 'utf8') !== home) {
      mkdirSync(dirname(this.pointerPath), { recursive: true, mode: 0o700 })
      writeFileAtomically(this.pointerPath, home, { mode: 0o600 })
    }
    return true
  }

  /** Refreshes the routed folder first; only a first setup that fails stops the launch. */
  async prepareLaunch(): Promise<ClaudeRuntimeAuthPreparation> {
    const selected = this.selectedProfile()
    // Why wait only without the account's own login: System default, and whether it covers the
    // account, depend on the login shell's CLAUDE_CONFIG_DIR; setup awaits it itself.
    if (!selected || !this.accountLogin(selected.accountId)) {
      await this.envReady
    }
    // Why: a sign-in or a System default login change since the last publish moves the route.
    this.writePointer()
    const profile = this.routedProfile()
    if (profile) {
      await this.setups.runForLaunch(profile)
    }
    return this.preparation()
  }

  /** An account's folder on this host, whether or not it exists yet. */
  accountHome(accountId: string): string {
    return this.describe(accountId).home
  }

  /** Creates and sets up an account's folder for sign-in; the login itself is Claude's. */
  async prepareAccount(accountId: string): Promise<string> {
    const profile = this.describe(accountId)
    const report = await this.setups.run(profile).catch(() => null)
    if (report?.outcome !== 'prepared') {
      throw new Error(CLAUDE_PROFILE_SETUP_FAILED_MESSAGE)
    }
    return profile.home
  }

  /** Deletes an account's folder after any setup running for it, which would otherwise recreate it. */
  async removeAccount(accountId: string): Promise<void> {
    await this.setups.settle(accountId)
    await removeClaudeAccountFolder(this.args.dataRoot, accountId)
  }

  /** True once an older Orca copied an account's login into System default: it left this snapshot. */
  copiedLoginIntoSystemDefault(): boolean {
    return existsSync(join(this.args.dataRoot, 'claude-runtime-auth', 'system-default-auth.json'))
  }

  /** The user's own CLAUDE_CONFIG_DIR: System default's folder. */
  userConfigDir(): string | undefined {
    return readUserClaudeConfigDir(this.env)
  }

  private describe(accountId: string): ClaudeProfileDescriptor {
    return describeClaudeProfile(this.args.dataRoot, accountId, {
      executionHostId: 'local',
      runtime: 'host'
    })
  }

  /** Env for a launch Orca makes itself. Throws like routedHome. */
  launchEnv(): ClaudeEnvPatch {
    const home = this.routedHome()
    return {
      [CLAUDE_PROFILE_POINTER_ENV]: this.pointerPath,
      // Why nothing for System default: the user's inherited CLAUDE_CONFIG_DIR must pass through.
      ...(home ? { CLAUDE_CONFIG_DIR: home, [CLAUDE_INJECTED_CONFIG_DIR_ENV]: home } : {})
    }
  }

  /** What chosen-account launches borrow from this router. */
  private readonly chosen: ChosenAccountRouting = {
    getSettings: () => this.args.getSettings(),
    coveredBySystemDefault: (id) => this.coveredBySystemDefault(id),
    accountHome: (id) => this.accountHome(id),
    systemDefaultHome: () => this.systemDefaultHome(),
    env: () => this.env,
    envReady: () => this.envReady,
    setUpForLaunch: (id) => this.setups.runForLaunch(this.describe(id))
  }

  /** Env for a launch on a chosen host account. Throws for an unknown or WSL account and a missing folder. */
  launchEnvFor(accountId: string): ClaudeEnvPatch {
    return chosenAccountLaunchEnv(this.chosen, accountId)
  }

  /** Like preparation(), for a chosen host account. */
  preparationFor(accountId: string): ClaudeRuntimeAuthPreparation {
    return chosenAccountPreparation(this.chosen, accountId)
  }

  /** Like prepareLaunch(), for a chosen host account. */
  prepareLaunchFor(accountId: string): Promise<ClaudeRuntimeAuthPreparation> {
    return prepareChosenAccountLaunch(this.chosen, accountId)
  }

  /** A pane's spawn env. Never throws, so a broken selection cannot stop a terminal opening. */
  terminalEnv(target?: ClaudeAccountSelectionTarget): ClaudeEnvPatch {
    // Why only the pointer: the guest's `claude` reads it, so a pane never waits on the guest.
    if (target?.runtime === 'wsl') {
      return { [CLAUDE_PROFILE_POINTER_ENV]: `~/${wslClaudeProfilePointer(this.args.dataRoot)}` }
    }
    // Why the user's own value in every host pane: the claude function follows the selection over
    // it (an rc export, or the inherited value) and restores it on System default.
    const userConfigDir = readUserClaudeConfigDirAsSet(this.env)
    const base: ClaudeEnvPatch = {
      [CLAUDE_PROFILE_POINTER_ENV]: this.pointerPath,
      ...(userConfigDir ? { [CLAUDE_USER_CONFIG_DIR_ENV]: userConfigDir } : {})
    }
    // Why only the pointer before the login shell's env: which home runs depends on its
    // CLAUDE_CONFIG_DIR, and the pane's `claude` reads the pointer rewritten once it arrives.
    if (!this.envResolved) {
      return base
    }
    try {
      this.writePointer()
      // Why in the background: a pane never waits; its `claude` starts after the refresh, mostly.
      const profile = this.routedProfile()
      if (profile) {
        this.setups.runInBackground(profile)
      }
      return { ...base, ...this.launchEnv() }
    } catch {
      return base
    }
  }

  preparation(): ClaudeRuntimeAuthPreparation {
    const profile = this.routedProfile()
    const home = this.routedHome()
    return {
      configDir: home ?? this.systemDefaultHome(),
      runtime: 'host',
      wslDistro: null,
      wslLinuxConfigDir: null,
      envPatch: this.launchEnv(),
      provenance: home ? `profile:${profile?.accountId}` : 'system'
    }
  }

  /**
   * Whether `claude` in a terminal opened before routing, which runs System default's login, runs
   * another account than the selected host one. Null with no host account selected.
   */
  systemDefaultRunsAnotherAccount(): boolean | null {
    const id = this.selectedProfile()?.accountId
    return id
      ? systemDefaultRunsAnotherAccount(this, id, findClaudeAccount(this.args.getSettings(), id))
      : null
  }

  /** Whether launches run in an account's folder rather than System default's. */
  routesToAccount(): boolean {
    return this.routedProfile() !== null
  }

  /** Where an unselected account's usage is read: where its launches would run once selected. */
  accountUsagePreparation(accountId: string): ClaudeRuntimeAuthPreparation {
    return claudeAccountUsagePreparation(this, accountId)
  }

  /** Every account folder on this host, selected or not. */
  accountHomes(): string[] {
    return listClaudeProfileHomes(this.args.dataRoot)
  }
}
