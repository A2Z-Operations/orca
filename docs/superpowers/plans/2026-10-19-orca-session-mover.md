# Orca Session Mover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A running Claude session whose own account is about to run out of room moves itself to the managed account with the most room, between turns, with its conversation intact (`claude --resume <id>` in the same pane), on the desktop and on headless `orca serve`, with no human in the loop when the setting says `move`. Every decision is logged with its inputs and readable through `orca account list --json`. Spec: `docs/superpowers/specs/2026-10-19-orca-session-mover-design.md`.

**Architecture:** Four main-process units plus settings/CLI, all in `src/main` (nothing in `src/renderer` is edited except one new Settings row, one mount line and `en.json`): (1) `ClaudePaneAccountRegistry` — which account each live Claude PTY runs on, recorded where main injects `CLAUDE_CONFIG_DIR` at spawn, forgotten on PTY teardown, inferred from the hook server's `transcriptPath` for sessions Orca did not route (those are `pinned`); (2) live usage routing — a statusline post from a non-selected managed account lands in that account's `inactiveClaudeAccounts` entry instead of being dropped; (3) `ClaudeSessionMover` — subscribes to `RateLimitService.onStateChange` and `agentHookServer.subscribeStatusChanges`, decides per session with a pure policy over the shared `CLAUDE_AUTO_SWITCH_LINES`, claims targets so five sessions do not jump onto one account, and acts through a `MoveStrategy`; (4) `MoveStrategy.resume` — builds the resume like the phone's `resolveMobileSessionResumeCommand` and spawns it through `RuntimePtyController.spawn` with two new fields, `replacesPtyId` (routed through the existing `pane-owner-replacement.ts`) and `claudeAccountId` (the target account's launch env from the new `ClaudeProfileRouter.launchEnvFor`). Headless parity: orcad starts usage polling whenever auto-switch or the mover is on and publishes notices through `dispatchMobileNotification`.

**Tech Stack:** TypeScript (Electron main + shared + CLI), vitest 5 (`config/vitest.config.ts`, unit globs `src/**/*.test.ts`), zod RPC params with a generated catalog, oxlint + oxfmt via husky/lint-staged on commit, pnpm 12 via corepack on Node 24 in the private prefix `~/.n-orca`. Fork clone `~/Documents/claude/orca-fork` (remote `origin` = `A2Z-Operations/orca`; `upstream` = `stablyai/orca`, never pushed to or posted on).

**Facts the engineer must know (verified in the fork at `9f77257cea`, 2026-10-19):**
- Toolchain for every command below: `export N_PREFIX=$HOME/.n-orca PATH=$HOME/.n-orca/bin:$PATH; cd ~/Documents/claude/orca-fork`. Node `v24.22.0`, pnpm `12.8.1`. Unit tests: `corepack pnpm exec vitest run --config config/vitest.config.ts <paths>` (vitest prints `Test Files  N passed (N)` / `Tests  N passed (N)`; a Vite "ESM syntax in a file loaded as CommonJS" warning precedes every run and is noise). Typecheck: `corepack pnpm run typecheck:node` (= `pnpm run build:packages && node config/scripts/run-typecheck-projects-in-parallel.mjs --project=config/tsconfig.node.json`, covers `src/main/**` + `src/shared`), `corepack pnpm run typecheck:cli`, `corepack pnpm run typecheck:web`. Lint on files you touched: `corepack pnpm exec oxlint <files>`; format: `corepack pnpm exec oxfmt --write <files>` (the husky pre-commit runs `lint-staged` = oxlint + `oxlint --config config/oxlint-react-doctor.json` + `oxfmt --write` on staged files, so a commit may reformat and re-stage them).
- Git: repo-local `user.name`/`user.email` = `Nachumi Eliyahu <nachumi@a2zoperations.com>` (the repo's own `core.hooksPath=.husky/_` means the global identity hook does not run here — the identity is already right; never add a `Co-Authored-By`, `Claude-Session` or "Generated with" trailer). Base = `blowzer/auto-switch` @ `9f77257cea` (upstream v1.4.230 merge `368228ad02` + the updater kill switch). Work branch `blowzer/session-mover`. Push to `origin` only.
- Spawn paths that inject Claude auth: `src/main/ipc/pty/ipc/spawn-preflight.ts` (renderer `pty:spawn`, `ctx.claudeAuth = await ctx.deps.prepareClaudeAuth(ctx.codexSelectionTarget)` at lines 112–115) and `src/main/ipc/pty/runtime/spawn-preflight.ts` (`RuntimePtyController.spawn`, lines 80–83; line 106 `ctx.env = ctx.claudeAuth ? { ...args.env, ...ctx.claudeAuth.envPatch } : args.env` — the SELECTED account's patch wins over a caller env, so a target account needs its own spawn field). `ClaudeRuntimeAuthPreparation` = `{ configDir: string; runtime?; wslDistro?; wslLinuxConfigDir?; envPatch: ClaudeEnvPatch; provenance: string; usageError? }`, provenance `profile:<id>` (`profile:<id>:wsl:<distro>` in WSL), `system`, or `profile:unavailable`.
- Commit sites to mirror (Codex registry): `src/main/ipc/pty/runtime/spawn-commit.ts` line 217 `recordCodexPaneAccountForSpawn({ … })` then line ~236 `const paneKey = rememberPaneKeyForPty(ctx.result.id, ctx.env?.ORCA_PANE_KEY)`; `src/main/ipc/pty/ipc/spawn-commit-persist.ts` lines 92–100 (`publishPtyIpcSpawnCommit`, pane key = `ctx.validatedPaneKey`); teardown `src/main/ipc/pty/provider/state-cleanup.ts` line 44 `forgetCodexPaneAccount(id)` inside `if (!opts.preserveAgentSessionOwners)`.
- `RateLimitService` is a class chain (`service-state.ts` → … → `service-fetch-policy.ts` → … → `service-configuration.ts`); protected fields on `RateLimitServiceState`: `state`, `lastClaudeAuthSnapshot`, `inactiveClaudeAccountsResolver: (() => InactiveClaudeAccountInfo[]) | null` (`InactiveClaudeAccountInfo = { id; managedAuthRuntime?; wslDistro?; wslLinuxAuthPath? }` — no folder path), `inactiveClaudeCache: Map<string, ProviderRateLimits>`, `inactiveClaudeFetching`, `pushToRenderer()`, `updateState()`. `ingestLiveClaudeRateLimits` is in `service-fetch-policy.ts` lines 107–165; the drop is line 118 (`configDir mismatch`). Helpers in `service/service-types.ts`: `normalizeClaudeConfigDir`, `isSameUsageWindow`, `LIVE_CLAUDE_INGEST_DEDUPE_MS` (30 s), `DEFAULT_POLL_MS` (15 min), `MIN_REFETCH_MS`; `mapClaudeUsageWindow(raw, 300|10080)` in `rate-limits/claude-usage-window.ts`. Test harness `src/main/rate-limits/rate-limit-service-test-harness.ts`; the module mocks a service test needs are the block at the top of `src/main/rate-limits/service-live-claude-usage.test.ts` lines 17–75 (copy it verbatim).
- Auto-switch policy (`src/main/claude-accounts/claude-account-auto-switch-policy.ts`): `CLAUDE_AUTO_SWITCH_LINES = { session: 95, weekly: 90, fableWeekly: 90 }`, `CLAUDE_AUTO_SWITCH_COOLDOWN_MS = 5 min`, `claudeAutoSwitchHeadroom(limits, now): number | null`, `isClaudeOverAutoSwitchLine`, `pickClaudeAutoSwitchTarget(active, candidates: InactiveAccountUsage[], { now, lastSwitchAt }): string | null` (applies `MIN_HEADROOM_GAINED = 10`, relaxed to "any room" at the limit), module-private `liveWindows(limits, now)` and `isAtLimit(limits, now)`. Service `claude-account-auto-switch.ts`: `createClaudeAccountAutoSwitch(deps)`; module-private `isReadingOf(limits, account)` (provenance tag check) and `sharesRuntime(a, b)`. Tests: `claude-account-auto-switch.test.ts` (`setup()`, `limits()`, `usageState()`, `vi.useFakeTimers` + `vi.setSystemTime(new Date('2026-10-12T09:00:00Z'))`, `createEmptyRateLimitState` from `src/shared/rate-limit-state-factory.ts`, `getDefaultSettings('/tmp')` from `src/shared/constants.ts`).
- Hook server (`src/main/agent-hooks/server.ts` exports class `AgentHookServer` + singleton `agentHookServer`; methods in `server/server-listeners.ts`): `subscribeStatusChanges(listener: (statuses: AgentHookStatusChangeEntry[]) => void): () => void`, `getStatusChangeSnapshot(): AgentHookStatusChangeEntry[]` (`{ paneKey, state: 'working'|'blocked'|'waiting'|'done', receivedAt, observedInCurrentRuntime }`), `getProviderSessionIdentities(): AgentHookProviderSessionIdentity[]` (`{ paneKey, sessionId, transcriptPath?, worktreeId? }`), `setClaudeStatusLineListener`. Pane key ↔ PTY: `src/main/ipc/pty/pane/key-state.ts` (`ptyPaneKey: Map<ptyId, paneKey>`, `paneKeyPtyId: Map<paneKey, ptyId>`, `getPtyIdForPaneKey`); worktree per PTY: `src/main/memory/pty-registry.ts` `listRegisteredPtys(): PtyRegistration[]` (`{ ptyId, worktreeId, sessionId, paneKey, pid }`).
- Pane replacement (renderer IPC path only today): `src/main/ipc/pty/ipc/spawn-run.ts` lines 43–59 (`reserveIdlePaneSpawn(ownerKey)` then `stopReplacedPaneOwner(deps, { replacesPtyId, paneKey, worktreeId, connectionId })`), `spawn-commit-persist.ts` lines 64–66 (`swapReplacedPaneBinding(store, binding, ctx.replacedPaneOwner)`), catch → `releaseStoppedPaneBinding(deps.store, ctx.replacedPaneOwner)`. `pane-owner-replacement.ts`: `stopReplacedPaneOwner(deps: { runtime?; store?; stopReplacedPty: (id) => Promise<void> }, args)` throws `terminal_pane_owner_changed` when the persisted owner is not `replacesPtyId`; `ReplacedPaneOwner = { ptyId; pane: { worktreeId; tabId; leafId; hostId } | null }`. `stopReplacedPanePty(deps: PtyKillIpcDeps, id)` in `ipc/renderer-kill.ts`; `PtyKillIpcDeps` (`store?`, `runtime?`, `getLocalPtyProviderStartupPromise`, `shutdownProviderAndDetectExit`, `rememberSyntheticKillExit`, `sendPtyExitToRenderer`) is a subset of `PtyRuntimeControllerDeps` (`runtime/controller-deps.ts`). Runtime spawn: `runtime/spawn.ts` (`spawnPtyFromRuntimeController(deps, args)`, reservation logic lines 57–82), `runtime/spawn-commit.ts` (binding persist lines 138–169: `store.persistPtyBinding(binding)`, `false` → `terminal_split_source_not_found`), `runtime/spawn-state.ts` (`RuntimePtySpawnArgs`, `RuntimePtySpawnState`), contract `src/main/runtime/runtime-pty-controller-contract.ts` (`spawn?(opts)` lines 60–117). `OrcaRuntimeService.setPtyController` is in `src/main/runtime/orca-runtime-get-status.ts` line 208; the field `ptyController` is protected (`runtime-identity-state.ts:389`) and has no public getter.
- Resume building: `buildAgentResumeStartupPlan({ agent, providerSession, cmdOverrides, platform, shell?, agentArgs?, agentEnv?, … })` in `src/shared/tui-agent-resume-startup.ts` returns `AgentStartupPlan | null` (`launchCommand`, `env?`, `launchConfig`, `startupCommandDelivery?`); `resolveStartupShell(platform)` in `src/shared/tui-agent-startup-shell.ts`; `getAgentResumeArgv('claude', { key: 'session_id', id })` = `['claude', '--resume', id]`. The runtime's own terminal create spawns with `commandDelivery: 'provider'`, `launchAgent`, `resumeProviderSession`, `tabId`/`leafId`/`worktreeId`, and `BACKGROUND_TERMINAL_SPAWN_FLAGS = { initiallyHidden: true, persistHostSessionBinding: true }` (`src/main/runtime/terminal/launch/terminal-create.ts` lines 137–188).
- `ClaudeProfileRouter` (`src/main/claude-accounts/claude-profile-router.ts`): `launchEnv()` lines 281–288 (selected account only), `accountHome(accountId)`, `coveredBySystemDefault(accountId)`, `systemDefaultHome()`, private `describe(accountId)`, `setUp(profile)`, `envReady`, `REFRESH_WAIT_MS = 5_000`, `claudeProfileMarkerPath(profile)`; errors `claudeProfileMissing()` / `claudeProfileSetupFailed()` (messages `CLAUDE_PROFILE_MISSING_MESSAGE` / `CLAUDE_PROFILE_SETUP_FAILED_MESSAGE` from `src/shared/claude-profile-routing.ts`). The installed singleton: `getClaudeProfileRouter()` in `claude-profile-installed-router.ts` (installed by `ClaudeRuntimeAuthService`'s constructor on desktop AND orcad). Router test fixture conventions: `src/main/claude-accounts/claude-profile-router.test.ts` lines 36–105 (mocks `../startup/login-shell-environment` and `../macos-keychain/generic-password`, `agentStatusHooksEnabled: false`, `runSetup` stand-in writing the marker).
- Wiring: `src/main/provider-account-services.ts` (`createProviderAccountServices(store, { setClaudeStatusLineListener, onClaudeAutoSwitched? })`, must not import Electron), desktop `src/main/startup/main-process-account-services.ts` (notification via `getRuntimeDesktopSurface().showNotification({ title, body })` + `translateMain(key, fallback, options)`), headless `src/main/orcad/orcad-account-services.ts` (`attachToRuntime(runtime)`; the comment "Why no start(): … usage refreshes on demand" at line 76). Notices to paired clients: `runtime.dispatchMobileNotification({ type: 'notification', source: 'plugin', title, body })` (`MobileNotificationDispatchEvent.source` union is `'agent-task-complete' | 'terminal-bell' | 'test' | 'plugin'`).
- Settings: `claudeAutoSwitchEnabled?: boolean` at `src/shared/global-settings-types.ts:326`, default `false` at `src/shared/default-global-settings.ts:186`; `src/shared/claude-account-switch-settings.ts` (`ClaudeAccountSwitchSettings`, mixed into `GlobalSettings` through `global-settings-base.ts`). Accounts state `ClaudeRateLimitAccountsState` in `src/shared/managed-account-types.ts` lines 119–129 (`autoSwitchEnabled?`), built by `ClaudeAccountSelection.list()` (`claude-account-selection.ts` lines 66–90; `setAutoSwitch` lines 91–94; `ClaudeAccountSettings` Pick lines 28–34). Chain: `ClaudeAccountService.setAutoSwitch` (`service.ts:126`) → `RuntimeAccountController.setClaudeAutoSwitch` (`runtime-account-controller.ts:183`) → command surface (`runtime-service-command-surface.ts:54` type, `:160` binding) → RPC `accounts.setClaudeAutoSwitch` (`runtime/rpc/methods/accounts.ts` lines 127–132, params `SetClaudeAutoSwitchParams = z.object({ enabled: z.boolean() })` in `src/shared/rpc-contract/accounts-params.ts:34`; catalog `src/shared/rpc-contract/rpc-params-catalog.generated.ts` regenerated by `corepack pnpm run generate:rpc-params-catalog`, checked by `verify:rpc-params-catalog`; test `rpc/methods/accounts.test.ts` lines 195–209).
- CLI: `src/cli/specs/account.ts` (spec entries), `src/cli/handlers/account-auto-switch.ts` (handler shape: `ctx.flags.get('on') === true`, `ctx.client.call<T>(method, params)` → `{ result: T }`, `ctx.json`), `src/cli/handlers/account.ts:320` handlers map + `:44` import, `src/cli/handler-group-manifest.ts:38` keys, `src/cli/root-help-text-primary.ts:31`, `root-help-text-secondary.ts:47`, `src/cli/index.ts:34` remote-selection carve-out, `src/cli/handlers/account-list-format.ts` (`autoSwitchEnabled` line at 45–47), boolean flags registry `src/shared/cli-argument-boundary.ts` (`CLI_BOOLEAN_FLAGS`, alphabetical, has `'off'`, `'on'`). Tests: `src/cli/handlers/account.test.ts` (`describe('account auto-switch')` from line 742; `context('claude', json)` + `callMock` + `logSpy` helpers), `src/cli/index-local-command-routing-flags.test.ts` lines 272–298.
- Renderer: Settings row model `src/renderer/src/components/settings/claude-running-session-switch-setting.tsx` (mounted at `accounts-pane-claude-section.tsx:372` inside `isRemoteAccountScope ? null : (…)`), strings in `src/renderer/src/i18n/locales/en.json` under `accounts.claude` (block starts line 20028; `switchSessions` sub-block at 20051). Localization checks: `corepack pnpm run verify:localization-catalog` (fix: `sync:localization-catalog`), `verify:localization-extraction`, `verify:localization-coverage`.
- Build (from `scripts/orca-fork/rebuild.sh` in the BLOWzer repo): `corepack pnpm run build:desktop && corepack pnpm run build:computer-macos && corepack pnpm run build:keyboard-layout-macos && corepack pnpm run build:notification-status-macos && corepack pnpm run ensure:electron-runtime` then `CSC_NAME="Apple Development: nachumi Eliyahu (BDK84XWD78)" ORCA_NO_PUBLISH=1 ORCA_BUILD_COMMIT=$(git rev-parse --short=12 HEAD) ORCA_LOCAL_BUILD_VERSION=<ver> corepack pnpm exec electron-builder --config config/electron-builder.config.cjs --mac --arm64` (exit 1 from the refused darwin/x64 pass is expected; the arm64 bundle is what counts). **Version:** the installed fork builds are MacBook `1.4.231-blowzer.1` and Studio `1.4.231-blowzer.2`; upstream is at v1.4.232 and the fork branches carry it, so the scheme `<next upstream patch>-blowzer.N` makes this plan's build **`1.4.233-blowzer.1`**. Install: BLOWzer `scripts/orca-fork/studio-install.sh` (ships via `ssh macstudio 'cat > …'`) and `macbook-install.sh` (owner runs it from a plain terminal). Status log: BLOWzer `docs/team/orca-fork/STATUS.md` (one dated bullet per event).

---

## File structure

New files (each ≤ ~200 lines, one responsibility):

| Path | Responsibility |
|---|---|
| `src/main/claude-accounts/claude-pane-account-registry.ts` | In-memory registry ptyId → `{ accountId, paneKey, configDir, launchedAt, pinned, source }`; transcript-path inference. |
| `src/main/claude-accounts/claude-pane-account-registry.test.ts` | record / forget / list / byAccount / infer-from-transcript. |
| `src/main/ipc/pty/host-env/claude-pane-account.ts` | `recordClaudePaneAccountForSpawn` — turns a spawn's `ClaudeRuntimeAuthPreparation` into a registry record (provenance → accountId). |
| `src/main/ipc/pty/host-env/claude-pane-account.test.ts` | provenance mapping, reattach, non-Claude spawn, `profile:unavailable`. |
| `src/main/rate-limits/service-live-claude-usage-routing.test.ts` | statusline post of a non-selected account → its inactive entry; unknown folder dropped; selected unchanged. |
| `src/main/claude-accounts/claude-profile-router-launch-env-for.test.ts` | `launchEnvFor` / `preparationFor` / `prepareLaunchFor`. |
| `src/main/ipc/pty/runtime/spawn-replacement.ts` | `beginRuntimePaneReplacement` — hold the pane, prove the owner, stop it (the runtime-path twin of `spawn-run.ts` lines 43–59). |
| `src/main/ipc/pty/runtime/spawn-replacement.test.ts` | owner-changed → no stop + reservation released; match → stopped + reservation held. |
| `src/main/ipc/pty/runtime/spawn-claude-auth.ts` | `resolveRuntimeClaudeAuth` — `claudeAccountId` → target account's launch prep, else the selected account's. |
| `src/main/ipc/pty/runtime/spawn-claude-auth.test.ts` | both branches + missing router. |
| `src/main/claude-accounts/claude-session-mover-policy.ts` | Pure per-session decision over the shared lines: stay / read-usage / wait / move; cooldowns, pinned, claims + debit. |
| `src/main/claude-accounts/claude-session-mover-policy.test.ts` | the decision table. |
| `src/main/claude-accounts/claude-session-move-strategy.ts` | `ClaudeSessionMoveStrategy` interface + `createResumeMoveStrategy` (resume plan → `spawn({ replacesPtyId, claudeAccountId, … })`). |
| `src/main/claude-accounts/claude-session-move-strategy.test.ts` | inline `RuntimePtyController` fake: resume command, fields, owner-changed, no controller. |
| `src/main/claude-accounts/claude-session-mover-sessions.ts` | Joins registry + hook statuses + provider sessions into session views; per-account usage lookup; candidate filter. |
| `src/main/claude-accounts/claude-session-mover.ts` | The service: subscriptions, evaluate loop, claims, inflight, notices, decision records. |
| `src/main/claude-accounts/claude-session-mover.test.ts` | the eleven scenarios of spec §5. |
| `src/main/claude-accounts/claude-usage-polling-policy.ts` | `shouldPollClaudeUsage(settings)` + `createClaudeUsagePollingSwitch(rateLimits, getSettings)` for orcad. |
| `src/main/claude-accounts/claude-usage-polling-policy.test.ts` | start/stop idempotency per setting. |
| `src/cli/handlers/account-session-mover.ts` | `orca account session-mover --agent claude --off|--ask|--move`. |
| `src/renderer/src/components/settings/claude-session-mover-setting.tsx` | Settings → Accounts → Claude row (Off / Ask / Move). |

Modified files:

| Path | Change |
|---|---|
| `src/main/ipc/pty/runtime/spawn-commit.ts` | record the Claude pane account after the Codex record (line ~236). |
| `src/main/ipc/pty/ipc/spawn-commit-persist.ts` | same in `publishPtyIpcSpawnCommit` (after line 100). |
| `src/main/ipc/pty/provider/state-cleanup.ts` | `forgetClaudePaneAccount(id)` beside `forgetCodexPaneAccount(id)` (line 44). |
| `src/main/rate-limits/service/service-state.ts` | `liveClaudeAccountResolver` field. |
| `src/main/rate-limits/service/service-configuration.ts` | `setLiveClaudeAccountResolver`. |
| `src/main/rate-limits/service/service-fetch-policy.ts` | route non-selected posts to `inactiveClaudeCache` (`ingestLiveInactiveClaudeRateLimits`). |
| `src/main/claude-accounts/claude-profile-router.ts` | `launchEnvFor`, `preparationFor`, `prepareLaunchFor`. |
| `src/main/claude-accounts/runtime-auth-service.ts` | `prepareForClaudeLaunchOnAccount(accountId)`. |
| `src/main/runtime/runtime-pty-controller-contract.ts` | `spawn` opts `replacesPtyId?`, `claudeAccountId?`. |
| `src/main/ipc/pty/runtime/spawn-state.ts` | args fields + `replacedPaneOwner` state. |
| `src/main/ipc/pty/runtime/spawn.ts` | replacement branch + release on failure. |
| `src/main/ipc/pty/runtime/spawn-preflight.ts` | `ctx.claudeAuth` via `resolveRuntimeClaudeAuth`. |
| `src/main/runtime/construction/runtime-identity-state.ts` | `getPtyController()` getter (not `orca-runtime-get-status.ts`, which sits at 299/300 lines). |
| `src/main/claude-accounts/claude-account-auto-switch-policy.ts` | export `claudeAutoSwitchWindows`, `isClaudeAtLimit`, window types. |
| `src/main/claude-accounts/claude-account-auto-switch.ts` | export `isClaudeUsageReadingOf`, `claudeAccountsShareRuntime`. |
| `src/shared/claude-account-switch-settings.ts` | `ClaudeSessionMoverSetting` + `claudeSessionMover?` setting. |
| `src/shared/default-global-settings.ts` | `claudeSessionMover: 'ask'`. |
| `src/shared/managed-account-types.ts` | `ClaudeSessionMoveSummary`; `sessionMover?` + `sessionMoves?` on `ClaudeRateLimitAccountsState`. |
| `src/main/claude-accounts/claude-account-selection.ts` | `setSessionMover`, `setSessionMovesProvider`, list() fields. |
| `src/main/claude-accounts/service.ts` | delegate both. |
| `src/main/runtime/runtime-account-controller.ts` | `setClaudeSessionMover`. |
| `src/main/runtime/runtime-service-command-surface.ts` | surface type + binding. |
| `src/shared/rpc-contract/accounts-params.ts` | `SetClaudeSessionMoverParams`. |
| `src/main/runtime/rpc/methods/accounts.ts` | `accounts.setClaudeSessionMover`. |
| `src/shared/rpc-contract/rpc-params-catalog.generated.ts` | regenerated. |
| `src/main/runtime/rpc/methods/accounts.test.ts` | one test. |
| `src/shared/cli-argument-boundary.ts` | boolean flags `ask`, `move`. |
| `src/cli/specs/account.ts`, `src/cli/handlers/account.ts`, `src/cli/handler-group-manifest.ts`, `src/cli/root-help-text-primary.ts`, `src/cli/root-help-text-secondary.ts`, `src/cli/index.ts`, `src/cli/handlers/account-list-format.ts` | the CLI command, list line, routing carve-out. |
| `src/cli/handlers/account.test.ts`, `src/cli/index-local-command-routing-flags.test.ts` | tests. |
| `src/renderer/src/components/settings/accounts-pane-claude-section.tsx` | mount the row. |
| `src/renderer/src/i18n/locales/en.json` | `accounts.claude.sessionMover.*` strings. |
| `src/main/provider-account-services.ts` | live-usage resolver, mover construction + start, `sessionMover` in the result. |
| `src/main/startup/main-process-account-services.ts` | desktop notices + controller getter. |
| `src/main/orcad/orcad-account-services.ts` | polling switch, mover notices through `dispatchMobileNotification`. |
| BLOWzer `docs/team/orca-fork/STATUS.md` | rehearsal record (Task 11). |

---

### Task 0: Branch, install, baseline

**Files:** none changed; commit nothing.

- [ ] **Step 1: Branch from `blowzer/auto-switch`**

```bash
export N_PREFIX=$HOME/.n-orca PATH=$HOME/.n-orca/bin:$PATH
cd ~/Documents/claude/orca-fork
git status --short | wc -l
git rev-parse --short=10 blowzer/auto-switch
git checkout -b blowzer/session-mover blowzer/auto-switch
git branch --show-current
```
Expected: `0` (clean tree), `9f77257cea`, `Switched to a new branch 'blowzer/session-mover'`, `blowzer/session-mover`. If the tree is not clean, stop and report what is modified — never stash someone else's work.

- [ ] **Step 2: Install (both workspaces)**

```bash
corepack pnpm install --frozen-lockfile 2>&1 | tail -3
corepack pnpm --dir mobile install --frozen-lockfile 2>&1 | tail -2
node -v && corepack pnpm -v
```
Expected: `Done in …` lines, `v24.22.0`, `12.8.1`.

- [ ] **Step 3: Baseline the two existing auto-switch suites**

```bash
corepack pnpm exec vitest run --config config/vitest.config.ts src/main/claude-accounts/claude-account-auto-switch.test.ts src/main/claude-accounts/claude-account-auto-switch-policy.test.ts 2>&1 | tail -6
```
Expected:
```
 Test Files  2 passed (2)
      Tests  39 passed (39)
```

---

### Task 1: `ClaudePaneAccountRegistry` + recording at spawn + forget on exit + transcript inference

**Files:**
- Create: `src/main/claude-accounts/claude-pane-account-registry.ts`, `src/main/claude-accounts/claude-pane-account-registry.test.ts`
- Create: `src/main/ipc/pty/host-env/claude-pane-account.ts`, `src/main/ipc/pty/host-env/claude-pane-account.test.ts`
- Modify: `src/main/ipc/pty/runtime/spawn-commit.ts` (after line ~236), `src/main/ipc/pty/ipc/spawn-commit-persist.ts` (after line 100), `src/main/ipc/pty/provider/state-cleanup.ts` (line 44)

Design note: unlike the Codex registry this one is in memory. A daemon-kept PTY that outlives an app restart is re-learned from the hook server's `transcriptPath` (Step 5's inference), which is also how a `claude-pick` session (a shell with its own `CLAUDE_CONFIG_DIR`, never routed by main) is attributed — those inferred records are `pinned: true` and move only at the limit (spec §3.1). Records main wrote at spawn are `pinned: false`.

- [x] **Step 1: Write the registry test**

`src/main/claude-accounts/claude-pane-account-registry.test.ts`:
```ts
import { afterEach, describe, expect, it } from 'vitest'
import {
  _internals,
  forgetClaudePaneAccount,
  getClaudePaneAccount,
  inferClaudeAccountIdFromTranscript,
  listClaudePaneAccounts,
  listClaudePaneAccountsByAccount,
  recordClaudePaneAccount,
  type ClaudePaneAccountRecord
} from './claude-pane-account-registry'

function record(ptyId: string, accountId: string, pinned = false): ClaudePaneAccountRecord {
  return {
    ptyId,
    paneKey: `tab-${ptyId}:leaf-${ptyId}`,
    accountId,
    configDir: `/data/claude-profiles/${accountId}/home`,
    launchedAt: 1_000,
    pinned,
    source: pinned ? 'transcript' : 'spawn'
  }
}

describe('claude pane account registry', () => {
  afterEach(() => {
    _internals.reset()
  })

  it('records, lists and forgets the account a PTY runs on', () => {
    recordClaudePaneAccount(record('pty-1', 'a'))
    recordClaudePaneAccount(record('pty-2', 'b'))
    recordClaudePaneAccount(record('pty-3', 'a', true))

    expect(getClaudePaneAccount('pty-1')).toEqual(record('pty-1', 'a'))
    expect(listClaudePaneAccounts().map((entry) => entry.ptyId)).toEqual(['pty-1', 'pty-2', 'pty-3'])
    expect(listClaudePaneAccountsByAccount('a').map((entry) => entry.ptyId)).toEqual(['pty-1', 'pty-3'])

    forgetClaudePaneAccount('pty-1')
    expect(getClaudePaneAccount('pty-1')).toBeNull()
    expect(listClaudePaneAccountsByAccount('a').map((entry) => entry.ptyId)).toEqual(['pty-3'])
  })

  it('re-recording a PTY replaces its record (a restarted pane shows its new account)', () => {
    recordClaudePaneAccount(record('pty-1', 'a'))
    recordClaudePaneAccount({ ...record('pty-1', 'c'), launchedAt: 2_000 })
    expect(getClaudePaneAccount('pty-1')?.accountId).toBe('c')
    expect(listClaudePaneAccounts()).toHaveLength(1)
  })

  it('infers the account from where Claude writes its transcript', () => {
    const accounts = [
      { id: 'a', homes: ['/data/claude-profiles/a/home'] },
      { id: 'b', homes: ['/legacy/unused', '/data/claude-profiles/b/home/'] }
    ]
    expect(
      inferClaudeAccountIdFromTranscript(
        '/data/claude-profiles/b/home/projects/-Users-x-repo/4f2c.jsonl',
        accounts
      )
    ).toEqual({ accountId: 'b', configDir: '/data/claude-profiles/b/home' })
    // System default or any folder no managed account owns.
    expect(
      inferClaudeAccountIdFromTranscript('/Users/x/.claude/projects/-Users-x-repo/4f2c.jsonl', accounts)
    ).toBeNull()
    // No transcript reported → the caller cannot know.
    expect(inferClaudeAccountIdFromTranscript(undefined, accounts)).toBeUndefined()
    expect(inferClaudeAccountIdFromTranscript('/no/projects/here.jsonl', accounts)).toBeUndefined()
  })
})
```

- [x] **Step 2: Run it — expect the module to be missing**

```bash
corepack pnpm exec vitest run --config config/vitest.config.ts src/main/claude-accounts/claude-pane-account-registry.test.ts 2>&1 | tail -12
```
Expected: `Test Files  1 failed (1)` with `Error: Failed to load url ./claude-pane-account-registry … Does the file exist?`.

- [x] **Step 3: Implement the registry**

`src/main/claude-accounts/claude-pane-account-registry.ts`:
```ts
import { normalizeClaudeConfigDir } from '../rate-limits/service/service-types'

/**
 * Which managed Claude account each live PTY runs on.
 *
 * Why: `CLAUDE_CONFIG_DIR` is baked into a PTY's environment at spawn, so the account a session runs
 * on is fixed for its life; the session mover needs that account to read the right usage and to
 * know where a resume must NOT land. Kept in memory: a PTY that outlives the app is re-learned from
 * the hook server's transcript path (`inferClaudeAccountIdFromTranscript`).
 */

export type ClaudePaneAccountSource = 'spawn' | 'transcript'

export type ClaudePaneAccountRecord = {
  ptyId: string
  paneKey: string | null
  accountId: string
  /** The folder the session runs in; null when it was not known. */
  configDir: string | null
  launchedAt: number
  /**
   * The folder was chosen by the launch itself (claude-pick, a shell's own CLAUDE_CONFIG_DIR), not
   * by Orca's routing. Such a session is moved only once its account is AT the line.
   */
  pinned: boolean
  source: ClaudePaneAccountSource
}

const records = new Map<string, ClaudePaneAccountRecord>()

export function recordClaudePaneAccount(record: ClaudePaneAccountRecord): void {
  records.set(record.ptyId, record)
}

export function forgetClaudePaneAccount(ptyId: string): void {
  records.delete(ptyId)
}

export function getClaudePaneAccount(ptyId: string): ClaudePaneAccountRecord | null {
  return records.get(ptyId) ?? null
}

export function listClaudePaneAccounts(): ClaudePaneAccountRecord[] {
  return [...records.values()]
}

export function listClaudePaneAccountsByAccount(accountId: string): ClaudePaneAccountRecord[] {
  return listClaudePaneAccounts().filter((record) => record.accountId === accountId)
}

export type ClaudeAccountHomes = { id: string; homes: readonly (string | null | undefined)[] }

function comparableFolder(path: string | null | undefined): string | null {
  const normalized = normalizeClaudeConfigDir(path)
  // Why: Windows paths differ only by case between what Claude reports and what Orca built.
  return normalized && process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

/**
 * The account whose folder holds the transcript (`<CLAUDE_CONFIG_DIR>/projects/...`), as the
 * renderer's resolveClaudeSessionAccountId reads it. Null: a folder no managed account owns (System
 * default). Undefined: no transcript, so the caller cannot know.
 */
export function inferClaudeAccountIdFromTranscript(
  transcriptPath: string | undefined,
  accounts: readonly ClaudeAccountHomes[]
): { accountId: string; configDir: string } | null | undefined {
  const transcript = comparableFolder(transcriptPath) ?? ''
  const projectsIndex = transcript.lastIndexOf('/projects/')
  if (projectsIndex <= 0) {
    return undefined
  }
  const configDir = transcript.slice(0, projectsIndex)
  for (const account of accounts) {
    if (account.homes.some((home) => comparableFolder(home) === configDir)) {
      return { accountId: account.id, configDir }
    }
  }
  return null
}

export const _internals = {
  reset: (): void => {
    records.clear()
  }
}
```

- [x] **Step 4: Run the registry test — expect green**

```bash
corepack pnpm exec vitest run --config config/vitest.config.ts src/main/claude-accounts/claude-pane-account-registry.test.ts 2>&1 | tail -6
```
Expected: `Test Files  1 passed (1)`, `Tests  3 passed (3)`.

- [x] **Step 5: Write the spawn-recorder test**

`src/main/ipc/pty/host-env/claude-pane-account.test.ts`:
```ts
import { afterEach, describe, expect, it } from 'vitest'
import {
  _internals,
  getClaudePaneAccount,
  recordClaudePaneAccount
} from '../../../claude-accounts/claude-pane-account-registry'
import type { ClaudeRuntimeAuthPreparation } from '../../../claude-accounts/runtime-auth-service'
import {
  claudeAccountIdFromProvenance,
  recordClaudePaneAccountForSpawn
} from './claude-pane-account'

const HOST = { runtime: 'host' as const }
const settings = { activeClaudeManagedAccountId: 'a', activeClaudeManagedAccountIdsByRuntime: undefined }

function auth(provenance: string, configDir = '/data/claude-profiles/b/home'): ClaudeRuntimeAuthPreparation {
  return { configDir, envPatch: { CLAUDE_CONFIG_DIR: configDir }, provenance }
}

function spawn(overrides: Partial<Parameters<typeof recordClaudePaneAccountForSpawn>[0]> = {}) {
  recordClaudePaneAccountForSpawn({
    ptyId: 'pty-1',
    paneKey: 'tab-1:leaf-1',
    isClaudeLaunch: true,
    isReattach: false,
    claudeAuth: auth('profile:b'),
    settings,
    target: HOST,
    now: 5_000,
    ...overrides
  })
}

describe('recordClaudePaneAccountForSpawn', () => {
  afterEach(() => {
    _internals.reset()
  })

  it('maps provenance to the account', () => {
    expect(claudeAccountIdFromProvenance('profile:b', settings, HOST)).toBe('b')
    expect(claudeAccountIdFromProvenance('profile:b:wsl:Ubuntu', settings, HOST)).toBe('b')
    // System default runs the selected account when it covers it.
    expect(claudeAccountIdFromProvenance('system', settings, HOST)).toBe('a')
    expect(claudeAccountIdFromProvenance('system', { activeClaudeManagedAccountId: null }, HOST)).toBeNull()
    expect(claudeAccountIdFromProvenance('profile:unavailable', settings, HOST)).toBeNull()
  })

  it('records a routed Claude launch as unpinned', () => {
    spawn()
    expect(getClaudePaneAccount('pty-1')).toEqual({
      ptyId: 'pty-1',
      paneKey: 'tab-1:leaf-1',
      accountId: 'b',
      configDir: '/data/claude-profiles/b/home',
      launchedAt: 5_000,
      pinned: false,
      source: 'spawn'
    })
  })

  it('leaves a reattached PTY alone and forgets a reused id that runs something else', () => {
    spawn()
    spawn({ isReattach: true, claudeAuth: null, isClaudeLaunch: false })
    expect(getClaudePaneAccount('pty-1')?.accountId).toBe('b')
    spawn({ isClaudeLaunch: false, claudeAuth: null })
    expect(getClaudePaneAccount('pty-1')).toBeNull()
  })

  it('forgets a launch whose account cannot be named', () => {
    recordClaudePaneAccount({
      ptyId: 'pty-1', paneKey: null, accountId: 'old', configDir: null, launchedAt: 1, pinned: false, source: 'spawn'
    })
    spawn({ claudeAuth: auth('profile:unavailable', '') })
    expect(getClaudePaneAccount('pty-1')).toBeNull()
  })
})
```

- [x] **Step 6: Run it — expect the module to be missing**

```bash
corepack pnpm exec vitest run --config config/vitest.config.ts src/main/ipc/pty/host-env/claude-pane-account.test.ts 2>&1 | tail -8
```
Expected: `Error: Failed to load url ./claude-pane-account … Does the file exist?`

- [x] **Step 7: Implement the recorder**

`src/main/ipc/pty/host-env/claude-pane-account.ts`:
```ts
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import {
  forgetClaudePaneAccount,
  recordClaudePaneAccount
} from '../../../claude-accounts/claude-pane-account-registry'
import type { ClaudeRuntimeAuthPreparation } from '../../../claude-accounts/runtime-auth-service'
import {
  getSelectedClaudeAccountIdForTarget,
  type ClaudeAccountSelectionTarget
} from '../../../claude-accounts/runtime-selection'

type ClaudePaneAccountSettings = Partial<
  Pick<GlobalSettings, 'activeClaudeManagedAccountId' | 'activeClaudeManagedAccountIdsByRuntime'>
>

/**
 * `profile:<id>` (or `profile:<id>:wsl:<distro>`) names the account; `system` means System default,
 * which runs the selected account when it covers it; anything else names no managed account.
 */
export function claudeAccountIdFromProvenance(
  provenance: string,
  settings: ClaudePaneAccountSettings | undefined,
  target: ClaudeAccountSelectionTarget
): string | null {
  if (provenance.startsWith('profile:')) {
    const id = provenance.split(':')[1]
    return id && id !== 'unavailable' ? id : null
  }
  if (provenance === 'system') {
    return getSelectedClaudeAccountIdForTarget(settings ?? {}, target)
  }
  return null
}

/**
 * Records the account a Claude launch runs on; both spawn choke points (renderer pty:spawn and the
 * runtime controller) call this after the spawn committed, as recordCodexPaneAccountForSpawn does.
 */
export function recordClaudePaneAccountForSpawn(args: {
  ptyId: string
  paneKey: string | null
  isClaudeLaunch: boolean
  isReattach: boolean
  claudeAuth: ClaudeRuntimeAuthPreparation | null
  settings: ClaudePaneAccountSettings | undefined
  target: ClaudeAccountSelectionTarget
  now?: number
}): void {
  // Why: a reattach inherits the baked environment; re-recording it under today's selection would
  // erase the account the launch recorded.
  if (args.isReattach) {
    return
  }
  if (!args.isClaudeLaunch || !args.claudeAuth) {
    forgetClaudePaneAccount(args.ptyId)
    return
  }
  const accountId = claudeAccountIdFromProvenance(args.claudeAuth.provenance, args.settings, args.target)
  if (!accountId) {
    forgetClaudePaneAccount(args.ptyId)
    return
  }
  recordClaudePaneAccount({
    ptyId: args.ptyId,
    paneKey: args.paneKey,
    accountId,
    configDir: args.claudeAuth.configDir || null,
    launchedAt: args.now ?? Date.now(),
    // Why false: Orca chose this folder; a session whose shell chose its own is learned from its
    // transcript later and marked pinned there.
    pinned: false,
    source: 'spawn'
  })
}
```

- [x] **Step 8: Run both tests — expect green**

```bash
corepack pnpm exec vitest run --config config/vitest.config.ts src/main/ipc/pty/host-env/claude-pane-account.test.ts src/main/claude-accounts/claude-pane-account-registry.test.ts 2>&1 | tail -6
```
Expected: `Test Files  2 passed (2)`, `Tests  7 passed (7)`.

- [x] **Step 9: Record at both commit sites and forget on teardown**

`src/main/ipc/pty/runtime/spawn-commit.ts` — add the import next to the codex-home import (lines 9–13):
```ts
import { recordClaudePaneAccountForSpawn } from '../host-env/claude-pane-account'
```
and right after the line `const paneKey = rememberPaneKeyForPty(ctx.result.id, ctx.env?.ORCA_PANE_KEY)` (≈ line 236) insert:
```ts
  // Why: the session mover needs the account each Claude pane runs on; the Codex record above has no Claude twin.
  recordClaudePaneAccountForSpawn({
    ptyId: ctx.result.id,
    paneKey,
    isClaudeLaunch: ctx.isClaudeLaunch,
    isReattach: ctx.result.isReattach === true,
    claudeAuth: ctx.claudeAuth,
    settings: ctx.deps.getSettings?.(),
    target: ctx.codexSelectionTarget
  })
```

`src/main/ipc/pty/ipc/spawn-commit-persist.ts` — import beside line 4:
```ts
import { recordClaudePaneAccountForSpawn } from '../host-env/claude-pane-account'
```
and after the `recordCodexPaneAccountForSpawn({ … })` call in `publishPtyIpcSpawnCommit` (ends line 100) insert:
```ts
  recordClaudePaneAccountForSpawn({
    ptyId: ctx.result.id,
    paneKey: ctx.validatedPaneKey,
    isClaudeLaunch: ctx.isClaudeLaunch,
    isReattach: ctx.result.isReattach === true,
    claudeAuth: ctx.claudeAuth,
    settings: ctx.deps.getSettings?.(),
    target: ctx.codexSelectionTarget
  })
```

`src/main/ipc/pty/provider/state-cleanup.ts` — import after line 3:
```ts
import { forgetClaudePaneAccount } from '../../../claude-accounts/claude-pane-account-registry'
```
and after line 44 `forgetCodexPaneAccount(id)` add:
```ts
    forgetClaudePaneAccount(id)
```

- [x] **Step 10: Typecheck main and run the touched suites**

```bash
corepack pnpm run typecheck:node 2>&1 | tail -3
corepack pnpm exec vitest run --config config/vitest.config.ts src/main/ipc/pty/runtime src/main/ipc/pty/ipc src/main/ipc/pty/provider src/main/claude-accounts/claude-pane-account-registry.test.ts src/main/ipc/pty/host-env 2>&1 | tail -6
```
Expected: typecheck ends without `error TS`; vitest `Test Files  N passed (N)` with no failures (N = whatever those folders hold; today they pass).

- [x] **Step 11: Commit**

```bash
git add src/main/claude-accounts/claude-pane-account-registry.ts src/main/claude-accounts/claude-pane-account-registry.test.ts src/main/ipc/pty/host-env/claude-pane-account.ts src/main/ipc/pty/host-env/claude-pane-account.test.ts src/main/ipc/pty/runtime/spawn-commit.ts src/main/ipc/pty/ipc/spawn-commit-persist.ts src/main/ipc/pty/provider/state-cleanup.ts
git commit -m "feat(claude-accounts): registry of the account each live Claude pane runs on"
git log -1 --format='%an <%ae>%n%B'
```
Expected: author `Nachumi Eliyahu <nachumi@a2zoperations.com>`, body = the one subject line, no trailers.

---

### Task 2: Live usage routing — a non-selected account's statusline post feeds its own entry

**Files:**
- Modify: `src/main/rate-limits/service/service-state.ts` (field, after line 111), `src/main/rate-limits/service/service-configuration.ts` (setter, after line 77), `src/main/rate-limits/service/service-fetch-policy.ts` (`ingestLiveClaudeRateLimits`, lines 107–165), `src/main/provider-account-services.ts` (resolver wiring after line 170)
- Create: `src/main/rate-limits/service-live-claude-usage-routing.test.ts`

Design note: the inactive-account resolver (`InactiveClaudeAccountInfo`) carries no folder path, so the service gets a second, tiny resolver `configDir → accountId` that the wiring answers from `ClaudeProfileRouter.accountHome`. Posts from the selected account keep today's path untouched; posts from an inactive managed account are stored in `inactiveClaudeCache` with the same shape a polled reading has; posts from unknown folders are still dropped.

- [x] **Step 1: Write the routing test**

`src/main/rate-limits/service-live-claude-usage-routing.test.ts` — the `vi.mock` block is the one at the top of `service-live-claude-usage.test.ts` (lines 17–75), copied verbatim; the cases follow:
```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RateLimitService } from './service'
import { fetchClaudeRateLimits } from './claude-fetcher'
import { mockFreshBackgroundProviderFetches, okProvider, resetRateLimitProviderMocks } from './rate-limit-service-test-harness'

const profileRouter = vi.hoisted((): { userConfigDir?: string } => ({}))
vi.mock('../claude-accounts/claude-profile-installed-router', () => ({
  getClaudeProfileRouter: () =>
    profileRouter.userConfigDir ? { userConfigDir: () => profileRouter.userConfigDir } : undefined
}))
vi.mock('./claude-fetcher', () => ({ fetchClaudeRateLimits: vi.fn(), fetchManagedAccountUsage: vi.fn() }))
vi.mock('./codex-fetcher', () => ({ consumeCodexRateLimitResetCredit: vi.fn(), fetchCodexRateLimits: vi.fn() }))
vi.mock('./gemini-usage-fetcher', () => ({ fetchGeminiRateLimits: vi.fn() }))
vi.mock('./kimi-fetcher', () => ({ fetchKimiRateLimits: vi.fn() }))
vi.mock('./opencode-go-usage-source-selection', () => ({ fetchOpenCodeGoUsage: vi.fn() }))
vi.mock('./zcode-usage-fetcher', () => ({ fetchZcodeRateLimits: vi.fn() }))
vi.mock('./antigravity-usage-fetcher', () => ({ fetchAntigravityRateLimits: vi.fn() }))
vi.mock('./minimax/minimax-fetcher', () => ({ fetchMiniMaxRateLimits: vi.fn() }))
vi.mock('./grok-fetcher', () => ({ fetchGrokRateLimits: vi.fn() }))
vi.mock('./cursor-fetcher', () => ({ fetchCursorRateLimits: vi.fn() }))
vi.mock('./cursor-auth', () => ({ readCursorAuthSession: vi.fn() }))
vi.mock('./grok-auth', () => ({ readGrokAuthSession: vi.fn(() => ({ status: 'missing' })) }))
vi.mock('../minimax/minimax-cookie-store', () => ({ hasMiniMaxSessionCookie: vi.fn(() => false) }))

// a = the SELECTED account (never in the inactive list); b, c = non-selected managed accounts.
const HOMES: Record<string, string> = {
  a: '/data/claude-profiles/a/home',
  b: '/data/claude-profiles/b/home',
  c: '/data/claude-profiles/c/home'
}

function service(): RateLimitService {
  const rateLimits = new RateLimitService()
  rateLimits.setInactiveClaudeAccountsResolver(() => [{ id: 'b' }, { id: 'c' }])
  rateLimits.setLiveClaudeAccountResolver(
    (configDir) => Object.entries(HOMES).find(([, home]) => home === configDir)?.[0] ?? null
  )
  return rateLimits
}

describe('RateLimitService live Claude usage routing', () => {
  beforeEach(() => {
    resetRateLimitProviderMocks()
  })

  it('lands a non-selected managed account\'s statusline post in that account\'s entry', () => {
    const rateLimits = service()
    rateLimits.ingestLiveClaudeRateLimits({
      configDir: '/data/claude-profiles/b/home/',
      fiveHour: { used_percentage: 96, resets_at: Math.floor(Date.now() / 1000) + 600 },
      sevenDay: { used_percentage: 41 }
    })
    const state = rateLimits.getState()
    expect(state.claude).toBeNull()
    const b = state.inactiveClaudeAccounts.find((usage) => usage.accountId === 'b')
    expect(b?.rateLimits?.session?.usedPercent).toBe(96)
    expect(b?.rateLimits?.weekly?.usedPercent).toBe(41)
    expect(b?.rateLimits?.status).toBe('ok')
    expect(b?.rateLimits?.usageMetadata).toMatchObject({
      source: 'live-session',
      authProvenance: 'profile:b'
    })
    expect(b?.isFetching).toBe(false)
  })

  it('keeps a window the post did not carry and ignores a same-value repeat inside the dedupe window', () => {
    vi.useFakeTimers()
    try {
      const rateLimits = service()
      const listener = vi.fn()
      rateLimits.onStateChange(listener)
      rateLimits.ingestLiveClaudeRateLimits({ configDir: HOMES.c, fiveHour: { used_percentage: 10 }, sevenDay: { used_percentage: 70 } })
      rateLimits.ingestLiveClaudeRateLimits({ configDir: HOMES.c, fiveHour: { used_percentage: 12 }, sevenDay: null })
      const c = rateLimits.getState().inactiveClaudeAccounts.find((usage) => usage.accountId === 'c')
      expect(c?.rateLimits?.session?.usedPercent).toBe(12)
      expect(c?.rateLimits?.weekly?.usedPercent).toBe(70)
      const publishes = listener.mock.calls.length
      rateLimits.ingestLiveClaudeRateLimits({ configDir: HOMES.c, fiveHour: { used_percentage: 12 }, sevenDay: null })
      expect(listener.mock.calls.length).toBe(publishes)
    } finally {
      vi.useRealTimers()
    }
  })

  it('still drops a post from a folder no managed account owns', () => {
    const rateLimits = service()
    rateLimits.ingestLiveClaudeRateLimits({ configDir: '/Users/x/.claude', fiveHour: { used_percentage: 99 }, sevenDay: null })
    const state = rateLimits.getState()
    expect(state.claude).toBeNull()
    expect(state.inactiveClaudeAccounts).toEqual([])
  })

  // The three cases below were added after the quality review (second commit, c049bcd32f).
  it("leaves the selected account's own post on the bar path", async () => {
    vi.useFakeTimers()
    try {
      vi.mocked(fetchClaudeRateLimits).mockResolvedValue(okProvider('claude', 18))
      mockFreshBackgroundProviderFetches()
      const rateLimits = service()
      rateLimits.setClaudeAuthPreparationResolver(async () => ({
        configDir: HOMES.a,
        // Why: a managed account injects its folder; the auth snapshot reads it from here.
        envPatch: { CLAUDE_CONFIG_DIR: HOMES.a },
        provenance: 'profile:a'
      }))
      await rateLimits.refresh()
      rateLimits.ingestLiveClaudeRateLimits({
        configDir: HOMES.a,
        fiveHour: { used_percentage: 55 },
        sevenDay: { used_percentage: 20 }
      })
      const state = rateLimits.getState()
      expect(state.claude?.session?.usedPercent).toBe(55)
      expect(state.claude?.weekly?.usedPercent).toBe(20)
      expect(state.inactiveClaudeAccounts).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })

  it('ignores a post that carries neither window', () => {
    const rateLimits = service()
    const listener = vi.fn()
    rateLimits.onStateChange(listener)
    rateLimits.ingestLiveClaudeRateLimits({ configDir: HOMES.b, fiveHour: null, sevenDay: null })
    const state = rateLimits.getState()
    expect(state.inactiveClaudeAccounts.find((usage) => usage.accountId === 'b')).toBeUndefined()
    expect(state.claude).toBeNull()
    expect(listener).not.toHaveBeenCalled()
  })

  it('drops the post without throwing when the account resolver throws', () => {
    const rateLimits = new RateLimitService()
    rateLimits.setInactiveClaudeAccountsResolver(() => [{ id: 'b' }, { id: 'c' }])
    rateLimits.setLiveClaudeAccountResolver(() => {
      throw new Error('boom')
    })
    expect(() =>
      rateLimits.ingestLiveClaudeRateLimits({
        configDir: HOMES.b,
        fiveHour: { used_percentage: 99 },
        sevenDay: null
      })
    ).not.toThrow()
    const state = rateLimits.getState()
    expect(state.claude).toBeNull()
    expect(state.inactiveClaudeAccounts).toEqual([])
  })
})
```

- [x] **Step 2: Run it — expect the missing setter**

```bash
corepack pnpm exec vitest run --config config/vitest.config.ts src/main/rate-limits/service-live-claude-usage-routing.test.ts 2>&1 | tail -10
```
Expected: `Tests  3 failed (3)` with `TypeError: rateLimits.setLiveClaudeAccountResolver is not a function`.

- [x] **Step 3: Add the field and the setter**

`src/main/rate-limits/service/service-state.ts` — after line 111 (`protected inactiveClaudeAccountsResolver …`):
```ts
  // Why: statusline posts name a folder, not an account; the account layer answers which managed account owns it.
  protected liveClaudeAccountResolver: ((configDir: string) => string | null) | null = null
```

`src/main/rate-limits/service/service-configuration.ts` — after `setInactiveClaudeAccountsResolver` (line 77):
```ts
  /** Maps a normalized `CLAUDE_CONFIG_DIR` to the managed account whose folder it is, or null. */
  setLiveClaudeAccountResolver(resolver: (configDir: string) => string | null): void {
    this.liveClaudeAccountResolver = resolver
  }
```

- [x] **Step 4: Route the post**

`src/main/rate-limits/service/service-fetch-policy.ts` — replace the start of `ingestLiveClaudeRateLimits` (lines 107–116, from the doc comment through the `if (!snapshot) { … return }` block) with:
```ts
  /** Live usage windows forwarded from a Claude session's statusLine command. */
  ingestLiveClaudeRateLimits(event: ClaudeStatusLineRateLimits): void {
    // Why first: a session of another managed account reports that account's own quota; keeping it in
    // the account's entry gives the session mover a fresh reading between polls, for free.
    const eventConfigDir = normalizeClaudeConfigDir(event.configDir)
    let liveAccountId: string | null = null
    if (eventConfigDir) {
      try {
        liveAccountId = this.liveClaudeAccountResolver?.(eventConfigDir) ?? null
      } catch (error) {
        // Why swallow: the resolver is wired from outside; its failure must never stop the selected account's own feed.
        console.debug('[rate-limits] live account resolver threw', { eventConfigDir, error })
      }
    }
    if (
      liveAccountId &&
      (this.inactiveClaudeAccountsResolver?.() ?? []).some((account) => account.id === liveAccountId)
    ) {
      this.ingestLiveInactiveClaudeRateLimits(liveAccountId, event)
      return
    }
    // Why: attribution needs the selected account's config dir; until a fetch cycle captures it, drop posts rather than guess the account.
    const snapshot = this.lastClaudeAuthSnapshot
    if (!snapshot) {
      // Why: breadcrumbs make a silently dark live feed diagnosable — dropped posts are otherwise invisible.
      console.debug('[rate-limits] dropped live Claude usage: no auth snapshot yet', {
        eventConfigDir: event.configDir
      })
      return
    }
```
(the rest of the method, from the `configDir mismatch` check on, stays as it is) and add this method after `ingestLiveClaudeRateLimits` (before the class's closing brace):
```ts
  // Why its own entry and not the bar: the selected account's bar must never show another account's quota.
  protected ingestLiveInactiveClaudeRateLimits(accountId: string, event: ClaudeStatusLineRateLimits): void {
    const freshSession = mapClaudeUsageWindow(event.fiveHour ?? undefined, 300)
    const freshWeekly = mapClaudeUsageWindow(event.sevenDay ?? undefined, 10080)
    if (!freshSession && !freshWeekly) {
      return
    }
    const previous = this.inactiveClaudeCache.get(accountId) ?? null
    const session = freshSession ?? previous?.session ?? null
    const weekly = freshWeekly ?? previous?.weekly ?? null
    if (
      previous?.status === 'ok' &&
      previous.usageMetadata?.source === 'live-session' &&
      Date.now() - previous.updatedAt < LIVE_CLAUDE_INGEST_DEDUPE_MS &&
      isSameUsageWindow(previous.session, session) &&
      isSameUsageWindow(previous.weekly, weekly)
    ) {
      return
    }
    this.inactiveClaudeCache.set(accountId, {
      provider: 'claude',
      session,
      weekly,
      fableWeekly: previous?.fableWeekly ?? null,
      updatedAt: Date.now(),
      error: null,
      status: 'ok',
      usageMetadata: {
        source: 'live-session',
        lastSuccessfulSource: 'live-session',
        credentialSource: previous?.usageMetadata?.credentialSource,
        retryAtMs: previous?.usageMetadata?.retryAtMs,
        authProvenance: `profile:${accountId}`
      }
    })
    this.pushToRenderer()
  }
```

- [x] **Step 5: Run the new test and the existing live-usage suites — expect green**

```bash
corepack pnpm exec vitest run --config config/vitest.config.ts src/main/rate-limits/service-live-claude-usage-routing.test.ts src/main/rate-limits/service-live-claude-usage.test.ts src/main/rate-limits/service-inactive-claude-cooldown.test.ts 2>&1 | tail -6
```
Expected: `Test Files  3 passed (3)`, all tests passed (3 new + the existing counts).

- [x] **Step 6: Wire the resolver**

`src/main/provider-account-services.ts` — after the `setInactiveClaudeAccountsResolver` call (ends line 170) add:
```ts
  // Why: a statusline post names its CLAUDE_CONFIG_DIR; only the account layer knows whose folder that is.
  rateLimits.setLiveClaudeAccountResolver((configDir) => {
    for (const account of store.getSettings().claudeManagedAccounts) {
      let home: string
      try {
        home = claudeRuntimeAuth.router.accountHome(account.id)
      } catch {
        // Why skip, not throw: describeClaudeProfile refuses a malformed id; one bad row must not dark the live feed.
        continue
      }
      if (normalizeClaudeConfigDir(home) === configDir) {
        return account.id
      }
    }
    return null
  })
```
and add the import at the top:
```ts
import { normalizeClaudeConfigDir } from './rate-limits/service/service-types'
```

- [x] **Step 7: Typecheck, run the rate-limits folder, commit**

```bash
corepack pnpm run typecheck:node 2>&1 | tail -3
corepack pnpm exec vitest run --config config/vitest.config.ts src/main/rate-limits 2>&1 | tail -6
git add src/main/rate-limits/service/service-state.ts src/main/rate-limits/service/service-configuration.ts src/main/rate-limits/service/service-fetch-policy.ts src/main/rate-limits/service-live-claude-usage-routing.test.ts src/main/provider-account-services.ts
git commit -m "feat(rate-limits): keep live usage of non-selected Claude accounts in their own entry"
```
Expected: no `error TS`; `Test Files  N passed (N)`; commit by Nachumi Eliyahu, no trailers.

**Controller notes after the Task 2 quality review (2026-10-19, reviewer: ready with fixes, no Critical):**
- The guards in Step 4 and Step 6 were added after the review: `describeClaudeProfile` throws `Invalid Claude profile location` for an id outside `[a-zA-Z0-9_-]+`, and the resolver now runs AHEAD of the selected account's own path, so a resolver failure must never leave `ingestLiveClaudeRateLimits` (that would be a regression of the bar's live feed). They ship as a second commit, `fix(rate-limits): guard the live account resolver; cover the selected fall-through and empty posts`, together with three more cases in the routing test (A: the selected account's own post still lands in `state.claude` through the snapshot path while `inactiveClaudeAccounts` stays empty; B: a post with both windows null creates no entry and publishes nothing; C: a throwing resolver drops the post without throwing). Their final text is under Step 1 (commit `c049bcd32f`). FACT the fall-through test exposed: `lastClaudeAuthSnapshot` takes its folder from the preparation's `envPatch.CLAUDE_CONFIG_DIR`, NOT from `configDir` (a managed account injects that variable, `claude-account-folder.ts:39`; the sibling suite's System-default cases set it with `vi.stubEnv`) — any later test that wants the selected path to accept a post must set it in `envPatch`.
- FOLD INTO THE MOVER TASK (the one that reads `inactiveClaudeAccounts` for a move decision): NEWER-WINS in `src/main/rate-limits/service/service-inactive-accounts.ts` `fetchInactiveClaudeAccountsOnOpen` — skip the cache write when the cached entry has `usageMetadata.source === 'live-session'` and its `updatedAt` is later than the poll's start time. Today a poll that STARTED before a live post overwrites the fresher reading with the older polled value (window = the fetch's duration; a failed poll already keeps the live entry through `applyStalePolicy`).
- Later, a behaviour change of its own: the inactive poller filters only on `isRetryAfterActive` and never applies `shouldSkipAutomatedClaudeFetch`; applying it would spare OAuth calls (and 429s) for accounts that already have fresh live data.
- Coverage gap, not a regression: `accountHome` describes the HOST runtime, so a non-selected account's session running inside WSL posts a Linux `CLAUDE_CONFIG_DIR` the resolver never matches — those posts are still dropped. WSL accounts are out of the mover's scope (Task 3 says so too); say it in the mover's docs.
- Windows drive-letter case (`C:` vs `c:`) is not normalized on either side of the comparison — consistent with the existing selected-account comparison at `service-fetch-policy.ts` (configDir mismatch check); leave it.
- `service-fetch-policy.ts` grew 166 → 222 lines and still holds one concern. If a later task adds more live-ingest logic, move both ingest methods into their own layer of the class chain (`service-live-claude-ingest.ts`).
- **Task 2 APPROVED at `c049bcd32f` (quality re-review 2026-10-19).** Minor leftovers for whichever task next touches `service-live-claude-usage-routing.test.ts` (likely the mover task): (a) the comment in case A names the wrong source — a managed account's `CLAUDE_CONFIG_DIR` comes from `launchEnv()` (`claude-profile-router.ts:281-287`) through `preparation()` (~L320-331), not `claude-account-folder.ts:39`; (b) add case A's setup + a THROWING resolver and assert the selected account's post still reaches the bar (session 55) — case C alone cannot tell "guard worked" from "dropped for lack of a snapshot"; (c) the wiring guard in `provider-account-services.ts` has no unit test and no suite exists for `createProviderAccountServices` — the service guard covers the blast radius; the final whole-implementation review decides whether a wiring harness is worth building.

---

### Task 3: `ClaudeProfileRouter.launchEnvFor(accountId)` — a launch on a chosen account

Goal: give the main process a launch env and a launch preparation for a CHOSEN Claude account, whatever the selection is, so Task 4's runtime spawn and Task 6's resume can start Claude on the target account.

> **As built (recorded 2026-10-20).** Task 3 is history. Fork `~/Documents/claude/orca-fork`, branch `blowzer/session-mover`. Commits: first cut `6989d1ac1d` → fix `66c0720680` → fix2 `bc6d91df73` → fix3 `e6b9944979`; then merge `b93676d809` with upstream v1.4.232 (`be87ad28a9`, via `blowzer/auto-switch`). The pre-build code blocks of the earlier revisions were removed because they no longer match the code; read the commits for the exact text. Line numbers below are at `b93676d809`.

**Files**

Created:
- `src/main/claude-accounts/claude-profile-chosen-account.ts` (113 lines) — `ChosenAccountRouting` (what the router lends: `getSettings`, `coveredBySystemDefault`, `hasOwnLogin`, `accountHome`, `systemDefaultHome`, `env`, `envReady`, `setUpForLaunch`), `chosenAccountLaunchEnv`, `chosenAccountPreparation`, `prepareChosenAccountLaunch`; private `assertKnownHostAccount`, `envForKnown`, `preparationForKnown`.
- `src/main/claude-accounts/claude-profile-setup-queue.ts` (93 lines) — `ClaudeProfileSetupQueue`: `run`, `runInBackground`, `settle`, `runForLaunch`, private `runOnce`. One queue serves `prepareLaunch()`, `prepareLaunchFor()`, `prepareAccount()` and `removeAccount()`.
- `src/main/claude-accounts/claude-profile-system-default-comparison.ts` (43 lines) — `SystemDefaultReads`, `claudeAccountUsagePreparation`, `systemDefaultRunsAnotherAccount` (moved out of the router).
- `src/main/claude-accounts/claude-profile-router-launch-env-for.test.ts` (10 tests).

Modified:
- `src/main/claude-accounts/claude-profile-router.ts` — private `chosen: ChosenAccountRouting` (lines 250–261; `setUpForLaunch` = `this.setups.runForLaunch(this.describe(id))`) and the three public methods `launchEnvFor(accountId)` :264, `preparationFor(accountId)` :269, `prepareLaunchFor(accountId)` :274, each one line delegating to the chosen-account module. 347 physical lines, 265 counted; no `max-lines` disable (the first cut added one; fix2 split the file instead).
- `src/main/claude-accounts/claude-profile-launch-errors.ts` — `claudeAccountUnknown()` :22–26 and `claudeAccountWslUnsupported()` :28–32, each an `AgentSessionPreSpawnError` with reason `claudeAccountUnknown` / `claudeAccountWslUnsupported`.
- `src/shared/claude-profile-routing.ts` — the two messages `CLAUDE_ACCOUNT_UNKNOWN_MESSAGE`, `CLAUDE_ACCOUNT_WSL_UNSUPPORTED_MESSAGE`.
- `src/main/claude-accounts/runtime-auth-service.ts` — `prepareForClaudeLaunchOnAccount(accountId)` → `router.prepareLaunchFor(accountId)` (added by the first cut; byte-identical from `6989d1ac1d` to `e6b9944979`).
- Reason-code wiring for the two new refusals (16 files): `src/main/native-chat/agent-session-wire/structured-agent-session-adapter.ts` (reason union), `…/structured-agent-session-failure-text.ts` (TYPED_START_REFUSALS), `src/shared/agent-session-failure.ts` (AGENT_SESSION_FAILURE_KINDS), `src/shared/agent-session-refusal-details.ts`, `src/shared/agent-session-refusal-reason-words.ts`, `src/shared/agent-session-failure-copy.ts`, `src/shared/agent-session-failure-words.ts`, `src/shared/structured-agent-session-dispatch-rejection.ts` (KIND_CATEGORY / KIND_VERDICT), `src/renderer/src/components/native-chat/agent-session-failure-words-text.ts` (PIECES), `src/renderer/src/i18n/en-runtime-required.json`, and `src/renderer/src/i18n/locales/{en,es,fr,ja,ko,zh}.json`.
- `src/shared/agent-session-attachment-sentences.ts` — created by fix3 to keep `agent-session-failure-words.ts` under the line cap; DELETED at the merge `b93676d809` in favour of upstream v1.4.232's `src/shared/agent-session-attachment-failure-words.ts` (`attachmentProblemSentence(say, context, problem)`).

**Design rules that hold**
- A chosen account's env is a **bare `CLAUDE_CONFIG_DIR`** = the account's own folder (`envForKnown`, line 57). Never `ORCA_CLAUDE_PROFILE_POINTER`, never `ORCA_CLAUDE_INJECTED_CONFIG_DIR`: the pane's `claude` shell function re-reads the selected-host pointer whenever `CLAUDE_CONFIG_DIR` equals the injected marker, which made the first cut launch on the SELECTED account. Stripping the selected account's three keys from a pinned spawn's base env stays Task 4's job (`applyRuntimeClaudeAuthEnv`).
- An account System default already covers gets the user's own `CLAUDE_CONFIG_DIR` value as set (unresolved), or `{}` when the user set none (lines 48–52); its preparation names `systemDefaultHome()` with provenance `system`.
- An uncovered account whose folder does not exist → `claudeProfileMissing()` (lines 54–56); provenance otherwise `profile:<accountId>`.
- Every public call starts with `assertKnownHostAccount` (lines 33–41): an id no saved account explains → `claudeAccountUnknown()`; a `managedAuthRuntime === 'wsl'` account → `claudeAccountWslUnsupported()`. Both throw before any setup, so no host folder is created.
- `prepareChosenAccountLaunch` order (lines 98–112): assert known + WSL refusal → `if (!routing.hasOwnLogin(id)) await routing.envReady()` → read coverage → `setUpForLaunch(id)` only when not covered → preparation.
- Coverage (`coveredBySystemDefault`) is read ONCE per public call (lines 70, 78, 108) and the same value builds the returned preparation (comment line 81), so a sign-in between two reads cannot set up one folder and name another.
- A hanging refresh of an already set-up folder is capped by the setup queue's `runForLaunch` wait; the launch proceeds on the folder's last refresh. Only a refused FIRST setup fails the launch (`claudeProfileSetupFailed()`).
- Public signatures as the rest of this plan uses them: `launchEnvFor(accountId): ClaudeEnvPatch`, `preparationFor(accountId): ClaudeRuntimeAuthPreparation`, `prepareLaunchFor(accountId): Promise<ClaudeRuntimeAuthPreparation>`; the selected-account `launchEnv()` / `preparation()` / `prepareLaunch()` are unchanged in behaviour.

**Deviations from the original plan, and why**
- **File split instead of a `max-lines` disable.** The first cut put the three methods in the router under an `eslint-disable max-lines`. The fork's AGENTS.md asks for a split over a disable, so fix2 moved the chosen-account logic, the setup queue and the System-default comparisons into their own modules. The plan's private router helper `setUpForLaunch` became a field of `ChosenAccountRouting`, wired to `ClaudeProfileSetupQueue.runForLaunch`; `prepareLaunch()` calls `this.setups.runForLaunch(profile)` directly.
- **Two new reason codes.** The adapter's reason union is exhaustive, and every refusal kind must appear in the failure-kind list, the failure text, the dispatch-rejection tables, the renderer word pieces and each locale. Throwing a plain `Error` would have shown the generic failure copy, so the unknown-account and WSL refusals got typed reasons end to end.
- **Upstream's attachment-words module supersedes ours.** Upstream v1.4.232 split the attachment sentences out of `agent-session-failure-words.ts` the same way. At the merge, upstream's module and its `(say, context, problem)` signature won and ours was dropped.

**Verification**
- Gates at `e6b9944979` and again at `b93676d809`: `typecheck:node` clean; oxlint and oxfmt clean; the line ratchet exits 0.
- Router launch-env tests: 10 passed. They cover the bare env shape, the missing folder, the unknown id, WSL in both `prepareLaunchFor` and `launchEnvFor`, System-default coverage both ways, a refused first setup, a TIMED hanging refresh (`performance.now`, must finish in under 1000 ms), and a real POSIX shell-function check (skipped on Windows; a comment above it notes PowerShell's launcher shares the same first branch).
- `src/main/claude-accounts/` folder: 277 passed. The merge commit reports 1,343 tests passing across the shared-failure, claude-accounts and rate-limits suites.
- Spec review: compliant over `66c0720680..e6b9944979`, with two non-blocking notes. The tests assert the error MESSAGE strings only, not `instanceof AgentSessionPreSpawnError` or the reason code. The pre-setup coverage value is reused for the returned preparation, which is intentional.
- Quality review of fix3 (range `66c0720680..e6b9944979` on the merged tree): **With fixes** — two Important (the covered-account env patch is additive, so a caller must apply it to an env without Orca's routing keys; refusal tests asserted only message strings) and three Minor. Fix4 `51bca6b991` (parent `b93676d809`; 4 files, +74/−4) closed all five: JSDoc contract on `chosenAccountLaunchEnv` naming `CLAUDE_CONFIG_DIR` / `ORCA_CLAUDE_PROFILE_POINTER` / `ORCA_CLAUDE_INJECTED_CONFIG_DIR` / `ORCA_CLAUDE_USER_CONFIG_DIR`, a bash-probe case for a covered account (own folder / unset, plus a third assertion that pins the hazard when layered over the selected `launchEnv()`), `toBeInstanceOf(AgentSessionPreSpawnError)` + `reason` on all six refusal call sites, the launch-errors comment, the Dock-launch caveat, explicit setup-queue args. Re-review on `51bca6b991`: **Yes, ready to merge** (claude-accounts 283 passed / 1 pre-existing skip; typecheck:node 0; oxlint/oxfmt clean; ratchet 0; `runtime-auth-service.ts` unchanged).

**Baseline for Task 4: `51bca6b991`** (= the v1.4.232 merge `b93676d809` + fix4).

**Steps as executed**
- [x] First cut `6989d1ac1d`: `launchEnvFor` / `preparationFor` / `prepareLaunchFor` on the router, `prepareForClaudeLaunchOnAccount` on `runtime-auth-service.ts`, tests. Quality review found the env carried the pointer + injected marker and so ran the selected account.
- [x] Fix `66c0720680`: bare `CLAUDE_CONFIG_DIR`, unknown-id refusal before setup, System-default branch tested, hanging-refresh cap proven, one coverage read, setup error logged.
- [x] Fix2 `bc6d91df73`: chosen-account launch moved to `claude-profile-chosen-account.ts`, setup queue and System-default comparison split out, `max-lines` disable removed, WSL accounts refused.
- [x] Fix3 `e6b9944979`: `claudeAccountUnknown` / `claudeAccountWslUnsupported` as typed `AgentSessionPreSpawnError`s wired through the reason tables and locales; one coverage read per launch.
- [x] Merge `b93676d809`: upstream v1.4.232 merged; attachment-sentence conflict resolved in upstream's favour; gates re-run.
- [x] Fix4 `51bca6b991` on top of the merge: the quality review's five items; re-review **Yes**. Task 3 COMPLETE.

### Task 4: `RuntimePtyController.spawn` learns `replacesPtyId` and `claudeAccountId`

**Re-target notes (v1.4.232).** Base = `blowzer/auto-switch` at `be87ad28a9` (upstream v1.4.232) merged into `blowzer/session-mover`; every line number below is `be87ad28a9`'s, so after the merge anchor on the quoted text (Task 1 added ten lines to `runtime/spawn-commit.ts` below the binding block, which is why its later anchors may sit lower). What changed since v1.4.230 and how this task adapted:
- `runtime/spawn.ts` lost its local `restoreProvisionalPtySize`; the reservation block is now lines 44–70. Same edit, new anchors.
- `runtime/spawn-commit.ts` now opens with `admitPtySpawnOwnership(ctx.deps.runtime, ctx.result)` (line 43, before any save) and discards a failed save with the 3-arg `discardUnpersistedPtySpawn(ctx.provider, ctx.result, ctx.deps.runtime)`. The binding swap stays INSIDE the existing binding write (lines 128–159), i.e. after admission. The decision and its reason are in the design note.
- `runtime/spawn-commit.ts` counts 273 of 300 lines, and about 283 once Task 1's record is merged. So the swap's branching lives in `spawn-replacement.ts` and the commit only calls it: three changed lines plus one import.
- `orca-runtime-get-status.ts` counts 299 of 300. The `getPtyController()` getter therefore goes next to the field it reads, in `src/main/runtime/construction/runtime-identity-state.ts` (field at line 385, 276 lines). The name and the public signature are unchanged for Task 7.
- New since the old text, and always needed: `runtime/spawn-execute.ts` resolves the pane's stable owner twice (lines 39 and 150). The renderer twin excludes the stopped owner there (`excludeReplacedPaneOwner`, `ipc/spawn-execute.ts`), so the runtime path does too.
- `ClaudeRuntimeAuthPreparation` now lives in `claude-accounts/runtime-auth/runtime-auth-types.ts`. `runtime-auth-service.ts` re-exports it, so the imports below stay valid.
- Unchanged and reused as is, nothing duplicated: `pane/pane-owner-replacement.ts` (`stopReplacedPaneOwner`, `swapReplacedPaneBinding`, `excludeReplacedPaneOwner`, `releaseStoppedPaneBinding`), `ipc/renderer-kill.ts` `stopReplacedPanePty`, `pane/spawn-reservation.ts` `reserveIdlePaneSpawn`. Upstream v1.4.232 has no runtime-path replacement: `replacesPtyId` exists only on the renderer IPC lane (`ipc/spawn-run.ts`).
- `runtime/spawn-preflight.ts`, `runtime/spawn-state.ts` and the `spawn?(opts)` block of `runtime-pty-controller-contract.ts` (lines 60–117) are unchanged since v1.4.230. The contract's only upstream change is `retireRejectedPty`'s third argument, which this task does not touch.

**Files:**
- Create: `src/main/ipc/pty/runtime/spawn-replacement.ts`, `src/main/ipc/pty/runtime/spawn-replacement.test.ts`, `src/main/ipc/pty/runtime/spawn-claude-auth.ts`, `src/main/ipc/pty/runtime/spawn-claude-auth.test.ts`
- Modify: `src/main/runtime/runtime-pty-controller-contract.ts` (after line 84), `src/main/ipc/pty/runtime/spawn-state.ts` (lines 11, 31, 119, 156), `src/main/ipc/pty/runtime/spawn.ts` (imports; lines 44–70; catch at line 106), `src/main/ipc/pty/runtime/spawn-execute.ts` (line 12; lines 35–45; lines 150–156), `src/main/ipc/pty/runtime/spawn-commit.ts` (imports; lines 145–153), `src/main/ipc/pty/runtime/spawn-preflight.ts` (lines 80–83, 106), `src/main/ipc/pty/runtime/spawn-preflight-requested-shell.test.ts` (append), `src/main/runtime/construction/runtime-identity-state.ts` (after line 385)

**Line budget** (oxlint `max-lines`: 300 for `.ts`, 800 for tests, blank and comment lines skipped; never a disable, never a baseline entry). Counted at `be87ad28a9`, then after this task:

| File | Now | After | Headroom left |
|---|---|---|---|
| `runtime/spawn.ts` | 111 | ~136 | ~164 |
| `runtime/spawn-commit.ts` | 273 (~283 with Task 1) | ~284 | ~16 |
| `runtime/spawn-execute.ts` | 204 | ~194 | ~106 |
| `runtime/spawn-preflight.ts` | 145 | 144 | 156 |
| `runtime/spawn-state.ts` | 199 | 204 | 96 |
| `construction/runtime-identity-state.ts` | 276 | 279 | 21 |
| `runtime/spawn-claude-auth.ts` (new) | 0 | ~38 (the pinned-launch routing-key guard is ~10 of them) | ~262 |
| `orca-runtime-get-status.ts` | 299 | 299 (not edited) | 1 |

**Design note.** The renderer IPC lane already replaces a pane's PTY in three moves (`ipc/spawn-run.ts` lines 33–49, `ipc/spawn-commit-persist.ts` lines 62–68). First it holds the pane's spawn reservation with `reserveIdlePaneSpawn`. Then it proves `replacesPtyId` still owns the pane and stops it (`stopReplacedPaneOwner` → `stopReplacedPanePty`, which labels the exit `replaced` so the renderer reads a handoff). Last, it writes the new binding through `swapReplacedPaneBinding`, and on any later failure it calls `releaseStoppedPaneBinding`. The runtime lane gets the same moves from the same module, plus the renderer lane's `excludeReplacedPaneOwner` at owner resolution. One env guard rides along: when a spawn names `claudeAccountId`, `applyRuntimeClaudeAuthEnv` deletes the selected account's routing keys (`ORCA_CLAUDE_PROFILE_POINTER`, `ORCA_CLAUDE_INJECTED_CONFIG_DIR`, `CLAUDE_CONFIG_DIR`) from the base env before it applies the chosen account's patch, because Task 3's patch is additive (`applyClaudeEnvPatch` only sets keys) and a System-default-covered account's patch is `{}` or the user's own `CLAUDE_CONFIG_DIR`; a spawn without `claudeAccountId` keeps upstream's env untouched.

**Where the swap goes: inside the commit's binding write, after `admitPtySpawnOwnership`, never before it and never in a hook.** Four reasons, from the code at `be87ad28a9`:
1. `admitPtySpawnOwnership` (`pane/spawn-registration.ts` lines 17–36) tracks the new PTY from its spawn reply before any save, and it applies the incarnation-scoped start fence through `exitedBeforeAdmission`. Only a tracked PTY can be cleaned up when its save loses. A swap refused because another owner took the pane then goes through `discardUnpersistedPtySpawn(provider, result, runtime)`. That call shuts the new process down with a `PtyExitProof`, or keeps it marked unverifiable when the shutdown reply is lost. A swap before admission would leave a refused spawn untracked, and that is the "never forgotten" invariant upstream added in #30754.
2. The swap must be decided inside the store's durable mutation, because `persistPtyBinding` takes a function. Only that way does it race correctly with the renderer's own pre-connect clear and with any other owner. The commit's `store.persistPtyBinding(...)` call is that mutation.
3. The renderer twin does exactly this. `ipc/spawn-commit.ts` line 33 admits first, then `persistPtyIpcSpawnCommit` swaps.
4. A replacing spawn always reaches this block. The excluded stopped owner leaves `ctx.stablePaneOwner` null, so `persistAdmittedStablePaneBinding` returns false. Task 6 passes `persistHostSessionBinding: true`, so `ctx.hostSessionBinding` is set.

The stop itself (`stopReplacedPanePty`) carries v1.4.232's exit proofs. A stop that fails for any reason other than "already gone" throws before anything changes. `beginRuntimePaneReplacement` then rejects its own reservation, and the old PTY keeps its pane.

**Preconditions the caller keeps.** The runtime lane spawns only on this machine, because an `ssh:` connection throws in preflight. The caller must not hold a `claimRuntimePaneCreate` claim for the same pane, because `reserveIdlePaneSpawn` waits for it. A replacement with `adoptedStablePane` or `agentSessionEnsure` is refused with `terminal_pane_owner_unknown`, because both name an owner to keep.

**Spec §3.4, "the old process is stopped only after the new spawn is accepted".** Everything that can refuse the move runs before the stop: the resume plan (Task 6), pane ownership, and the target account with its folder. The last one is new in this re-target. The old text resolved the account only in preflight, which runs after the stop, and Task 6 does not check it. So `spawn.ts` now calls `resolveRuntimeClaudeAuth` before `beginRuntimePaneReplacement` and stores the result in `ctx.claudeAuth`, and preflight reuses it instead of preparing the account a second time. A `claude_account_unknown`, `claude_account_wsl_unsupported` or `claude_profile_missing` refusal therefore leaves the old session running. A provider spawn that fails after the stop leaves the pane with its binding cleared. The renderer or CLI re-spawns it like any closed pane, and the conversation stays resumable by its id.

- [x] **Step 1: Write the replacement test**

`src/main/ipc/pty/runtime/spawn-replacement.test.ts`:
```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Store } from '../../../persistence'
import { TEST_LEAF_1 } from '../../../persistence-session-fixtures'
import { makePaneKey } from '../../../../shared/stable-pane-id'
import {
  makePaneSpawnReservationKey,
  paneSpawnReservationsByOwnerKey,
  rejectPaneSpawnReservation
} from '../pane/spawn-reservation'
import type { ReplacedPaneOwner } from '../pane/pane-owner-replacement'
import {
  beginRuntimePaneReplacement,
  isRuntimePaneBindRefusal,
  resolveRuntimeStablePaneOwner,
  runtimePaneBindingInput,
  runtimePaneBindRefusal
} from './spawn-replacement'

const worktreeId = 'repo-local::/fixture/local'
const tabId = 'restart-tab'
const paneKey = makePaneKey(tabId, TEST_LEAF_1)
const stopped: ReplacedPaneOwner = {
  ptyId: 'old',
  pane: { worktreeId, tabId, leafId: TEST_LEAF_1, hostId: undefined }
}

function storeBinding(ptyId: string): Store {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the owner resolvers and swapReplacedPaneBinding read only getWorkspaceSession.
  return {
    getWorkspaceSession: () => ({
      tabsByWorktree: { [worktreeId]: [{ id: tabId, worktreeId }] },
      terminalLayoutsByTabId: { [tabId]: { ptyIdsByLeafId: { [TEST_LEAF_1]: ptyId } } },
      terminalPtyIncarnationsByPaneKey: {}
    })
  } as unknown as Store
}

function deps(store: Store) {
  return {
    runtime: undefined,
    store,
    getLocalPtyProviderStartupPromise: () => undefined,
    shutdownProviderAndDetectExit: vi.fn(async () => true),
    rememberSyntheticKillExit: vi.fn(),
    sendPtyExitToRenderer: vi.fn()
  }
}

afterEach(() => {
  for (const [key, reservation] of paneSpawnReservationsByOwnerKey) {
    rejectPaneSpawnReservation(key, reservation, new Error('test teardown'))
  }
})

describe('beginRuntimePaneReplacement', () => {
  it('refuses when another PTY owns the pane and stops nothing', async () => {
    const stop = vi.fn(async () => {})
    await expect(
      beginRuntimePaneReplacement(
        deps(storeBinding('successor')),
        { replacesPtyId: 'old', paneKey, worktreeId, connectionId: null },
        stop
      )
    ).rejects.toThrow('terminal_pane_owner_changed')
    expect(stop).not.toHaveBeenCalled()
    expect(paneSpawnReservationsByOwnerKey.size).toBe(0)
  })

  it('holds the pane, stops the owner and reports what it replaced', async () => {
    const stop = vi.fn(async () => {})
    const replacement = await beginRuntimePaneReplacement(
      deps(storeBinding('old')),
      { replacesPtyId: 'old', paneKey, worktreeId, connectionId: null },
      stop
    )
    expect(stop).toHaveBeenCalledWith('old')
    expect(replacement.reservationKey).toBe(makePaneSpawnReservationKey(worktreeId, null, paneKey))
    expect(paneSpawnReservationsByOwnerKey.get(replacement.reservationKey)).toBe(
      replacement.reservation
    )
    expect(replacement.replaced).toEqual(stopped)
  })

  it('needs a pane to replace into', async () => {
    await expect(
      beginRuntimePaneReplacement(deps(storeBinding('old')), {
        replacesPtyId: 'old',
        paneKey: null,
        worktreeId,
        connectionId: null
      })
    ).rejects.toThrow('terminal_pane_owner_unknown')
  })
})

describe('resolveRuntimeStablePaneOwner', () => {
  it('never offers the stopped owner for reattach; any other spawn sees the bound owner', () => {
    const ctx = {
      deps: { runtime: undefined, store: storeBinding('old') },
      args: { worktreeId, connectionId: null },
      spawnIdentityPaneKey: paneKey
    }
    expect(resolveRuntimeStablePaneOwner({ ...ctx, replacedPaneOwner: stopped })).toBeNull()
    expect(resolveRuntimeStablePaneOwner({ ...ctx, replacedPaneOwner: null })).toMatchObject({
      ptyId: 'old',
      tabId,
      leafId: TEST_LEAF_1
    })
  })
})

describe('the runtime commit bind for a replacement', () => {
  const binding = { worktreeId, tabId, leafId: TEST_LEAF_1, ptyId: 'new', mayCreate: false }

  it('swaps only a leaf that still names the stopped id; a plain spawn binds as before', () => {
    expect(runtimePaneBindingInput(storeBinding('old'), binding, null)).toBe(binding)
    const swap = runtimePaneBindingInput(storeBinding('old'), binding, stopped)
    expect(typeof swap === 'function' ? swap() : swap).toBe(binding)
    const lost = runtimePaneBindingInput(storeBinding('successor'), binding, stopped)
    expect(typeof lost === 'function' ? lost() : lost).toBeNull()
  })

  it('names its refusal by kind and rethrows only that refusal', () => {
    expect(runtimePaneBindRefusal(stopped)).toBe('terminal_pane_owner_changed')
    expect(runtimePaneBindRefusal(null)).toBe('terminal_split_source_not_found')
    expect(isRuntimePaneBindRefusal(new Error('terminal_pane_owner_changed'), stopped)).toBe(true)
    expect(isRuntimePaneBindRefusal(new Error('terminal_pane_owner_changed'), null)).toBe(false)
    expect(isRuntimePaneBindRefusal(new Error('terminal_split_source_not_found'), null)).toBe(true)
    expect(isRuntimePaneBindRefusal('terminal_pane_owner_changed', stopped)).toBe(false)
  })
})
```

- [x] **Step 2: Run it and expect the module to be missing**

```bash
corepack pnpm exec vitest run --config config/vitest.config.ts src/main/ipc/pty/runtime/spawn-replacement.test.ts 2>&1 | tail -8
```
Expected: `Error: Failed to load url ./spawn-replacement … Does the file exist?`

- [x] **Step 3: Implement the replacement module**

`src/main/ipc/pty/runtime/spawn-replacement.ts`:
```ts
import type { Store } from '../../../persistence'
import type { PersistPtyBindingArgs } from '../../../persistence/loading-store/pty-binding-persistence'
import type { PtyRuntimeControllerDeps } from './controller-deps'
import type { RuntimePtySpawnArgs } from './spawn-state'
import { stopReplacedPanePty } from '../ipc/renderer-kill'
import {
  excludeReplacedPaneOwner,
  stopReplacedPaneOwner,
  swapReplacedPaneBinding,
  type ReplacedPaneOwner
} from '../pane/pane-owner-replacement'
import { resolveStablePaneOwner, type StablePaneOwner } from '../pane/stable-owner'
import {
  makePaneSpawnReservationKey,
  rejectPaneSpawnReservation,
  reserveIdlePaneSpawn,
  type PaneSpawnReservation
} from '../pane/spawn-reservation'

/** The kill deps `stopReplacedPanePty` needs are a subset of the runtime controller's. */
export type RuntimePaneReplacementDeps = Pick<
  PtyRuntimeControllerDeps,
  | 'runtime'
  | 'store'
  | 'getLocalPtyProviderStartupPromise'
  | 'shutdownProviderAndDetectExit'
  | 'rememberSyntheticKillExit'
  | 'sendPtyExitToRenderer'
>

export type RuntimePaneReplacement = {
  reservationKey: string
  reservation: PaneSpawnReservation
  replaced: ReplacedPaneOwner
}

/**
 * The runtime twin of `ipc/spawn-run.ts`'s replacement: hold the pane across the stop, prove
 * `replacesPtyId` still owns it, stop it. The caller settles the reservation; a refusal stops nothing.
 */
export async function beginRuntimePaneReplacement(
  deps: RuntimePaneReplacementDeps,
  args: {
    replacesPtyId: string
    paneKey: string | null
    worktreeId: string | undefined
    connectionId: string | null | undefined
  },
  stopReplacedPty: (id: string) => Promise<void> = (id) => stopReplacedPanePty(deps, id)
): Promise<RuntimePaneReplacement> {
  const reservationKey = makePaneSpawnReservationKey(args.worktreeId, args.connectionId, args.paneKey)
  if (!reservationKey) {
    throw new Error('terminal_pane_owner_unknown')
  }
  const reservation = await reserveIdlePaneSpawn(reservationKey)
  try {
    const replaced = await stopReplacedPaneOwner(
      { runtime: deps.runtime, store: deps.store, stopReplacedPty },
      args
    )
    return { reservationKey, reservation, replaced }
  } catch (error) {
    rejectPaneSpawnReservation(reservationKey, reservation, error)
    throw error
  }
}

/** Why exclude: the replacement's own stop leaves its binding for the commit to swap, not to reattach. */
export function resolveRuntimeStablePaneOwner(ctx: {
  deps: Pick<PtyRuntimeControllerDeps, 'runtime' | 'store'>
  args: Pick<RuntimePtySpawnArgs, 'worktreeId' | 'connectionId'>
  spawnIdentityPaneKey: string | null
  replacedPaneOwner: ReplacedPaneOwner | null
}): StablePaneOwner | null {
  return excludeReplacedPaneOwner(
    resolveStablePaneOwner(
      ctx.deps.runtime,
      ctx.deps.store,
      ctx.spawnIdentityPaneKey,
      ctx.args.worktreeId,
      ctx.args.connectionId
    ),
    ctx.replacedPaneOwner
  )
}

/** A replacement binds through the swap (decided inside the durable write); any other spawn as before. */
export function runtimePaneBindingInput(
  store: Store,
  binding: PersistPtyBindingArgs,
  replaced: ReplacedPaneOwner | null
): PersistPtyBindingArgs | (() => PersistPtyBindingArgs | null) {
  return replaced ? swapReplacedPaneBinding(store, binding, replaced) : binding
}

export function runtimePaneBindRefusal(
  replaced: ReplacedPaneOwner | null
): 'terminal_pane_owner_changed' | 'terminal_split_source_not_found' {
  return replaced ? 'terminal_pane_owner_changed' : 'terminal_split_source_not_found'
}

/** The refusal the commit rethrows as is; every other failure is a save failure. */
export function isRuntimePaneBindRefusal(
  error: unknown,
  replaced: ReplacedPaneOwner | null
): boolean {
  return error instanceof Error && error.message === runtimePaneBindRefusal(replaced)
}
```

- [x] **Step 4: Run it and expect green**

```bash
corepack pnpm exec vitest run --config config/vitest.config.ts src/main/ipc/pty/runtime/spawn-replacement.test.ts 2>&1 | tail -6
```
Expected: `Tests  6 passed (6)`.

- [x] **Step 5: Write the Claude-auth resolution test**

`src/main/ipc/pty/runtime/spawn-claude-auth.test.ts`:
```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ClaudeProfileRouter } from '../../../claude-accounts/claude-profile-router'
import { installClaudeProfileRouter } from '../../../claude-accounts/claude-profile-installed-router'
import type { ClaudeRuntimeAuthPreparation } from '../../../claude-accounts/runtime-auth-service'
import {
  CLAUDE_INJECTED_CONFIG_DIR_ENV,
  CLAUDE_PROFILE_POINTER_ENV,
  CLAUDE_USER_CONFIG_DIR_ENV
} from '../../../../shared/claude-profile-routing'
import { applyRuntimeClaudeAuthEnv, resolveRuntimeClaudeAuth } from './spawn-claude-auth'

const selected: ClaudeRuntimeAuthPreparation = {
  configDir: '/a',
  envPatch: { CLAUDE_CONFIG_DIR: '/a' },
  provenance: 'profile:a'
}
const target: ClaudeRuntimeAuthPreparation = {
  configDir: '/b',
  envPatch: { CLAUDE_CONFIG_DIR: '/b' },
  provenance: 'profile:b'
}

afterEach(() => {
  installClaudeProfileRouter(undefined)
})

describe('resolveRuntimeClaudeAuth', () => {
  it('uses the selected account unless the spawn names one', async () => {
    const prepareClaudeAuth = vi.fn(async () => selected)
    const prepareLaunchFor = vi.fn(async () => target)
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: only prepareLaunchFor is read here.
    installClaudeProfileRouter({ prepareLaunchFor } as unknown as ClaudeProfileRouter)
    const codexSelectionTarget = { runtime: 'host' as const }

    await expect(
      resolveRuntimeClaudeAuth({ args: {}, deps: { prepareClaudeAuth }, codexSelectionTarget })
    ).resolves.toBe(selected)
    expect(prepareClaudeAuth).toHaveBeenCalledWith(codexSelectionTarget)

    await expect(
      resolveRuntimeClaudeAuth({
        args: { claudeAccountId: 'b' },
        deps: { prepareClaudeAuth },
        codexSelectionTarget
      })
    ).resolves.toBe(target)
    expect(prepareLaunchFor).toHaveBeenCalledWith('b')
  })

  it('refuses a named account when no router is installed, and yields null without any resolver', async () => {
    await expect(
      resolveRuntimeClaudeAuth({
        args: { claudeAccountId: 'b' },
        deps: {},
        codexSelectionTarget: { runtime: 'host' }
      })
    ).rejects.toThrow('claude_account_router_unavailable')
    await expect(
      resolveRuntimeClaudeAuth({ args: {}, deps: {}, codexSelectionTarget: { runtime: 'host' } })
    ).resolves.toBeNull()
  })
})

describe('applyRuntimeClaudeAuthEnv', () => {
  // What `withClaudeProfileTerminalEnv` gives every host pane before the login shell's env arrives.
  const terminalEnv = {
    KEEP: '1',
    [CLAUDE_PROFILE_POINTER_ENV]: '/data/claude-profiles/selected-host',
    [CLAUDE_USER_CONFIG_DIR_ENV]: '/home/u/.claude-own'
  }
  // The same pane once the selected account's launch env has been merged in too.
  const selectedEnv = {
    ...terminalEnv,
    [CLAUDE_INJECTED_CONFIG_DIR_ENV]: '/a',
    CLAUDE_CONFIG_DIR: '/a'
  }

  it('returns the env untouched when there is no Claude auth', () => {
    expect(applyRuntimeClaudeAuthEnv(undefined, null, false)).toBeUndefined()
    expect(applyRuntimeClaudeAuthEnv(selectedEnv, null, true)).toBe(selectedEnv)
  })

  it("keeps the selected account's pointer and markers for an unpinned launch and spreads the patch", () => {
    expect(applyRuntimeClaudeAuthEnv(terminalEnv, selected, false)).toEqual({
      ...terminalEnv,
      CLAUDE_CONFIG_DIR: '/a'
    })
  })

  it('drops the pointer, the injected marker and the selected CLAUDE_CONFIG_DIR for a pinned launch, keeps the user dir, then applies the patch', () => {
    expect(applyRuntimeClaudeAuthEnv(selectedEnv, target, true)).toEqual({
      KEEP: '1',
      [CLAUDE_USER_CONFIG_DIR_ENV]: '/home/u/.claude-own',
      CLAUDE_CONFIG_DIR: '/b'
    })
    // The caller's env is never mutated (the renderer may reuse it).
    expect(selectedEnv.CLAUDE_CONFIG_DIR).toBe('/a')
    expect(selectedEnv).toHaveProperty(CLAUDE_PROFILE_POINTER_ENV)
  })

  it("resumes an account System default covers on the user's own folder, never the selected one", () => {
    // Task 3 hands a covered account an ADDITIVE patch: the user's own CLAUDE_CONFIG_DIR, or nothing.
    const covered = (envPatch: ClaudeRuntimeAuthPreparation['envPatch']) => ({
      configDir: '/home/u/.claude-own',
      envPatch,
      provenance: 'system' as const
    })
    expect(
      applyRuntimeClaudeAuthEnv(selectedEnv, covered({ CLAUDE_CONFIG_DIR: '/home/u/.claude-own' }), true)
    ).toEqual({
      KEEP: '1',
      [CLAUDE_USER_CONFIG_DIR_ENV]: '/home/u/.claude-own',
      CLAUDE_CONFIG_DIR: '/home/u/.claude-own'
    })
    const unset = applyRuntimeClaudeAuthEnv(selectedEnv, covered({}), true)
    expect(unset).toEqual({ KEEP: '1', [CLAUDE_USER_CONFIG_DIR_ENV]: '/home/u/.claude-own' })
    expect(unset).not.toHaveProperty('CLAUDE_CONFIG_DIR')
    expect(unset).not.toHaveProperty(CLAUDE_INJECTED_CONFIG_DIR_ENV)
    expect(unset).not.toHaveProperty(CLAUDE_PROFILE_POINTER_ENV)
  })
})
```

- [x] **Step 6: Run it and expect the module to be missing. Then implement it**

```bash
corepack pnpm exec vitest run --config config/vitest.config.ts src/main/ipc/pty/runtime/spawn-claude-auth.test.ts 2>&1 | tail -6
```
Expected: `Failed to load url ./spawn-claude-auth`.

`src/main/ipc/pty/runtime/spawn-claude-auth.ts`:
```ts
import {
  CLAUDE_INJECTED_CONFIG_DIR_ENV,
  CLAUDE_PROFILE_POINTER_ENV
} from '../../../../shared/claude-profile-routing'
import { getClaudeProfileRouter } from '../../../claude-accounts/claude-profile-installed-router'
import type { ClaudeRuntimeAuthPreparation } from '../../../claude-accounts/runtime-auth-service'
import type { RuntimePtySpawnState } from './spawn-state'

/**
 * Why: a session-mover resume names the account it moves to; every other launch runs on the selected
 * account, as before. The installed router is the one that routes the selected account's launches.
 */
export async function resolveRuntimeClaudeAuth(
  ctx: Pick<RuntimePtySpawnState, 'codexSelectionTarget'> & {
    args: Pick<RuntimePtySpawnState['args'], 'claudeAccountId'>
    deps: Pick<RuntimePtySpawnState['deps'], 'prepareClaudeAuth'>
  }
): Promise<ClaudeRuntimeAuthPreparation | null> {
  const accountId = ctx.args.claudeAccountId
  if (accountId !== undefined) {
    const router = getClaudeProfileRouter()
    if (!router) {
      throw new Error('claude_account_router_unavailable')
    }
    return router.prepareLaunchFor(accountId)
  }
  return ctx.deps.prepareClaudeAuth ? ctx.deps.prepareClaudeAuth(ctx.codexSelectionTarget) : null
}

/**
 * Why strip: preflight merged the SELECTED account's pointer into `args.env`
 * (`withClaudeProfileTerminalEnv`); a spread cannot remove it, and any pointer makes the pane's
 * `claude` shell function re-route to the selected account (`src/shared/claude-shell-function.ts`).
 * A pinned launch starts without it and carries only that account's `CLAUDE_CONFIG_DIR` (Task 3).
 * `ORCA_CLAUDE_USER_CONFIG_DIR` stays: it names the user's own dir. Never mutates the caller's env.
 */
export function applyRuntimeClaudeAuthEnv(
  env: Record<string, string> | undefined,
  auth: ClaudeRuntimeAuthPreparation | null,
  pinnedToAccount: boolean
): Record<string, string> | undefined {
  if (!auth) {
    return env
  }
  const base: Record<string, string> = { ...env }
  if (pinnedToAccount) {
    delete base[CLAUDE_PROFILE_POINTER_ENV]
    delete base[CLAUDE_INJECTED_CONFIG_DIR_ENV]
    delete base.CLAUDE_CONFIG_DIR
  }
  return { ...base, ...auth.envPatch }
}
```

Run the suite again. Expected: `Tests  6 passed (6)`. The sixth test is the covered-account guard: Task 3's patch is additive, so without the deletes a covered-account resume would keep the selected account's `CLAUDE_CONFIG_DIR` and injected marker and run the selected account.

- [x] **Step 7: Add the fields to the contract and the state**

`src/main/runtime/runtime-pty-controller-contract.ts`: inside `spawn?(opts: { … })`, directly after `    initiallyHidden?: boolean` (line 84) and before `    persistHostSessionBinding?: boolean`, add:
```ts
    /** Replace this live PTY in the same pane (stop it, swap the binding), as the renderer's restart does. */
    replacesPtyId?: string
    /** Run a Claude launch on this managed account instead of the selected one (the session mover's resume). */
    claudeAccountId?: string
```

`src/main/ipc/pty/runtime/spawn-state.ts`, four edits:
- after line 11 `import type { StablePaneOwner } from '../pane/stable-owner'` add
  ```ts
  import type { ReplacedPaneOwner } from '../pane/pane-owner-replacement'
  ```
- in `RuntimePtySpawnState`, after `  preAdoptedStablePane: AdoptStablePaneResult | null` (line 31) add
  ```ts
    /** The owner a replacing spawn stopped; the commit's bind swaps its binding. */
    replacedPaneOwner: ReplacedPaneOwner | null
  ```
- in `RuntimePtySpawnArgs`, after `  initiallyHidden?: boolean` (line 119) add
  ```ts
    replacesPtyId?: string
    claudeAccountId?: string
  ```
- in `createRuntimePtySpawnState`, after `    preAdoptedStablePane: null,` (line 156) add
  ```ts
      replacedPaneOwner: null,
  ```

Run `corepack pnpm run typecheck:node 2>&1 | tail -3`. Expected: no `error TS`, because no reader of the new field exists yet.

- [x] **Step 8: Route the runtime spawn through the replacement**

`src/main/ipc/pty/runtime/spawn.ts`. Add two imports below `import { resolveStablePaneOwner } from '../pane/stable-owner'` (line 10):
```ts
import { releaseStoppedPaneBinding } from '../pane/pane-owner-replacement'
import { resolveRuntimeClaudeAuth } from './spawn-claude-auth'
import { beginRuntimePaneReplacement } from './spawn-replacement'
```
Replace lines 44–70, from `  const ctx = createRuntimePtySpawnState(deps, args)` through the closing `  }` of `  if (!args.adoptedStablePane) { … }` (the line before `  try {`), with:
```ts
  const ctx = createRuntimePtySpawnState(deps, args)
  const leafId =
    typeof args.leafId === 'string' && isTerminalLeafId(args.leafId) ? args.leafId : null
  const paneKey =
    typeof args.worktreeId === 'string' &&
    typeof args.tabId === 'string' &&
    isValidTerminalTabId(args.tabId) &&
    args.tabId.length <= 512 &&
    leafId
      ? makePaneKey(args.tabId, leafId)
      : null
  if (args.replacesPtyId !== undefined) {
    // Why refuse: an adopted pane or an agent-session claim names the owner to keep, not to stop.
    if (args.adoptedStablePane || args.agentSessionEnsure) {
      throw new Error('terminal_pane_owner_unknown')
    }
    // Why before the stop: a target account that cannot launch refuses the move, not the session.
    if (args.claudeAccountId !== undefined) {
      ctx.claudeAuth = await resolveRuntimeClaudeAuth(ctx)
    }
    // Why before the try: a refused replacement settled its own reservation and stopped nothing.
    const replacement = await beginRuntimePaneReplacement(deps, {
      replacesPtyId: args.replacesPtyId,
      paneKey,
      worktreeId: args.worktreeId,
      connectionId: args.connectionId
    })
    ctx.paneSpawnReservationKey = replacement.reservationKey
    ctx.paneSpawnReservation = replacement.reservation
    ctx.replacedPaneOwner = replacement.replaced
  } else if (!args.adoptedStablePane) {
    const ownerKey = makePaneSpawnReservationKey(args.worktreeId, args.connectionId, paneKey)
    const existingOwner = paneKey
      ? resolveStablePaneOwner(
          deps.runtime,
          deps.store,
          paneKey,
          args.worktreeId,
          args.connectionId
        )
      : null
    if (ownerKey && !existingOwner && !paneSpawnReservationsByOwnerKey.has(ownerKey)) {
      ctx.paneSpawnReservationKey = ownerKey
      ctx.paneSpawnReservation = reservePaneSpawn(ownerKey)
    }
  }
```
In the `catch (err)` block, directly after the `if (ctx.pendingRegistrationPtyId) { … }` block (it ends at line 106) and before the `// Why: once the reservation is created, …` comment, add:
```ts
    // Why: a failed replacement must not leave the stopped id bound for the remount to reattach.
    if (ctx.replacedPaneOwner) {
      await releaseStoppedPaneBinding(deps.store, ctx.replacedPaneOwner)
    }
```
Why the held reservation is safe further down: `buildRuntimePtySpawnOptions` (`runtime/spawn-options.ts` lines 145–201) skips its join when `ctx.paneSpawnReservationKey` is already set. It throws `terminal_pane_identity_changed` only when the key differs from the key it derives from the same `tabId`/`leafId`. It keeps the held reservation through `ctx.paneSpawnReservation ??= …`. `releaseStoppedPaneBinding` retires only a binding that still names the stopped id, so a failure after the swap leaves the new binding alone.

- [x] **Step 9: Never reattach the stopped owner**

`src/main/ipc/pty/runtime/spawn-execute.ts`. Replace line 12
```ts
import { spawnForStablePane, resolveStablePaneOwner } from '../pane/stable-owner'
```
with
```ts
import { spawnForStablePane } from '../pane/stable-owner'
import { resolveRuntimeStablePaneOwner } from './spawn-replacement'
```
Replace lines 35–45
```ts
    const stablePaneOwnerCandidate = ctx.preAdoptedStablePane
      ? ctx.preAdoptedStablePane.owner
      : args.agentSessionEnsure
        ? null
        : resolveStablePaneOwner(
            ctx.deps.runtime,
            ctx.deps.store,
            ctx.spawnIdentityPaneKey,
            args.worktreeId,
            args.connectionId
          )
```
with
```ts
    const stablePaneOwnerCandidate = ctx.preAdoptedStablePane
      ? ctx.preAdoptedStablePane.owner
      : args.agentSessionEnsure
        ? null
        : resolveRuntimeStablePaneOwner(ctx)
```
and, in the `spawnForStablePane({ … })` call, replace lines 150–156
```ts
            resolveOwner: () =>
              resolveStablePaneOwner(
                ctx.deps.runtime,
                ctx.deps.store,
                ctx.spawnIdentityPaneKey,
                args.worktreeId,
                args.connectionId
              ),
```
with
```ts
            resolveOwner: () => resolveRuntimeStablePaneOwner(ctx),
```
This changes nothing for a spawn without `replacesPtyId`, because `ctx.replacedPaneOwner` is `null` and `excludeReplacedPaneOwner(owner, null)` returns `owner`.

- [x] **Step 10: Swap the binding in the commit**

`src/main/ipc/pty/runtime/spawn-commit.ts`. Add the import below the `admitPtySpawnOwnership, discardUnpersistedPtySpawn, registerPersistedPtySpawn` import from `'../pane/spawn-registration'` (lines 31–35):
```ts
import {
  isRuntimePaneBindRefusal,
  runtimePaneBindingInput,
  runtimePaneBindRefusal
} from './spawn-replacement'
```
In the `if (ctx.hostSessionBinding && !ctx.stablePaneBindingPersisted)` block, which runs after `admitPtySpawnOwnership` at line 43 (see the design note), replace lines 145–147
```ts
      const persisted = await store.persistPtyBinding(binding)
      if (persisted === false) {
        throw new Error('terminal_split_source_not_found')
      }
```
with
```ts
      // Why the swap: the leaf still names the stopped id (or the renderer cleared it); any other owner wins.
      const persisted = await store.persistPtyBinding(
        runtimePaneBindingInput(store, binding, ctx.replacedPaneOwner)
      )
      if (persisted === false) {
        throw new Error(runtimePaneBindRefusal(ctx.replacedPaneOwner))
      }
```
and in its `catch (err)`, keep `await discardUnpersistedPtySpawn(ctx.provider, ctx.result, ctx.deps.runtime)` as it is, and replace line 152
```ts
      if (err instanceof Error && err.message === 'terminal_split_source_not_found') {
```
with
```ts
      if (isRuntimePaneBindRefusal(err, ctx.replacedPaneOwner)) {
```
A plain spawn keeps its exact behavior. `runtimePaneBindingInput(…, null)` returns `binding`, and `runtimePaneBindRefusal(null)` is `terminal_split_source_not_found`. A replacement that loses the pane discards the new PTY with proof and throws `terminal_pane_owner_changed`, the reason Task 6 maps to `owner-changed`.

Run `corepack pnpm exec vitest run --config config/vitest.config.ts src/main/ipc/pty/runtime 2>&1 | tail -6`. Expected: all pass, with no change in any existing test's outcome.

- [x] **Step 11: Use the auth resolver in preflight, and prove the wiring end to end**

`src/main/ipc/pty/runtime/spawn-preflight.ts`. Replace lines 80–83
```ts
  ctx.claudeAuth =
    ctx.isClaudeLaunch && ctx.deps.prepareClaudeAuth
      ? await ctx.deps.prepareClaudeAuth(ctx.codexSelectionTarget)
      : null
```
with
```ts
  // Why `??`: a replacement resolved its pinned account before the stop (spawn.ts); reuse it.
  ctx.claudeAuth = ctx.isClaudeLaunch ? (ctx.claudeAuth ?? (await resolveRuntimeClaudeAuth(ctx))) : null
```
`ctx.claudeAuth` starts as `null` (`createRuntimePtySpawnState`), so every other spawn resolves here exactly as before. A pre-resolved auth on a non-Claude command is dropped.
Replace line 106
```ts
  ctx.env = ctx.claudeAuth ? { ...args.env, ...ctx.claudeAuth.envPatch } : args.env
```
with
```ts
  ctx.env = applyRuntimeClaudeAuthEnv(args.env, ctx.claudeAuth, args.claudeAccountId !== undefined)
```
and add `import { applyRuntimeClaudeAuthEnv, resolveRuntimeClaudeAuth } from './spawn-claude-auth'` below `import type { RuntimePtySpawnState } from './spawn-state'` (line 17).

Effects downstream, checked at `be87ad28a9`:
- `ctx.claudeAuth` now carries the target account. The shared `assemblePtySpawnLaunchOptions` (`spawn-options-assembly.ts` line 109 → `applyAgentWorkspaceTrustToSpawn`, line 193) therefore writes workspace trust into the target account's folder.
- Task 1's `recordClaudePaneAccountForSpawn` in the commit records the target account, because the provenance is `profile:<target>`.

**Ordering rule: the strip is NOT an `envToDelete` entry.** v1.4.232's `assemblePtySpawnEnvDeletions` (`spawn-options-assembly.ts` lines 31–70) runs `deleteRequestedEnvKeys(env, envToDelete)` on the env that already holds the patch, and then hands `envToDelete` to the provider. The provider (`providers/local-pty-spawn-environment.ts` line 45) deletes the same keys again after its own merge. A `CLAUDE_CONFIG_DIR` in `envToDelete` would therefore delete the pinned account's own dir twice over. The strip runs on `args.env` before the spread, as above. The later stages (`resolvePtySpawnHostEnv`, the pane stamp, the assembly) add keys but never touch the three Claude profile keys: `grep -rn "CLAUDE_" src/main/ipc/pty/host-env src/main/ipc/pty/spawn-host-env.ts src/main/ipc/pty/spawn-options-assembly.ts src/main/ipc/pty/spawn-pane-env.ts` shows only `CLAUDE_CODE_FORCE_TERMINAL_IMAGES` and the `CLAUDE_CODE_*` child-session stamps.

**End-to-end wiring test.** Append it to `src/main/ipc/pty/runtime/spawn-preflight-requested-shell.test.ts`, which already has `makeDeps()` (no `prepareClaudeAuth`), a real `ClaudeProfileRouter` and the WSL routing test this one mirrors. Change the `node:fs` import on line 2 to
```ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
```
and add these imports below the `installClaudeProfileRouter` import (line 14):
```ts
import type { ClaudeManagedAccount } from '../../../../shared/managed-account-types'
import {
  CLAUDE_INJECTED_CONFIG_DIR_ENV,
  CLAUDE_PROFILE_POINTER_ENV
} from '../../../../shared/claude-profile-routing'
import {
  claudeProfileMarkerPath,
  type ClaudeProfileDescriptor
} from '../../../claude-accounts/claude-profile-paths'
import type { ClaudeProfileSetupReport } from '../../../claude-accounts/claude-profile-setup'
import { resolveRuntimeClaudeAuth } from './spawn-claude-auth'
```
Append this test at the end of the file:
```ts
describe('runtime pty spawn preflight: a Claude launch pinned to a named account', () => {
  const roots: string[] = []
  afterEach(() => {
    installClaudeProfileRouter(undefined)
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("carries only that account's CLAUDE_CONFIG_DIR: no selected-account pointer, no injected marker", async () => {
    const root = mkdtempSync(join(tmpdir(), 'claude-spawn-pinned-'))
    roots.push(root)
    const dataRoot = join(root, 'data')
    const account = (id: string): ClaudeManagedAccount => ({
      id,
      email: `${id}@example.test`,
      authMethod: 'subscription-oauth',
      managedAuthPath: '/unused-legacy',
      createdAt: 0,
      updatedAt: 0,
      lastAuthenticatedAt: 0
    })
    // Stands in for the setup worker: the folder and its ownership marker, prepared at once.
    const runSetup = vi.fn(
      ({ profile }: { profile: ClaudeProfileDescriptor }): Promise<ClaudeProfileSetupReport> => {
        mkdirSync(profile.home, { recursive: true })
        writeFileSync(claudeProfileMarkerPath(profile), '{}')
        return Promise.resolve({ outcome: 'prepared', warnings: [], surfaces: {} })
      }
    )
    installClaudeProfileRouter(
      new ClaudeProfileRouter({
        getSettings: () => ({
          ...getDefaultSettings('/tmp'),
          claudeManagedAccounts: [account('a'), account('b')],
          activeClaudeManagedAccountId: 'a',
          // Hooks off: setup must not probe a real Claude here.
          agentStatusHooksEnabled: false
        }),
        dataRoot,
        userHome: join(root, 'personal'),
        env: {},
        runSetup,
        refreshWaitMs: 10
      })
    )
    const args: RuntimePtySpawnArgs = {
      cols: 120,
      rows: 40,
      cwd: root,
      command: 'claude',
      claudeAccountId: 'b',
      env: { KEEP: '1' }
    }
    const ctx = createRuntimePtySpawnState(makeDeps(), args)
    // As spawnPtyFromRuntimeController does before a replacement's stop.
    const preStop = await resolveRuntimeClaudeAuth(ctx)
    ctx.claudeAuth = preStop
    await expect(prepareRuntimePtySpawn(ctx)).resolves.toBeNull()
    // Preflight reused the pre-stop preparation instead of preparing account b again.
    expect(ctx.claudeAuth).toBe(preStop)
    expect(ctx.codexSelectionTarget).toMatchObject({ runtime: 'host' })
    // The pane env still got the selected account's pointer (every host pane does)…
    expect(args.env).toHaveProperty(CLAUDE_PROFILE_POINTER_ENV)
    // …and the pinned spawn env dropped it: account b's own folder, nothing that re-routes to a.
    expect(ctx.env).toMatchObject({
      KEEP: '1',
      CLAUDE_CONFIG_DIR: join(dataRoot, 'claude-profiles', 'b', 'home')
    })
    expect(ctx.env).not.toHaveProperty(CLAUDE_PROFILE_POINTER_ENV)
    expect(ctx.env).not.toHaveProperty(CLAUDE_INJECTED_CONFIG_DIR_ENV)
    expect(ctx.claudeAuth?.provenance).toBe('profile:b')
    expect(runSetup).toHaveBeenCalledWith(
      expect.objectContaining({ profile: expect.objectContaining({ accountId: 'b' }) })
    )
  })
})
```
Why `toMatchObject` for `ctx.env`: `resolvePtySpawnHostEnv` runs after the merge and may add Orca's own keys, and the assertion is about the three Claude profile keys, not the whole env. Why the stub creates folders: `withClaudeProfileTerminalEnv` (preflight line 79) may also set account **a** up in the background, and `prepareLaunchFor('b')` needs b's folder to exist. Task 3's chosen-account launch throws `claude_profile_missing` otherwise.

```bash
corepack pnpm exec vitest run --config config/vitest.config.ts src/main/ipc/pty/runtime/spawn-preflight-requested-shell.test.ts 2>&1 | tail -6
```
Expected: `Tests  8 passed (8)`.

- [x] **Step 12: Expose the controller to main-side callers**

`src/main/runtime/construction/runtime-identity-state.ts`, directly after `  protected ptyController: RuntimePtyController | null = null` (line 385), add:
```ts

  /** The installed controller, for main-side callers that spawn into a pane (the Claude session mover). */
  getPtyController(): RuntimePtyController | null {
    return this.ptyController
  }
```
Why here and not in `orca-runtime-get-status.ts` next to `setPtyController`: that file counts 299 of 300 lines at `be87ad28a9`. This class declares the field and has room (276). `OrcaRuntimeService` inherits the method, so Task 7's `state.runtime?.getPtyController()` and its `Pick<OrcaRuntimeService, 'getPtyController' | …>` resolve unchanged. `RuntimePtyController` is already imported in this file because the field's type uses it.

- [x] **Step 13: Line caps, typecheck, PTY suites, commit**

```bash
corepack pnpm exec oxlint src/main/ipc/pty/runtime/spawn.ts src/main/ipc/pty/runtime/spawn-commit.ts src/main/ipc/pty/runtime/spawn-execute.ts src/main/ipc/pty/runtime/spawn-preflight.ts src/main/ipc/pty/runtime/spawn-state.ts src/main/ipc/pty/runtime/spawn-replacement.ts src/main/ipc/pty/runtime/spawn-replacement.test.ts src/main/ipc/pty/runtime/spawn-claude-auth.ts src/main/ipc/pty/runtime/spawn-claude-auth.test.ts src/main/ipc/pty/runtime/spawn-preflight-requested-shell.test.ts src/main/runtime/construction/runtime-identity-state.ts src/main/runtime/runtime-pty-controller-contract.ts 2>&1 | tail -4
corepack pnpm run check:max-lines-ratchet 2>&1 | tail -2
corepack pnpm run typecheck:node 2>&1 | tail -3
corepack pnpm exec vitest run --config config/vitest.config.ts src/main/ipc/pty/runtime src/main/ipc/pty/pane src/main/ipc/pty/ipc src/main/runtime/orca-runtime-terminal-create-idempotency.test.ts 2>&1 | tail -6
```
Expected:
- oxlint prints `Found 0 warnings and 0 errors.`, with no `max-lines` hit. If `spawn-commit.ts` reports `max-lines` after the Task 1 merge, move the Task 1 record call's argument object into a function in `host-env/claude-pane-account.ts`, and never add a disable.
- `max-lines ratchet OK — 4 grandfathered entr(y/ies).`
- No `error TS`.
- All suites pass.

```bash
git add src/main/runtime/runtime-pty-controller-contract.ts src/main/runtime/construction/runtime-identity-state.ts src/main/ipc/pty/runtime/spawn-state.ts src/main/ipc/pty/runtime/spawn.ts src/main/ipc/pty/runtime/spawn-execute.ts src/main/ipc/pty/runtime/spawn-commit.ts src/main/ipc/pty/runtime/spawn-preflight.ts src/main/ipc/pty/runtime/spawn-replacement.ts src/main/ipc/pty/runtime/spawn-replacement.test.ts src/main/ipc/pty/runtime/spawn-claude-auth.ts src/main/ipc/pty/runtime/spawn-claude-auth.test.ts src/main/ipc/pty/runtime/spawn-preflight-requested-shell.test.ts
git commit -m "feat(pty): runtime spawn can replace a pane's PTY and launch Claude on a named account"
```
Expected: one commit, author `Nachumi Eliyahu <nachumi@a2zoperations.com>`, no trailers.

---

### Task 5: Mover policy + the `claudeSessionMover` setting vocabulary

**Files:**
- Modify: `src/main/claude-accounts/claude-account-auto-switch-policy.ts` (exports, end of file), `src/main/claude-accounts/claude-account-auto-switch.ts` (exports, end of file), `src/shared/claude-account-switch-settings.ts`, `src/shared/default-global-settings.ts` (line 186), `src/shared/managed-account-types.ts` (after line 129)
- Create: `src/main/claude-accounts/claude-session-mover-policy.ts`, `src/main/claude-accounts/claude-session-mover-policy.test.ts`

- [x] **Step 1: Shared vocabulary (type-only changes, no behaviour)**

`src/shared/claude-account-switch-settings.ts` becomes:
```ts
/** What a Claude account switch does to Claude sessions still on the old account. */
export type ClaudeAccountSwitchRunningSessions = 'ask' | 'restart' | 'keep'

/** What the host does with a running Claude session whose own account nears a usage limit. */
export type ClaudeSessionMoverSetting = 'off' | 'ask' | 'move'

export type ClaudeAccountSwitchSettings = {
  /** Absent means 'ask'. */
  claudeAccountSwitchRunningSessions?: ClaudeAccountSwitchRunningSessions
  /** Absent means 'ask'; a headless host treats 'ask' as 'move' because nobody can answer there. */
  claudeSessionMover?: ClaudeSessionMoverSetting
}
```
`src/shared/default-global-settings.ts` — after line 186 `claudeAutoSwitchEnabled: false,` add `claudeSessionMover: 'ask',`.

`src/shared/managed-account-types.ts` — after `ClaudeRateLimitAccountsState` (line 129) add:
```ts
/** The session mover's last decision for a live Claude session (`orca account list --json`). */
export type ClaudeSessionMoveSummary = {
  ptyId: string
  paneKey: string | null
  fromAccountId: string
  toAccountId: string | null
  window: 'session' | 'weekly' | 'fableWeekly' | null
  percent: number | null
  line: number | null
  reason: string
  at: number
}
```
and inside `ClaudeRateLimitAccountsState` after `autoSwitchEnabled?: boolean` add:
```ts
  /** What this host does with running sessions near a usage limit; absent from older hosts. */
  sessionMover?: ClaudeSessionMoverSetting
  /** The mover's last decision per live session, newest first. */
  sessionMoves?: ClaudeSessionMoveSummary[]
```
with `import type { ClaudeSessionMoverSetting } from './claude-account-switch-settings'` at the top.

- [x] **Step 2: Export the shared policy pieces the mover reuses**

Append to `src/main/claude-accounts/claude-account-auto-switch-policy.ts`:
```ts
export type ClaudeAutoSwitchWindowName = WindowName
export type ClaudeAutoSwitchWindow = LiveWindow
// Why exported: the session mover decides per session with the same windows, lines and limit test.
export { liveWindows as claudeAutoSwitchWindows, isAtLimit as isClaudeAtLimit }
```
Append to `src/main/claude-accounts/claude-account-auto-switch.ts`:
```ts
// Why exported: the session mover attributes the selected account's reading and ranks candidates the same way.
export { isReadingOf as isClaudeUsageReadingOf, sharesRuntime as claudeAccountsShareRuntime }
```
Re-run the two existing suites: `corepack pnpm exec vitest run --config config/vitest.config.ts src/main/claude-accounts/claude-account-auto-switch.test.ts src/main/claude-accounts/claude-account-auto-switch-policy.test.ts 2>&1 | tail -4` → `Tests  39 passed (39)`.

- [x] **Step 3: Write the policy test**

`src/main/claude-accounts/claude-session-mover-policy.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import type { InactiveAccountUsage, ProviderRateLimits } from '../../shared/rate-limit-types'
import {
  CLAUDE_SESSION_MOVE_COOLDOWN_MS,
  CLAUDE_SESSION_MOVE_FAILURE_HOLD_MS,
  CLAUDE_SESSION_MOVE_TARGET_COOLDOWN_MS,
  debitClaimedUsage,
  decideClaudeSessionMove,
  type ClaudeSessionMoveInputs
} from './claude-session-mover-policy'

const NOW = Date.parse('2026-10-19T12:00:00Z')

function limits(usedPercent: number, updatedAt = NOW): ProviderRateLimits {
  return {
    provider: 'claude',
    session: { usedPercent, windowMinutes: 300, resetsAt: null, resetDescription: null },
    weekly: null,
    updatedAt,
    error: null,
    status: 'ok'
  }
}

function candidate(accountId: string, usedPercent: number, updatedAt = NOW): InactiveAccountUsage {
  return { accountId, rateLimits: limits(usedPercent, updatedAt), updatedAt, isFetching: false }
}

function inputs(overrides: Partial<ClaudeSessionMoveInputs> = {}): ClaudeSessionMoveInputs {
  return {
    now: NOW,
    setting: 'move',
    pinned: false,
    paneState: 'done',
    usage: limits(96),
    candidates: [candidate('b', 50), candidate('c', 20)],
    candidateCount: 2,
    lastUsageReadAt: 0,
    lastMoveAt: 0,
    lastFailureAt: 0,
    targetClaims: new Map(),
    ...overrides
  }
}

describe('decideClaudeSessionMove', () => {
  it('moves an idle session over the line to the account with the most room', () => {
    expect(decideClaudeSessionMove(inputs())).toEqual({
      kind: 'move',
      to: 'c',
      window: { name: 'session', percent: 96, line: 95 }
    })
  })

  it('waits for the turn to end, and for a first status', () => {
    expect(decideClaudeSessionMove(inputs({ paneState: 'working' }))).toEqual({ kind: 'wait', reason: 'mid-turn' })
    expect(decideClaudeSessionMove(inputs({ paneState: 'blocked' }))).toEqual({ kind: 'wait', reason: 'mid-turn' })
    expect(decideClaudeSessionMove(inputs({ paneState: null }))).toEqual({ kind: 'wait', reason: 'no-status' })
  })

  it('leaves a pinned session alone until its account is at the limit', () => {
    expect(decideClaudeSessionMove(inputs({ pinned: true, usage: limits(96) }))).toEqual({ kind: 'stay', reason: 'under-line' })
    expect(decideClaudeSessionMove(inputs({ pinned: true, usage: limits(100) })).kind).toBe('move')
  })

  it('stays under the line and when the setting is off', () => {
    expect(decideClaudeSessionMove(inputs({ usage: limits(80) }))).toEqual({ kind: 'stay', reason: 'under-line' })
    expect(decideClaudeSessionMove(inputs({ setting: 'off' }))).toEqual({ kind: 'stay', reason: 'off' })
  })

  it('asks for a reading when the session\'s usage is stale, then stays until one arrives', () => {
    const stale = limits(96, NOW - 16 * 60_000)
    expect(decideClaudeSessionMove(inputs({ usage: stale }))).toEqual({ kind: 'read-usage' })
    expect(decideClaudeSessionMove(inputs({ usage: stale, lastUsageReadAt: NOW - 1_000 }))).toEqual({ kind: 'stay', reason: 'no-usage' })
    expect(decideClaudeSessionMove(inputs({ usage: null }))).toEqual({ kind: 'read-usage' })
  })

  it('waits for every candidate\'s reading before picking, unless one is unreadable', () => {
    expect(decideClaudeSessionMove(inputs({ candidates: [candidate('b', 50)] }))).toEqual({ kind: 'read-usage' })
    const unreadable: InactiveAccountUsage = {
      ...candidate('c', 20, NOW - 60 * 60_000),
      rateLimits: { ...limits(20, NOW - 60 * 60_000), usageMetadata: { retryAtMs: NOW + 60_000 } }
    }
    expect(decideClaudeSessionMove(inputs({ candidates: [candidate('b', 50), unreadable] }))).toMatchObject({ kind: 'move', to: 'b' })
  })

  it('honours the per-session cooldown and the failure hold, except at the limit', () => {
    expect(decideClaudeSessionMove(inputs({ lastMoveAt: NOW - CLAUDE_SESSION_MOVE_COOLDOWN_MS + 1 }))).toEqual({ kind: 'stay', reason: 'cooldown' })
    expect(decideClaudeSessionMove(inputs({ lastMoveAt: NOW - CLAUDE_SESSION_MOVE_COOLDOWN_MS + 1, usage: limits(100) })).kind).toBe('move')
    expect(decideClaudeSessionMove(inputs({ lastFailureAt: NOW - CLAUDE_SESSION_MOVE_FAILURE_HOLD_MS + 1 }))).toEqual({ kind: 'stay', reason: 'failed-recently' })
    expect(decideClaudeSessionMove(inputs({ lastFailureAt: NOW - CLAUDE_SESSION_MOVE_FAILURE_HOLD_MS })).kind).toBe('move')
  })

  it('skips a target another session just claimed, then ranks it with the claim debited', () => {
    const claims = new Map([['c', { at: NOW - 1_000, debit: 5 }]])
    expect(decideClaudeSessionMove(inputs({ targetClaims: claims }))).toMatchObject({ kind: 'move', to: 'b' })
    const older = new Map([['c', { at: NOW - CLAUDE_SESSION_MOVE_TARGET_COOLDOWN_MS, debit: 40 }]])
    // c reads 20 + 40 = 60 after the debit, so b (50) has more room.
    expect(decideClaudeSessionMove(inputs({ targetClaims: older }))).toMatchObject({ kind: 'move', to: 'b' })
    expect(debitClaimedUsage(candidate('c', 20), { at: NOW - 1_000, debit: 5 }, NOW).rateLimits?.session?.usedPercent).toBe(25)
    expect(debitClaimedUsage(candidate('c', 98), { at: NOW - 1_000, debit: 5 }, NOW).rateLimits?.session?.usedPercent).toBe(100)
  })

  it('stays when no account has enough room', () => {
    expect(decideClaudeSessionMove(inputs({ candidates: [candidate('b', 90), candidate('c', 88)] }))).toEqual({ kind: 'stay', reason: 'no-target' })
  })
})
```

- [x] **Step 4: Run it — expect the module to be missing**

```bash
corepack pnpm exec vitest run --config config/vitest.config.ts src/main/claude-accounts/claude-session-mover-policy.test.ts 2>&1 | tail -6
```
Expected: `Failed to load url ./claude-session-mover-policy`.

- [x] **Step 5: Implement the policy**

`src/main/claude-accounts/claude-session-mover-policy.ts`:
```ts
import type { ClaudeSessionMoverSetting } from '../../shared/claude-account-switch-settings'
import type { AgentStatusState } from '../../shared/agent-status-types'
import type { InactiveAccountUsage, ProviderRateLimits, RateLimitWindow } from '../../shared/rate-limit-types'
import { DEFAULT_POLL_MS } from '../rate-limits/service/service-types'
import {
  claudeAutoSwitchHeadroom,
  claudeAutoSwitchWindows,
  isClaudeAtLimit,
  pickClaudeAutoSwitchTarget,
  type ClaudeAutoSwitchWindowName
} from './claude-account-auto-switch-policy'

/** Per session: a moved session is not moved again for this long (unless its account hits the limit). */
export const CLAUDE_SESSION_MOVE_COOLDOWN_MS = 5 * 60_000
/** Per target: a claimed account is not offered to another session for this long. */
export const CLAUDE_SESSION_MOVE_TARGET_COOLDOWN_MS = 60_000
/** Per session: after a failed or skipped move, no retry for this long. */
export const CLAUDE_SESSION_MOVE_FAILURE_HOLD_MS = 60_000
/** One turn's worth of a 5-hour window, debited from a target's reading after each move that claimed it. */
export const CLAUDE_SESSION_MOVE_CLAIM_DEBIT_PERCENT = 5

export type ClaudeTargetClaim = { at: number; debit: number }
export type ClaudeSessionMoveWindow = { name: ClaudeAutoSwitchWindowName; percent: number; line: number }

export type ClaudeSessionMoveDecision =
  | { kind: 'stay'; reason: 'off' | 'no-usage' | 'under-line' | 'cooldown' | 'failed-recently' | 'no-target' }
  | { kind: 'read-usage' }
  | { kind: 'wait'; reason: 'mid-turn' | 'no-status' }
  | { kind: 'move'; to: string; window: ClaudeSessionMoveWindow }

export type ClaudeSessionMoveInputs = {
  now: number
  setting: ClaudeSessionMoverSetting
  pinned: boolean
  paneState: AgentStatusState | null
  /** The session's own account's reading. */
  usage: ProviderRateLimits | null
  /** Readings of the other signed-in accounts of the same runtime. */
  candidates: InactiveAccountUsage[]
  /** How many such accounts exist, read or not. */
  candidateCount: number
  lastUsageReadAt: number
  lastMoveAt: number
  lastFailureAt: number
  targetClaims: ReadonlyMap<string, ClaudeTargetClaim>
}

function isFresh(usage: { updatedAt: number } | null, now: number): boolean {
  return usage !== null && now - usage.updatedAt <= DEFAULT_POLL_MS
}

/** The window nearest (or furthest over) its line; null when usage could not be read. */
export function worstClaudeWindow(limits: ProviderRateLimits | null, now: number): ClaudeSessionMoveWindow | null {
  const windows = claudeAutoSwitchWindows(limits, now)
  if (!windows) {
    return null
  }
  const worst = windows.reduce((a, b) => (b.line - b.used < a.line - a.used ? b : a))
  return { name: worst.name, percent: worst.used, line: worst.line }
}

/** A claimed target reads as if the claiming session had already spent a turn on it. */
export function debitClaimedUsage(
  usage: InactiveAccountUsage,
  claim: ClaudeTargetClaim | undefined,
  now: number
): InactiveAccountUsage {
  if (!claim || now - claim.at >= CLAUDE_SESSION_MOVE_COOLDOWN_MS || !usage.rateLimits) {
    return usage
  }
  const debit = (window: RateLimitWindow | null | undefined): RateLimitWindow | null =>
    window ? { ...window, usedPercent: Math.min(100, window.usedPercent + claim.debit) } : null
  const { rateLimits } = usage
  return {
    ...usage,
    rateLimits: {
      ...rateLimits,
      session: debit(rateLimits.session),
      weekly: debit(rateLimits.weekly),
      ...(rateLimits.fableWeekly !== undefined ? { fableWeekly: debit(rateLimits.fableWeekly) } : {})
    }
  }
}

export function decideClaudeSessionMove(inputs: ClaudeSessionMoveInputs): ClaudeSessionMoveDecision {
  const { now, usage } = inputs
  if (inputs.setting === 'off') {
    return { kind: 'stay', reason: 'off' }
  }
  // Why a stale reading never moves: the window may have reset since; ask once per poll interval.
  if (!usage || usage.status !== 'ok' || !isFresh(usage, now)) {
    return now - inputs.lastUsageReadAt >= DEFAULT_POLL_MS ? { kind: 'read-usage' } : { kind: 'stay', reason: 'no-usage' }
  }
  const atLimit = isClaudeAtLimit(usage, now)
  const headroom = claudeAutoSwitchHeadroom(usage, now)
  const over = inputs.pinned ? atLimit : headroom !== null && headroom <= 0
  if (!over) {
    return { kind: 'stay', reason: 'under-line' }
  }
  if (now - inputs.lastFailureAt < CLAUDE_SESSION_MOVE_FAILURE_HOLD_MS) {
    return { kind: 'stay', reason: 'failed-recently' }
  }
  if (!atLimit && now - inputs.lastMoveAt < CLAUDE_SESSION_MOVE_COOLDOWN_MS) {
    return { kind: 'stay', reason: 'cooldown' }
  }
  // Why never mid-turn: a restart during a tool call or a permission prompt loses the turn.
  if (inputs.paneState === null) {
    return { kind: 'wait', reason: 'no-status' }
  }
  if (inputs.paneState !== 'done') {
    return { kind: 'wait', reason: 'mid-turn' }
  }
  const open = inputs.candidates.filter((candidate) => {
    const claim = inputs.targetClaims.get(candidate.accountId)
    return !claim || now - claim.at >= CLAUDE_SESSION_MOVE_TARGET_COOLDOWN_MS
  })
  const fresh = open
    .filter((candidate) => isFresh(candidate, now))
    .map((candidate) => debitClaimedUsage(candidate, inputs.targetClaims.get(candidate.accountId), now))
  // Why: an account inside its Retry-After cannot be read, so ranking does not wait for it.
  const unreadable = open.filter(
    (candidate) => !isFresh(candidate, now) && (candidate.rateLimits?.usageMetadata?.retryAtMs ?? 0) > now
  )
  const claimedOut = inputs.candidates.length - open.length
  if (fresh.length + unreadable.length + claimedOut < inputs.candidateCount) {
    if (inputs.candidates.some((candidate) => candidate.isFetching)) {
      return { kind: 'stay', reason: 'no-usage' }
    }
    if (now - inputs.lastUsageReadAt >= DEFAULT_POLL_MS) {
      return { kind: 'read-usage' }
    }
  }
  const to = pickClaudeAutoSwitchTarget(usage, fresh, { now, lastSwitchAt: inputs.lastMoveAt })
  if (!to) {
    return { kind: 'stay', reason: 'no-target' }
  }
  const window = worstClaudeWindow(usage, now)
  return window ? { kind: 'move', to, window } : { kind: 'stay', reason: 'no-usage' }
}
```

- [x] **Step 6: Run — expect green; typecheck; commit**

```bash
corepack pnpm exec vitest run --config config/vitest.config.ts src/main/claude-accounts/claude-session-mover-policy.test.ts src/main/claude-accounts/claude-account-auto-switch-policy.test.ts src/main/claude-accounts/claude-account-auto-switch.test.ts 2>&1 | tail -6
corepack pnpm run typecheck:node 2>&1 | tail -3
git add src/shared/claude-account-switch-settings.ts src/shared/default-global-settings.ts src/shared/managed-account-types.ts src/main/claude-accounts/claude-account-auto-switch-policy.ts src/main/claude-accounts/claude-account-auto-switch.ts src/main/claude-accounts/claude-session-mover-policy.ts src/main/claude-accounts/claude-session-mover-policy.test.ts
git commit -m "feat(claude-accounts): per-session move policy over the shared usage lines"
```
Expected: `Test Files  3 passed (3)`, `Tests  48 passed (48)`; no `error TS`.

---

### Task 6: `MoveStrategy.resume` — the move itself

**Files:**
- Create: `src/main/claude-accounts/claude-session-move-strategy.ts`, `src/main/claude-accounts/claude-session-move-strategy.test.ts`

Design note: the strategy builds the resume the way `resolveMobileSessionResumeCommand` does (`buildAgentResumeStartupPlan` + the pane's provider session) and spawns it through the runtime controller with Task 4's two fields. Like the renderer's restart of a hand-started Claude, it resumes with no extra arguments (`agentArgs: null`, `agentEnv: null`): a permission bypass configured as a default must not appear on a session that never had it. The target account's folder is applied by main's preflight from `claudeAccountId` (Task 4), so the strategy never touches `CLAUDE_CONFIG_DIR` itself.

- [x] **Step 1: Write the strategy test**

`src/main/claude-accounts/claude-session-move-strategy.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest'
import { getDefaultSettings } from '../../shared/constants'
import { makePaneKey } from '../../shared/stable-pane-id'
import type { RuntimePtyController } from '../runtime/runtime-pty-controller-contract'
import { TEST_LEAF_1 } from '../persistence-session-fixtures'
import { createResumeMoveStrategy, type ClaudeSessionMoveRequest } from './claude-session-move-strategy'

type Controller = Pick<RuntimePtyController, 'spawn' | 'getCwd' | 'getSize'>

function request(): ClaudeSessionMoveRequest {
  return {
    ptyId: 'pty-old',
    paneKey: makePaneKey('tab-1', TEST_LEAF_1),
    worktreeId: 'repo-local::/fixture/local',
    connectionId: null,
    toAccountId: 'c',
    providerSession: { key: 'session_id', id: 'sess-abc', transcriptPath: '/profiles/b/home/projects/x/sess-abc.jsonl' }
  }
}

function controller(spawn: Controller['spawn']): Controller {
  return { spawn, getCwd: async () => '/fixture/local/sub', getSize: () => ({ cols: 100, rows: 30 }) }
}

describe('createResumeMoveStrategy', () => {
  it('resumes the conversation in the same pane on the target account', async () => {
    const spawn = vi.fn(async () => ({ id: 'pty-new' }))
    const strategy = createResumeMoveStrategy({
      getController: () => controller(spawn),
      getSettings: () => getDefaultSettings('/tmp'),
      platform: 'darwin'
    })
    await expect(strategy.move(request())).resolves.toEqual({ kind: 'moved', newPtyId: 'pty-new' })
    expect(spawn).toHaveBeenCalledTimes(1)
    const opts = spawn.mock.calls[0]![0]
    expect(opts).toMatchObject({
      cols: 100,
      rows: 30,
      cwd: '/fixture/local/sub',
      launchAgent: 'claude',
      commandDelivery: 'provider',
      resumeProviderSession: { key: 'session_id', id: 'sess-abc' },
      worktreeId: 'repo-local::/fixture/local',
      tabId: 'tab-1',
      leafId: TEST_LEAF_1,
      replacesPtyId: 'pty-old',
      claudeAccountId: 'c',
      initiallyHidden: true,
      persistHostSessionBinding: true,
      isNewSession: true
    })
    // Posix quoting wraps every argv token in single quotes (see agent-resume-argv-drop.spec.ts:166).
    expect(opts.command).toMatch(/'--resume' 'sess-abc'$/)
    expect(opts.env?.CLAUDE_CONFIG_DIR).toBeUndefined()
  })

  it('reports an owner change as a failure without touching anything else', async () => {
    const spawn = vi.fn(async () => {
      throw new Error('terminal_pane_owner_changed')
    })
    const strategy = createResumeMoveStrategy({ getController: () => controller(spawn), getSettings: () => getDefaultSettings('/tmp'), platform: 'darwin' })
    await expect(strategy.move(request())).resolves.toEqual({
      kind: 'failed',
      reason: 'owner-changed',
      error: 'terminal_pane_owner_changed'
    })
  })

  it('reports any other spawn error, a missing controller and a pane it cannot name', async () => {
    const spawn = vi.fn(async () => {
      throw new Error('spawn exploded')
    })
    const strategy = createResumeMoveStrategy({ getController: () => controller(spawn), getSettings: () => getDefaultSettings('/tmp'), platform: 'darwin' })
    await expect(strategy.move(request())).resolves.toEqual({ kind: 'failed', reason: 'spawn-failed', error: 'spawn exploded' })
    const none = createResumeMoveStrategy({ getController: () => null, getSettings: () => getDefaultSettings('/tmp'), platform: 'darwin' })
    await expect(none.move(request())).resolves.toEqual({ kind: 'skipped', reason: 'no-controller' })
    await expect(strategy.move({ ...request(), paneKey: 'not-a-pane-key' })).resolves.toEqual({ kind: 'skipped', reason: 'no-pane' })
  })
})
```

- [x] **Step 2: Run — expect the missing module**

```bash
corepack pnpm exec vitest run --config config/vitest.config.ts src/main/claude-accounts/claude-session-move-strategy.test.ts 2>&1 | tail -6
```
Expected: `Failed to load url ./claude-session-move-strategy`.

- [x] **Step 3: Implement the strategy**

`src/main/claude-accounts/claude-session-move-strategy.ts`:
```ts
import type { AgentProviderSessionMetadata } from '../../shared/agent-session-resume'
import type { AgentStartupSettings } from '../../shared/agent-startup-plan-inputs'
import { parsePaneKey } from '../../shared/stable-pane-id'
import { buildAgentResumeStartupPlan } from '../../shared/tui-agent-resume-startup'
import { resolveStartupShell } from '../../shared/tui-agent-startup-shell'
import type { RuntimePtyController } from '../runtime/runtime-pty-controller-contract'

export type ClaudeSessionMoveRequest = {
  ptyId: string
  paneKey: string
  worktreeId: string
  connectionId: string | null
  toAccountId: string
  providerSession: AgentProviderSessionMetadata
}

export type ClaudeSessionMoveOutcome =
  | { kind: 'moved'; newPtyId: string }
  | { kind: 'skipped'; reason: 'no-controller' | 'no-resume-plan' | 'no-pane' }
  | { kind: 'failed'; reason: 'owner-changed' | 'spawn-failed'; error: string }

/** How a session gets onto another account. `resume` restarts it in place; a token swap is a later strategy. */
export type ClaudeSessionMoveStrategy = {
  move(request: ClaudeSessionMoveRequest): Promise<ClaudeSessionMoveOutcome>
}

export type ResumeMoveStrategyDeps = {
  getController: () => Pick<RuntimePtyController, 'spawn' | 'getCwd' | 'getSize'> | null
  getSettings: () => AgentStartupSettings
  platform: NodeJS.Platform
}

const FALLBACK_SIZE = { cols: 120, rows: 40 }

/**
 * `claude --resume <id>` in the same pane, spawned on the target account: the resume is built as the
 * phone's cold restore builds it; `replacesPtyId` stops the old PTY and swaps the pane binding;
 * `claudeAccountId` makes main's preflight inject the target account's folder.
 */
export function createResumeMoveStrategy(deps: ResumeMoveStrategyDeps): ClaudeSessionMoveStrategy {
  return {
    async move(request) {
      const controller = deps.getController()
      if (!controller?.spawn) {
        return { kind: 'skipped', reason: 'no-controller' }
      }
      const pane = parsePaneKey(request.paneKey)
      if (!pane) {
        return { kind: 'skipped', reason: 'no-pane' }
      }
      const settings = deps.getSettings()
      // Why no defaults: a hand-started Claude must not come back with configured args such as a permission bypass.
      const plan = buildAgentResumeStartupPlan({
        agent: 'claude',
        providerSession: request.providerSession,
        cmdOverrides: settings.agentCmdOverrides ?? {},
        agentArgs: null,
        agentEnv: null,
        platform: deps.platform,
        shell: resolveStartupShell(deps.platform)
      })
      if (!plan) {
        return { kind: 'skipped', reason: 'no-resume-plan' }
      }
      const size = controller.getSize?.(request.ptyId) ?? FALLBACK_SIZE
      const cwd = (await controller.getCwd?.(request.ptyId)) ?? undefined
      try {
        const result = await controller.spawn({
          ...size,
          ...(cwd ? { cwd } : {}),
          command: plan.launchCommand,
          launchAgent: 'claude',
          commandDelivery: 'provider',
          ...(plan.startupCommandDelivery ? { startupCommandDelivery: plan.startupCommandDelivery } : {}),
          ...(plan.env ? { env: plan.env } : {}),
          resumeProviderSession: request.providerSession,
          connectionId: request.connectionId,
          worktreeId: request.worktreeId,
          tabId: pane.tabId,
          leafId: pane.leafId,
          replacesPtyId: request.ptyId,
          claudeAccountId: request.toAccountId,
          isNewSession: true,
          // Why hidden + persisted: no renderer view exists for the new PTY yet (none at all on a server);
          // the pane binding is what a window or the CLI follows to it.
          initiallyHidden: true,
          persistHostSessionBinding: true
        })
        return { kind: 'moved', newPtyId: result.id }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return {
          kind: 'failed',
          reason: message === 'terminal_pane_owner_changed' ? 'owner-changed' : 'spawn-failed',
          error: message
        }
      }
    }
  }
}
```

- [x] **Step 4: Run — expect green; commit**

```bash
corepack pnpm exec vitest run --config config/vitest.config.ts src/main/claude-accounts/claude-session-move-strategy.test.ts 2>&1 | tail -6
corepack pnpm run typecheck:node 2>&1 | tail -3
git add src/main/claude-accounts/claude-session-move-strategy.ts src/main/claude-accounts/claude-session-move-strategy.test.ts
git commit -m "feat(claude-accounts): resume move strategy spawns the session on the target account in place"
```
Expected: `Tests  3 passed (3)`; no `error TS`.

---

### Task 7: `ClaudeSessionMover` service + wiring + notices

**Files:**
- Create: `src/main/claude-accounts/claude-session-mover-sessions.ts`, `src/main/claude-accounts/claude-session-mover.ts`, `src/main/claude-accounts/claude-session-mover.test.ts`
- Modify: `src/main/provider-account-services.ts`, `src/main/startup/main-process-account-services.ts` (lines 60–85), `src/main/orcad/orcad-account-services.ts` (lines 45–50, 73–80, 120–131), `src/main/claude-accounts/claude-account-selection.ts` (list() + a provider), `src/main/claude-accounts/service.ts`

- [x] **Step 1: The session/usage joiner (no test of its own; exercised by the mover test)**

`src/main/claude-accounts/claude-session-mover-sessions.ts`:
```ts
import type { AgentProviderSessionMetadata } from '../../shared/agent-session-resume'
import type { AgentStatusState } from '../../shared/agent-status-types'
import type { ClaudeManagedAccountSummary } from '../../shared/managed-account-types'
import type { InactiveAccountUsage, RateLimitState } from '../../shared/rate-limit-types'
import type {
  AgentHookProviderSessionIdentity,
  AgentHookStatusChangeEntry
} from '../agent-hooks/server/server-types'
import { claudeAccountsShareRuntime, isClaudeUsageReadingOf } from './claude-account-auto-switch'
import {
  inferClaudeAccountIdFromTranscript,
  type ClaudeAccountHomes,
  type ClaudePaneAccountRecord
} from './claude-pane-account-registry'

export type ClaudeMoverSessionView = {
  record: ClaudePaneAccountRecord
  paneKey: string | null
  paneState: AgentStatusState | null
  providerSession: AgentProviderSessionMetadata | null
  worktreeId: string | null
}

/**
 * Every live Claude session the mover may act on: the registry's records, plus sessions Orca did not
 * route (a shell's own CLAUDE_CONFIG_DIR) learned from their transcript path and recorded as pinned.
 */
export function collectClaudeMoverSessions(args: {
  records: ClaudePaneAccountRecord[]
  statuses: AgentHookStatusChangeEntry[]
  providerSessions: AgentHookProviderSessionIdentity[]
  resolvePaneKey: (ptyId: string) => string | null
  resolvePtyIdForPaneKey: (paneKey: string) => string | null
  resolveWorktreeId: (ptyId: string) => string | null
  accounts: readonly ClaudeAccountHomes[]
  recordInferred: (record: ClaudePaneAccountRecord) => void
  now: number
}): ClaudeMoverSessionView[] {
  const statusByPane = new Map(args.statuses.map((entry) => [entry.paneKey, entry.state]))
  const identityByPane = new Map(args.providerSessions.map((identity) => [identity.paneKey, identity]))
  const known = new Map(args.records.map((record) => [record.ptyId, record]))
  for (const identity of args.providerSessions) {
    const ptyId = args.resolvePtyIdForPaneKey(identity.paneKey)
    if (!ptyId || known.has(ptyId)) {
      continue
    }
    const inferred = inferClaudeAccountIdFromTranscript(identity.transcriptPath, args.accounts)
    if (!inferred) {
      continue
    }
    const record: ClaudePaneAccountRecord = {
      ptyId,
      paneKey: identity.paneKey,
      accountId: inferred.accountId,
      configDir: inferred.configDir,
      launchedAt: args.now,
      // Why pinned: Orca never chose this folder, so the session is moved only at the limit.
      pinned: true,
      source: 'transcript'
    }
    args.recordInferred(record)
    known.set(ptyId, record)
  }
  return [...known.values()].map((record) => {
    const paneKey = record.paneKey ?? args.resolvePaneKey(record.ptyId)
    const identity = paneKey ? identityByPane.get(paneKey) : undefined
    return {
      record,
      paneKey,
      paneState: paneKey ? (statusByPane.get(paneKey) ?? null) : null,
      providerSession: identity
        ? {
            key: 'session_id',
            id: identity.sessionId,
            ...(identity.transcriptPath ? { transcriptPath: identity.transcriptPath } : {})
          }
        : null,
      worktreeId: identity?.worktreeId ?? args.resolveWorktreeId(record.ptyId)
    }
  })
}

/** An account's reading: the selected account's bar (if it is that account's), else its inactive entry. */
export function claudeUsageForAccount(
  state: RateLimitState,
  account: ClaudeManagedAccountSummary,
  selectedId: string | null
): InactiveAccountUsage | null {
  if (account.id === selectedId) {
    return state.claude && isClaudeUsageReadingOf(state.claude, account)
      ? { accountId: account.id, rateLimits: state.claude, updatedAt: state.claude.updatedAt, isFetching: false }
      : null
  }
  return state.inactiveClaudeAccounts.find((usage) => usage.accountId === account.id) ?? null
}

/** Where a session on `from` may move: the other signed-in accounts of the same runtime. */
export function claudeMoveCandidates(
  accounts: ClaudeManagedAccountSummary[],
  from: ClaudeManagedAccountSummary
): ClaudeManagedAccountSummary[] {
  return accounts.filter(
    (account) => account.id !== from.id && !account.needsSignIn && claudeAccountsShareRuntime(account, from)
  )
}
```

- [x] **Step 2: Write the mover test**

`src/main/claude-accounts/claude-session-mover.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClaudeManagedAccountSummary } from '../../shared/managed-account-types'
import type { ProviderRateLimits, RateLimitState } from '../../shared/rate-limit-types'
import { createEmptyRateLimitState } from '../../shared/rate-limit-state-factory'
import { makePaneKey } from '../../shared/stable-pane-id'
import type { AgentHookProviderSessionIdentity, AgentHookStatusChangeEntry } from '../agent-hooks/server/server-types'
import { TEST_LEAF_1, TEST_LEAF_2 } from '../persistence-session-fixtures'
import type { ClaudePaneAccountRecord } from './claude-pane-account-registry'
import type { ClaudeSessionMoveOutcome, ClaudeSessionMoveRequest } from './claude-session-move-strategy'
import { createClaudeSessionMover, type ClaudeSessionMoveNotice } from './claude-session-mover'
import { CLAUDE_SESSION_MOVE_FAILURE_HOLD_MS, CLAUDE_SESSION_MOVE_TARGET_COOLDOWN_MS } from './claude-session-mover-policy'

const HOST = { runtime: 'host' as const, wslDistro: null }
const PANE_1 = makePaneKey('tab-1', TEST_LEAF_1)
const PANE_2 = makePaneKey('tab-1', TEST_LEAF_2)

function account(id: string, overrides: Partial<ClaudeManagedAccountSummary> = {}): ClaudeManagedAccountSummary {
  return { id, email: `${id}@example.com`, managedAuthRuntime: 'host', wslDistro: null, authMethod: 'subscription-oauth', createdAt: 0, updatedAt: 0, lastAuthenticatedAt: 0, ...overrides }
}

function limits(usedPercent: number, updatedAt = Date.now()): ProviderRateLimits {
  return { provider: 'claude', session: { usedPercent, windowMinutes: 300, resetsAt: null, resetDescription: null }, weekly: null, updatedAt, error: null, status: 'ok' }
}

/** Selected account `a` on the bar; the others as inactive entries. */
function state(active: number, inactive: Record<string, ProviderRateLimits>): RateLimitState {
  return createEmptyRateLimitState({
    claude: { ...limits(active), usageMetadata: { authProvenance: 'profile:a' } },
    claudeTarget: HOST,
    inactiveClaudeAccounts: Object.entries(inactive).map(([accountId, rateLimits]) => ({ accountId, rateLimits, updatedAt: rateLimits.updatedAt, isFetching: false }))
  })
}

function record(ptyId: string, paneKey: string, accountId: string, pinned = false): ClaudePaneAccountRecord {
  return { ptyId, paneKey, accountId, configDir: `/profiles/${accountId}/home`, launchedAt: 0, pinned, source: pinned ? 'transcript' : 'spawn' }
}

function setup(options: { setting?: 'off' | 'ask' | 'move'; headless?: boolean; accounts?: ClaudeManagedAccountSummary[] } = {}) {
  const settings = {
    claudeSessionMover: options.setting ?? ('move' as const),
    activeClaudeManagedAccountId: 'a',
    activeClaudeManagedAccountIdsByRuntime: undefined,
    claudeManagedAccounts: [] as never[]
  }
  const accounts = options.accounts ?? [account('a'), account('b'), account('c')]
  let current = state(30, { b: limits(96), c: limits(20) })
  const records: ClaudePaneAccountRecord[] = []
  let statuses: AgentHookStatusChangeEntry[] = []
  let providerSessions: AgentHookProviderSessionIdentity[] = []
  const stateListeners = new Set<(next: RateLimitState) => void>()
  const statusListeners = new Set<() => void>()
  const fetchInactive = vi.fn(async () => {})
  const move = vi.fn<(request: ClaudeSessionMoveRequest) => Promise<ClaudeSessionMoveOutcome>>(async () => ({ kind: 'moved', newPtyId: 'pty-new' }))
  const notices: ClaudeSessionMoveNotice[] = []
  const mover = createClaudeSessionMover({
    getSettings: () => settings,
    rateLimits: {
      onStateChange: (listener) => { stateListeners.add(listener); return () => stateListeners.delete(listener) },
      getState: () => current,
      fetchInactiveClaudeAccountsOnOpen: fetchInactive
    },
    accounts: { listAccounts: () => ({ accounts, activeAccountId: 'a' }) },
    hooks: {
      subscribeStatusChanges: (listener) => { statusListeners.add(() => listener(statuses)); return () => {} },
      getStatusChangeSnapshot: () => statuses,
      getProviderSessionIdentities: () => providerSessions
    },
    registry: { list: () => [...records], record: (entry) => { records.push(entry) } },
    resolvePaneKey: (ptyId) => records.find((entry) => entry.ptyId === ptyId)?.paneKey ?? null,
    resolvePtyIdForPaneKey: (paneKey) => (paneKey === PANE_2 ? 'pty-2' : null),
    resolveWorktreeId: () => 'repo-local::/fixture',
    accountHomes: (accountId) => [`/profiles/${accountId}/home`],
    strategy: { move },
    headless: options.headless ?? false,
    onNotice: (notice) => notices.push(notice),
    log: () => {}
  })
  const publish = (next: RateLimitState) => { current = next; for (const listener of stateListeners) listener(next) }
  const session = (ptyId: string, paneKey: string, accountId: string, paneState: AgentHookStatusChangeEntry['state'] = 'done', pinned = false) => {
    records.push(record(ptyId, paneKey, accountId, pinned))
    statuses = [...statuses, { paneKey, state: paneState, receivedAt: Date.now(), observedInCurrentRuntime: true }]
    providerSessions = [...providerSessions, { paneKey, sessionId: `sess-${ptyId}`, transcriptPath: `/profiles/${accountId}/home/projects/x/sess-${ptyId}.jsonl`, worktreeId: 'repo-local::/fixture' }]
  }
  const setStatus = (paneKey: string, paneState: AgentHookStatusChangeEntry['state']) => {
    statuses = statuses.map((entry) => (entry.paneKey === paneKey ? { ...entry, state: paneState } : entry))
    for (const listener of statusListeners) listener()
  }
  return { mover, settings, publish, session, setStatus, move, fetchInactive, notices, records, setProviderSessions: (next: AgentHookProviderSessionIdentity[]) => { providerSessions = next } }
}

describe('createClaudeSessionMover', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-19T12:00:00Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('moves an idle session whose own (non-selected) account is over the line to the account with the most room', async () => {
    const { mover, session, publish, move, notices } = setup()
    session('pty-1', PANE_1, 'b')
    mover.start()
    publish(state(30, { b: limits(96), c: limits(20) }))
    await vi.runAllTimersAsync()
    expect(move).toHaveBeenCalledTimes(1)
    expect(move.mock.calls[0]![0]).toMatchObject({ ptyId: 'pty-1', paneKey: PANE_1, toAccountId: 'c', providerSession: { key: 'session_id', id: 'sess-pty-1' } })
    expect(notices.map((notice) => notice.kind)).toEqual(['moved'])
    expect(mover.lastDecisions()).toEqual([expect.objectContaining({ ptyId: 'pty-1', fromAccountId: 'b', toAccountId: 'c', window: 'session', percent: 96, line: 95, reason: 'moved' })])
  })

  it('waits mid-turn and moves once the pane reports done', async () => {
    const { mover, session, publish, setStatus, move } = setup()
    session('pty-1', PANE_1, 'b', 'working')
    mover.start()
    publish(state(30, { b: limits(96), c: limits(20) }))
    await vi.runAllTimersAsync()
    expect(move).not.toHaveBeenCalled()
    expect(mover.lastDecisions()[0]?.reason).toBe('wait:mid-turn')
    setStatus(PANE_1, 'done')
    await vi.runAllTimersAsync()
    expect(move).toHaveBeenCalledTimes(1)
  })

  it('moves a pinned session only at the limit', async () => {
    const { mover, session, publish, move } = setup()
    session('pty-1', PANE_1, 'b', 'done', true)
    mover.start()
    publish(state(30, { b: limits(93), c: limits(20) }))
    await vi.runAllTimersAsync()
    expect(move).not.toHaveBeenCalled()
    publish(state(30, { b: limits(100), c: limits(20) }))
    await vi.runAllTimersAsync()
    expect(move).toHaveBeenCalledTimes(1)
  })

  it('lets one target take one session at a time', async () => {
    const { mover, session, publish, move } = setup()
    session('pty-1', PANE_1, 'b')
    session('pty-2', PANE_2, 'b')
    mover.start()
    publish(state(90, { b: limits(96), c: limits(20) }))
    await vi.runAllTimersAsync()
    // a has 5 points of room, under the ten-point minimum gain; c is claimed by the first session.
    expect(move).toHaveBeenCalledTimes(1)
    expect(mover.lastDecisions().find((decision) => decision.ptyId === 'pty-2')?.reason).toBe('stay:no-target')
    vi.setSystemTime(Date.now() + CLAUDE_SESSION_MOVE_TARGET_COOLDOWN_MS)
    publish(state(90, { b: limits(96), c: limits(20) }))
    await vi.runAllTimersAsync()
    expect(move).toHaveBeenCalledTimes(2)
    expect(move.mock.calls[1]![0].ptyId).toBe('pty-2')
  })

  it('asks for a reading when the session\'s account is stale, and stays until it arrives', async () => {
    const { mover, session, publish, move, fetchInactive } = setup()
    session('pty-1', PANE_1, 'b')
    mover.start()
    publish(state(30, { b: limits(96, Date.now() - 16 * 60_000), c: limits(20) }))
    await vi.runAllTimersAsync()
    expect(fetchInactive).toHaveBeenCalledTimes(1)
    expect(move).not.toHaveBeenCalled()
    publish(state(30, { b: limits(96, Date.now() - 16 * 60_000), c: limits(20) }))
    await vi.runAllTimersAsync()
    expect(fetchInactive).toHaveBeenCalledTimes(1)
  })

  it('does nothing when off; asks on a desktop; acts on a headless host', async () => {
    const off = setup({ setting: 'off' })
    off.session('pty-1', PANE_1, 'b')
    off.mover.start()
    off.publish(state(30, { b: limits(96), c: limits(20) }))
    await vi.runAllTimersAsync()
    expect(off.move).not.toHaveBeenCalled()
    expect(off.notices).toEqual([])

    const ask = setup({ setting: 'ask' })
    ask.session('pty-1', PANE_1, 'b')
    ask.mover.start()
    ask.publish(state(30, { b: limits(96), c: limits(20) }))
    ask.publish(state(30, { b: limits(97), c: limits(20) }))
    await vi.runAllTimersAsync()
    expect(ask.move).not.toHaveBeenCalled()
    expect(ask.notices.map((notice) => notice.kind)).toEqual(['ask'])

    const headless = setup({ setting: 'ask', headless: true })
    headless.session('pty-1', PANE_1, 'b')
    headless.mover.start()
    headless.publish(state(30, { b: limits(96), c: limits(20) }))
    await vi.runAllTimersAsync()
    expect(headless.move).toHaveBeenCalledTimes(1)
  })

  it('marks a failed move and retries only after the hold', async () => {
    const { mover, session, publish, move, notices } = setup()
    move.mockResolvedValueOnce({ kind: 'failed', reason: 'owner-changed', error: 'terminal_pane_owner_changed' })
    session('pty-1', PANE_1, 'b')
    mover.start()
    publish(state(30, { b: limits(96), c: limits(20) }))
    await vi.runAllTimersAsync()
    expect(notices.map((notice) => notice.kind)).toEqual(['failed'])
    publish(state(30, { b: limits(97), c: limits(20) }))
    await vi.runAllTimersAsync()
    expect(move).toHaveBeenCalledTimes(1)
    vi.setSystemTime(Date.now() + CLAUDE_SESSION_MOVE_FAILURE_HOLD_MS)
    publish(state(30, { b: limits(97), c: limits(20) }))
    await vi.runAllTimersAsync()
    expect(move).toHaveBeenCalledTimes(2)
  })

  it('skips a session with no conversation to resume, with a reason', async () => {
    const { mover, session, publish, move, notices, setProviderSessions } = setup()
    session('pty-1', PANE_1, 'b')
    setProviderSessions([])
    mover.start()
    publish(state(30, { b: limits(96), c: limits(20) }))
    await vi.runAllTimersAsync()
    expect(move).not.toHaveBeenCalled()
    expect(notices).toEqual([expect.objectContaining({ kind: 'skipped', ptyId: 'pty-1', detail: 'no-provider-session' })])
  })

  it('learns a session Orca did not route from its transcript and treats it as pinned', async () => {
    const { mover, publish, move, records, setProviderSessions } = setup()
    setProviderSessions([{ paneKey: PANE_2, sessionId: 'sess-x', transcriptPath: '/profiles/b/home/projects/x/sess-x.jsonl' }])
    mover.start()
    publish(state(30, { b: limits(96), c: limits(20) }))
    await vi.runAllTimersAsync()
    expect(records).toEqual([expect.objectContaining({ ptyId: 'pty-2', accountId: 'b', pinned: true, source: 'transcript' })])
    expect(move).not.toHaveBeenCalled()
  })
})
```

- [x] **Step 3: Run — expect the missing module**

```bash
corepack pnpm exec vitest run --config config/vitest.config.ts src/main/claude-accounts/claude-session-mover.test.ts 2>&1 | tail -6
```
Expected: `Failed to load url ./claude-session-mover`.

- [x] **Step 4: Implement the mover**

`src/main/claude-accounts/claude-session-mover.ts`:
```ts
import type { GlobalSettings } from '../../shared/global-settings-types'
import type { ClaudeManagedAccountSummary, ClaudeSessionMoveSummary } from '../../shared/managed-account-types'
import type { InactiveAccountUsage, ProviderRateLimits } from '../../shared/rate-limit-types'
import type { AgentHookServer } from '../agent-hooks/server'
import type { RateLimitService } from '../rate-limits/service'
import type { ClaudePaneAccountRecord } from './claude-pane-account-registry'
import type { ClaudeSessionMoveStrategy } from './claude-session-move-strategy'
import {
  CLAUDE_SESSION_MOVE_CLAIM_DEBIT_PERCENT,
  CLAUDE_SESSION_MOVE_COOLDOWN_MS,
  decideClaudeSessionMove,
  worstClaudeWindow,
  type ClaudeTargetClaim
} from './claude-session-mover-policy'
import {
  claudeMoveCandidates,
  claudeUsageForAccount,
  collectClaudeMoverSessions,
  type ClaudeMoverSessionView
} from './claude-session-mover-sessions'
import { getSelectedClaudeAccountIdForTarget } from './runtime-selection'
import type { ClaudeAccountService } from './service'

export type ClaudeSessionMoveNotice = {
  kind: 'moved' | 'ask' | 'skipped' | 'failed'
  ptyId: string
  from: ClaudeManagedAccountSummary
  to: ClaudeManagedAccountSummary | null
  detail: string
}

export type ClaudeSessionMoverDeps = {
  getSettings: () => Pick<
    GlobalSettings,
    'claudeSessionMover' | 'activeClaudeManagedAccountId' | 'activeClaudeManagedAccountIdsByRuntime' | 'claudeManagedAccounts'
  >
  rateLimits: Pick<RateLimitService, 'onStateChange' | 'getState' | 'fetchInactiveClaudeAccountsOnOpen'>
  accounts: Pick<ClaudeAccountService, 'listAccounts'>
  hooks: Pick<AgentHookServer, 'subscribeStatusChanges' | 'getStatusChangeSnapshot' | 'getProviderSessionIdentities'>
  registry: { list: () => ClaudePaneAccountRecord[]; record: (record: ClaudePaneAccountRecord) => void }
  resolvePaneKey: (ptyId: string) => string | null
  resolvePtyIdForPaneKey: (paneKey: string) => string | null
  resolveWorktreeId: (ptyId: string) => string | null
  accountHomes: (accountId: string) => string[]
  strategy: ClaudeSessionMoveStrategy
  /** No window can answer "ask" here, so it acts as "move" (said once in the log). */
  headless: boolean
  onNotice: (notice: ClaudeSessionMoveNotice) => void
  log?: (line: string, record: ClaudeSessionMoveSummary) => void
}

export type ClaudeSessionMover = {
  start: () => () => void
  evaluate: () => void
  /** The last decision per live session, newest first. */
  lastDecisions: () => ClaudeSessionMoveSummary[]
}

/** Moves running Claude sessions to the account with the most room before their own account's limit. */
export function createClaudeSessionMover(deps: ClaudeSessionMoverDeps): ClaudeSessionMover {
  const lastMoveAt = new Map<string, number>()
  const lastFailureAt = new Map<string, number>()
  const lastAskAt = new Map<string, number>()
  const lastDecision = new Map<string, ClaudeSessionMoveSummary>()
  const targetClaims = new Map<string, ClaudeTargetClaim>()
  const inflight = new Set<string>()
  let lastUsageReadAt = 0
  let headlessAskLogged = false
  let evaluating = false
  let queued = false
  const log = deps.log ?? ((line, record) => console.info(`[claude-session-mover] ${line}`, record))

  const remember = (
    view: ClaudeMoverSessionView,
    from: ClaudeManagedAccountSummary,
    to: ClaudeManagedAccountSummary | null,
    reason: string,
    usage: ProviderRateLimits | null,
    now: number
  ): void => {
    const window = worstClaudeWindow(usage, now)
    const record: ClaudeSessionMoveSummary = {
      ptyId: view.record.ptyId,
      paneKey: view.paneKey,
      fromAccountId: from.id,
      toAccountId: to?.id ?? null,
      window: window?.name ?? null,
      percent: window?.percent ?? null,
      line: window?.line ?? null,
      reason,
      at: now
    }
    // Why once per reason: the service publishes every 15 s; a repeated "stay" is not news.
    if (lastDecision.get(view.record.ptyId)?.reason !== reason) {
      log(`${reason} pty=${record.ptyId} from=${from.email} to=${to?.email ?? '-'}`, record)
    }
    lastDecision.set(view.record.ptyId, record)
  }

  const settle = (view: ClaudeMoverSessionView, from: ClaudeManagedAccountSummary, to: ClaudeManagedAccountSummary, usage: ProviderRateLimits | null) =>
    (kind: ClaudeSessionMoveNotice['kind'], detail: string): void => {
      const now = Date.now()
      if (kind === 'moved') {
        lastMoveAt.set(view.record.ptyId, now)
      } else {
        lastFailureAt.set(view.record.ptyId, now)
      }
      remember(view, from, kind === 'moved' ? to : null, kind === 'moved' ? 'moved' : `${kind}:${detail}`, usage, now)
      deps.onNotice({ kind, ptyId: view.record.ptyId, from, to: kind === 'moved' ? to : null, detail })
    }

  const evaluateOnce = (): void => {
    const settings = deps.getSettings()
    const setting = settings.claudeSessionMover ?? 'ask'
    if (setting === 'off') {
      return
    }
    const effective = setting === 'ask' && deps.headless ? 'move' : setting
    if (effective !== setting && !headlessAskLogged) {
      headlessAskLogged = true
      console.info('[claude-session-mover] setting is "ask" on a headless host; nobody can answer, so it acts as "move"')
    }
    const now = Date.now()
    const state = deps.rateLimits.getState()
    const accounts = deps.accounts.listAccounts().accounts
    const selectedId = getSelectedClaudeAccountIdForTarget(settings, state.claudeTarget)
    const views = collectClaudeMoverSessions({
      records: deps.registry.list(),
      statuses: deps.hooks.getStatusChangeSnapshot(),
      providerSessions: deps.hooks.getProviderSessionIdentities(),
      resolvePaneKey: deps.resolvePaneKey,
      resolvePtyIdForPaneKey: deps.resolvePtyIdForPaneKey,
      resolveWorktreeId: deps.resolveWorktreeId,
      accounts: settings.claudeManagedAccounts.map((account) => ({
        id: account.id,
        homes: [account.managedAuthPath, ...deps.accountHomes(account.id)]
      })),
      recordInferred: deps.registry.record,
      now
    })
    const live = new Set(views.map((view) => view.record.ptyId))
    for (const map of [lastMoveAt, lastFailureAt, lastAskAt, lastDecision]) {
      for (const ptyId of map.keys()) {
        if (!live.has(ptyId)) {
          map.delete(ptyId)
        }
      }
    }
    for (const [accountId, claim] of targetClaims) {
      if (now - claim.at >= CLAUDE_SESSION_MOVE_COOLDOWN_MS) {
        targetClaims.delete(accountId)
      }
    }
    let readRequested = false
    for (const view of views) {
      const { ptyId } = view.record
      const from = accounts.find((account) => account.id === view.record.accountId)
      if (!from || inflight.has(ptyId)) {
        continue
      }
      const own = claudeUsageForAccount(state, from, selectedId)
      const candidateAccounts = claudeMoveCandidates(accounts, from)
      const candidates = candidateAccounts
        .map((account) => claudeUsageForAccount(state, account, selectedId))
        .filter((usage): usage is InactiveAccountUsage => usage !== null)
      const decision = decideClaudeSessionMove({
        now,
        setting: effective,
        pinned: view.record.pinned,
        paneState: view.paneState,
        usage: own?.rateLimits ?? null,
        candidates,
        candidateCount: candidateAccounts.length,
        lastUsageReadAt,
        lastMoveAt: lastMoveAt.get(ptyId) ?? 0,
        lastFailureAt: lastFailureAt.get(ptyId) ?? 0,
        targetClaims
      })
      if (decision.kind === 'read-usage') {
        readRequested = true
        continue
      }
      if (decision.kind === 'stay' || decision.kind === 'wait') {
        if (decision.kind === 'wait' || decision.reason !== 'under-line') {
          remember(view, from, null, `${decision.kind}:${decision.reason}`, own?.rateLimits ?? null, now)
        }
        continue
      }
      const to = accounts.find((account) => account.id === decision.to)
      if (!to) {
        continue
      }
      const settled = settle(view, from, to, own?.rateLimits ?? null)
      if (!view.providerSession) {
        settled('skipped', 'no-provider-session')
        continue
      }
      if (effective === 'ask') {
        if (now - (lastAskAt.get(ptyId) ?? 0) >= CLAUDE_SESSION_MOVE_COOLDOWN_MS) {
          lastAskAt.set(ptyId, now)
          remember(view, from, to, 'ask', own?.rateLimits ?? null, now)
          deps.onNotice({ kind: 'ask', ptyId, from, to, detail: `${decision.window.name} ${decision.window.percent}%` })
        }
        continue
      }
      if (!view.paneKey || !view.worktreeId) {
        settled('skipped', 'no-pane')
        continue
      }
      // Why the claim: five sessions over the line must not all pick the same account in one tick.
      targetClaims.set(to.id, { at: now, debit: (targetClaims.get(to.id)?.debit ?? 0) + CLAUDE_SESSION_MOVE_CLAIM_DEBIT_PERCENT })
      inflight.add(ptyId)
      remember(view, from, to, 'moving', own?.rateLimits ?? null, now)
      void deps.strategy
        .move({ ptyId, paneKey: view.paneKey, worktreeId: view.worktreeId, connectionId: null, toAccountId: to.id, providerSession: view.providerSession })
        .then((outcome) => {
          if (outcome.kind === 'moved') {
            settled('moved', outcome.newPtyId)
          } else if (outcome.kind === 'skipped') {
            settled('skipped', outcome.reason)
          } else {
            settled('failed', `${outcome.reason}: ${outcome.error}`)
          }
        })
        .catch((error: unknown) => {
          settled('failed', error instanceof Error ? error.message : String(error))
        })
        .finally(() => {
          inflight.delete(ptyId)
        })
    }
    if (readRequested) {
      lastUsageReadAt = now
      // Why deferred: the usage service publishes from inside this call, and this runs mid-publish.
      queueMicrotask(() => {
        deps.rateLimits
          .fetchInactiveClaudeAccountsOnOpen()
          .catch((error: unknown) => console.warn('[claude-session-mover] Failed to read inactive Claude usage:', error))
      })
    }
  }

  const evaluate = (): void => {
    if (evaluating) {
      queued = true
      return
    }
    evaluating = true
    try {
      evaluateOnce()
    } finally {
      evaluating = false
      if (queued) {
        queued = false
        queueMicrotask(evaluate)
      }
    }
  }

  return {
    start: () => {
      const unsubscribeState = deps.rateLimits.onStateChange(() => evaluate())
      const unsubscribeStatus = deps.hooks.subscribeStatusChanges(() => evaluate())
      return () => {
        unsubscribeState()
        unsubscribeStatus()
      }
    },
    evaluate,
    lastDecisions: () => [...lastDecision.values()].sort((a, b) => b.at - a.at)
  }
}
```

- [x] **Step 5: Run — expect green**

```bash
corepack pnpm exec vitest run --config config/vitest.config.ts src/main/claude-accounts/claude-session-mover.test.ts 2>&1 | tail -6
```
Expected: `Tests  9 passed (9)`. If the claim test's second move does not fire, the first thing to check is that `vi.setSystemTime` advanced past both `CLAUDE_SESSION_MOVE_TARGET_COOLDOWN_MS` and that `publish` re-ran `evaluate` (the mover only re-decides on a state or status change).

- [x] **Step 6: Expose the decisions through the accounts state**

`src/main/claude-accounts/claude-account-selection.ts`:
- extend `ClaudeAccountSettings` (lines 28–34) with `| 'claudeSessionMover'`;
- add a field + two methods to `ClaudeAccountSelection` (after the constructor, line 64):
```ts
  private sessionMovesProvider: (() => ClaudeSessionMoveSummary[]) | null = null

  /** The session mover hands over its last decisions, so `orca account list --json` can show them. */
  setSessionMovesProvider(provider: (() => ClaudeSessionMoveSummary[]) | null): void {
    this.sessionMovesProvider = provider
  }

  setSessionMover(setting: ClaudeSessionMoverSetting): ClaudeRateLimitAccountsState {
    this.saveSettings({ claudeSessionMover: setting })
    return this.list()
  }
```
- in `list()`'s returned object, after `autoSwitchEnabled: settings.claudeAutoSwitchEnabled === true,` add:
```ts
      sessionMover: settings.claudeSessionMover ?? 'ask',
      sessionMoves: this.sessionMovesProvider?.() ?? [],
```
- imports: `ClaudeSessionMoveSummary` from `'../../shared/managed-account-types'` (join the existing type import), `import type { ClaudeSessionMoverSetting } from '../../shared/claude-account-switch-settings'`.

`src/main/claude-accounts/service.ts` — after `setAutoSwitch` (line 128):
```ts
  setSessionMover(setting: ClaudeSessionMoverSetting): ClaudeRateLimitAccountsState {
    return this.selection.setSessionMover(setting)
  }

  setSessionMovesProvider(provider: (() => ClaudeSessionMoveSummary[]) | null): void {
    this.selection.setSessionMovesProvider(provider)
  }
```
with the two type imports.

- [x] **Step 7: Build and start the mover where the services are built**

`src/main/provider-account-services.ts`:
- imports:
```ts
import type { RuntimePtyController } from './runtime/runtime-pty-controller-contract'
import { agentHookServer } from './agent-hooks/server'
import { listClaudePaneAccounts, recordClaudePaneAccount } from './claude-accounts/claude-pane-account-registry'
import { createClaudeSessionMover, type ClaudeSessionMoveNotice, type ClaudeSessionMover } from './claude-accounts/claude-session-mover'
import { createResumeMoveStrategy } from './claude-accounts/claude-session-move-strategy'
import { getPtyIdForPaneKey, ptyPaneKey } from './ipc/pty/pane/key-state'
import { listRegisteredPtys } from './memory/pty-registry'
```
- `ProviderAccountServices` gains `sessionMover: ClaudeSessionMover | null`;
- `options` gains:
```ts
    /** Absent = no mover on this host (tests). */
    sessionMover?: {
      headless: boolean
      getController: () => Pick<RuntimePtyController, 'spawn' | 'getCwd' | 'getSize'> | null
      onNotice: (notice: ClaudeSessionMoveNotice) => void
    }
```
- after the `setLiveClaudeAccountResolver` call (Task 2) add:
```ts
  const sessionMover = options.sessionMover
    ? createClaudeSessionMover({
        getSettings: () => store.getSettings(),
        rateLimits,
        accounts: claudeAccounts,
        hooks: agentHookServer,
        registry: { list: listClaudePaneAccounts, record: recordClaudePaneAccount },
        resolvePaneKey: (ptyId) => ptyPaneKey.get(ptyId) ?? null,
        resolvePtyIdForPaneKey: (paneKey) => getPtyIdForPaneKey(paneKey) ?? null,
        resolveWorktreeId: (ptyId) => listRegisteredPtys().find((pty) => pty.ptyId === ptyId)?.worktreeId ?? null,
        // Why the System-default home too: a pane on System default records the COVERED account's id (Task 1
        // convention), so transcript inference must own ~/.claude for that account or the two sources disagree.
        accountHomes: (accountId) =>
          claudeRuntimeAuth.router.coveredBySystemDefault(accountId)
            ? [claudeRuntimeAuth.router.accountHome(accountId), claudeRuntimeAuth.router.systemDefaultHome()]
            : [claudeRuntimeAuth.router.accountHome(accountId)],
        strategy: createResumeMoveStrategy({
          getController: options.sessionMover.getController,
          getSettings: () => store.getSettings(),
          platform: process.platform
        }),
        headless: options.sessionMover.headless,
        onNotice: options.sessionMover.onNotice
      })
    : null
  if (sessionMover) {
    claudeAccounts.setSessionMovesProvider(() => sessionMover.lastDecisions())
    sessionMover.start()
  }
```
- return `{ rateLimits, codexRuntimeHome, codexAccounts, claudeRuntimeAuth, claudeAccounts, sessionMover }`.

`src/main/startup/main-process-account-services.ts` — add to the `createProviderAccountServices` options (after `onClaudeAutoSwitched`):
```ts
    sessionMover: {
      headless: false,
      // Why lazy: the runtime is built after the account services; the mover reads it per move.
      getController: () => state.runtime?.getPtyController() ?? null,
      onNotice: (notice) => {
        if (notice.kind === 'skipped' || !store.getSettings().notifications.enabled) {
          return
        }
        const body =
          notice.kind === 'moved'
            ? translateMain('accounts.claude.sessionMover.movedBody', '{{from}} is near its usage limit. The session continues on {{to}}.', { from: notice.from.email, to: notice.to?.email ?? '' })
            : notice.kind === 'ask'
              ? translateMain('accounts.claude.sessionMover.askBody', 'A session on {{from}} is near its usage limit. Set "Move running sessions before a usage limit" to Move to move it automatically.', { from: notice.from.email })
              : translateMain('accounts.claude.sessionMover.failedBody', 'A session on {{from}} could not be moved: {{detail}}', { from: notice.from.email, detail: notice.detail })
        getRuntimeDesktopSurface().showNotification({
          title: translateMain('accounts.claude.sessionMover.noticeTitle', 'Claude session mover'),
          body
        })
      }
    }
```
(`state.runtime` is the `OrcaRuntimeService` field of `main-process-state.ts`; `getPtyController` is Task 4's getter.)

`src/main/orcad/orcad-account-services.ts`:
- widen `attachToRuntime`'s parameter type to `Pick<OrcaRuntimeService, 'setAccountServices' | 'setCommitMessageAgentEnvironmentResolvers' | 'getPtyController' | 'dispatchMobileNotification'>`;
- hold the runtime: before `const services = createProviderAccountServices(…)` add `let attachedRuntime: Pick<OrcaRuntimeService, 'getPtyController' | 'dispatchMobileNotification'> | null = null`, and pass:
```ts
  const services = createProviderAccountServices(store, {
    setClaudeStatusLineListener: args.setClaudeStatusLineListener,
    sessionMover: {
      headless: true,
      getController: () => attachedRuntime?.getPtyController() ?? null,
      // Why the notification stream: no window is attached here; a paired client sees it when it next connects.
      onNotice: (notice) =>
        attachedRuntime?.dispatchMobileNotification({
          type: 'notification',
          source: 'plugin',
          title: 'Claude session mover',
          body: `${notice.kind}: session ${notice.ptyId} on ${notice.from.email}${notice.to ? ` → ${notice.to.email}` : ''} (${notice.detail})`
        })
    }
  })
```
- in `attachToRuntime: (runtime) => { attachedRuntime = runtime; runtime.setAccountServices({ … }) … }` (first line of the callback).

- [x] **Step 8: Typecheck, run the claude-accounts folder, commit**

```bash
corepack pnpm run typecheck:node 2>&1 | tail -3
corepack pnpm exec vitest run --config config/vitest.config.ts src/main/claude-accounts src/main/orcad src/main/startup 2>&1 | tail -6
git add src/main/claude-accounts/claude-session-mover-sessions.ts src/main/claude-accounts/claude-session-mover.ts src/main/claude-accounts/claude-session-mover.test.ts src/main/claude-accounts/claude-account-selection.ts src/main/claude-accounts/service.ts src/main/provider-account-services.ts src/main/startup/main-process-account-services.ts src/main/orcad/orcad-account-services.ts
git commit -m "feat(claude-accounts): session mover moves running Claude sessions before a usage limit"
```
Expected: no `error TS`; all suites pass (the orcad/startup folders have existing tests that construct these services with the `sessionMover` option absent → `null`, unchanged behaviour).

---

### Task 8: Setting surface — RPC, CLI, `orca account list`, Settings row, strings

**Files:**
- Modify: `src/shared/rpc-contract/accounts-params.ts` (after line 34), `src/main/runtime/rpc/methods/accounts.ts` (after line 132), `src/main/runtime/runtime-account-controller.ts` (after line 185), `src/main/runtime/runtime-service-command-surface.ts` (lines 54 and 160), `src/shared/rpc-contract/rpc-params-catalog.generated.ts` (regenerated), `src/main/runtime/rpc/methods/accounts.test.ts` (after line 209)
- Modify: `src/shared/cli-argument-boundary.ts`, `src/cli/specs/account.ts`, `src/cli/handlers/account.ts` (lines 44 and 320), `src/cli/handler-group-manifest.ts` (line 38), `src/cli/root-help-text-primary.ts` (after line 31), `src/cli/root-help-text-secondary.ts` (after line 47), `src/cli/index.ts` (line 34), `src/cli/handlers/account-list-format.ts`, `src/cli/handlers/account.test.ts`, `src/cli/index-local-command-routing-flags.test.ts`
- Create: `src/cli/handlers/account-session-mover.ts`, `src/renderer/src/components/settings/claude-session-mover-setting.tsx`
- Modify: `src/renderer/src/components/settings/accounts-pane-claude-section.tsx` (line 372–374), `src/renderer/src/i18n/locales/en.json` (inside `accounts.claude`, after the `switchSessions` block)

- [x] **Step 1: RPC test first**

Append to `describe` in `src/main/runtime/rpc/methods/accounts.test.ts`, right after the auto-switch test (line 209):
```ts
  it('sets the Claude session-mover policy on the server that owns the accounts', async () => {
    const state = { accounts: [], activeAccountId: null, sessionMover: 'move' }
    const setClaudeSessionMover = vi.fn().mockReturnValue(state)
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the handler only calls setClaudeSessionMover.
    const runtime = { setClaudeSessionMover } as unknown as OrcaRuntimeService
    const set = method('accounts.setClaudeSessionMover')
    if (isStreamingMethod(set)) {
      throw new Error('accounts.setClaudeSessionMover must be a request method')
    }

    expect(set.permission).toBe('accounts-admin')
    expect(() => set.params?.parse({ setting: 'sometimes' })).toThrow()
    await expect(set.handler({ setting: 'move' }, { runtime })).resolves.toEqual(state)
    expect(setClaudeSessionMover).toHaveBeenCalledWith('move')
  })
```
Run: `corepack pnpm exec vitest run --config config/vitest.config.ts src/main/runtime/rpc/methods/accounts.test.ts 2>&1 | tail -6` → one failure: `method('accounts.setClaudeSessionMover')` finds no such method (the helper throws or returns undefined — the message names `accounts.setClaudeSessionMover`).

- [x] **Step 2: RPC implementation**

`src/shared/rpc-contract/accounts-params.ts` — after line 34:
```ts
export const SetClaudeSessionMoverParams = z.object({ setting: z.enum(['off', 'ask', 'move']) })
```
`src/main/runtime/rpc/methods/accounts.ts` — add `SetClaudeSessionMoverParams` to the import list and, after the `accounts.setClaudeAutoSwitch` method (line 132):
```ts
  defineMethod({
    name: 'accounts.setClaudeSessionMover',
    permission: 'accounts-admin',
    params: SetClaudeSessionMoverParams,
    handler: async (params, { runtime }) => runtime.setClaudeSessionMover(params.setting)
  }),
```
`src/main/runtime/runtime-account-controller.ts` — after `setClaudeAutoSwitch` (line 185):
```ts
  setClaudeSessionMover(setting: ClaudeSessionMoverSetting): ClaudeRateLimitAccountsState {
    return this.requireServices().claudeAccounts.setSessionMover(setting)
  }
```
with `import type { ClaudeSessionMoverSetting } from '../../shared/claude-account-switch-settings'`.
`src/main/runtime/runtime-service-command-surface.ts` — after line 54 add `setClaudeSessionMover: RuntimeAccountController['setClaudeSessionMover']`; after line 160 add `setClaudeSessionMover: accounts.setClaudeSessionMover.bind(accounts),`.

Regenerate and verify the catalog:
```bash
corepack pnpm run generate:rpc-params-catalog 2>&1 | tail -2
corepack pnpm run verify:rpc-params-catalog 2>&1 | tail -2
grep -n "setClaudeSessionMover" src/shared/rpc-contract/rpc-params-catalog.generated.ts
corepack pnpm exec vitest run --config config/vitest.config.ts src/main/runtime/rpc/methods/accounts.test.ts 2>&1 | tail -4
```
Expected: the verify step exits 0; one catalog line `'accounts.setClaudeSessionMover': SetClaudeSessionMoverParams,`; the RPC suite passes.

- [x] **Step 3: CLI tests first**

Append inside `describe('account auto-switch', …)`'s parent describe in `src/cli/handlers/account.test.ts` (after the auto-switch describe block) a new block:
```ts
  describe('account session-mover', () => {
    function moverContext(flags: [string, string | boolean][], json = false): HandlerContext {
      return { ...context('claude', json), flags: new Map<string, string | boolean>(flags) }
    }

    it('sets the policy through accounts.setClaudeSessionMover and prints it', async () => {
      callMock.mockResolvedValue({
        id: 'test',
        ok: true,
        result: { accounts: [], activeAccountId: null, sessionMover: 'move' },
        _meta: { runtimeId: 'test-runtime' }
      })
      await ACCOUNT_HANDLERS['account session-mover'](moverContext([['agent', 'claude'], ['move', true]]))
      expect(callMock).toHaveBeenCalledWith('accounts.setClaudeSessionMover', { setting: 'move' })
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('session-mover: move'))
    })

    it('prints JSON with --json', async () => {
      callMock.mockResolvedValue({
        id: 'test',
        ok: true,
        result: { accounts: [], activeAccountId: null, sessionMover: 'off' },
        _meta: { runtimeId: 'test-runtime' }
      })
      await ACCOUNT_HANDLERS['account session-mover'](moverContext([['off', true]], true))
      expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toEqual({ sessionMover: 'off' })
    })

    it('needs exactly one of --off, --ask, --move and only --agent claude', async () => {
      await expect(ACCOUNT_HANDLERS['account session-mover'](moverContext([]))).rejects.toThrow('exactly one of --off, --ask or --move')
      await expect(
        ACCOUNT_HANDLERS['account session-mover'](moverContext([['ask', true], ['move', true]]))
      ).rejects.toThrow('exactly one of --off, --ask or --move')
      await expect(
        ACCOUNT_HANDLERS['account session-mover'](moverContext([['agent', 'codex'], ['move', true]]))
      ).rejects.toThrow('Only --agent claude')
      expect(callMock).not.toHaveBeenCalled()
    })
  })
```
and a list-format case next to the existing auto-switch list test (after line 740):
```ts
  it('shows the session-mover policy in the Claude block when the host reports it', async () => {
    callMock.mockResolvedValue({
      id: 'test',
      ok: true,
      result: {
        claude: { accounts: [{ id: 'a', email: 'a@example.com' }], activeAccountId: 'a', autoSwitchEnabled: true, sessionMover: 'move' },
        codex: { accounts: [], activeAccountId: null }
      },
      _meta: { runtimeId: 'test-runtime' }
    })
    await ACCOUNT_HANDLERS['account list']({ ...context('claude'), flags: new Map() })
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('  auto-switch: on\n  session-mover: move'))
  })
```
And in `src/cli/index-local-command-routing-flags.test.ts`, after the auto-switch routing test (line 298):
```ts
  it('routes `account session-mover --environment` to the named server too', async () => {
    pairRuntimeEnvironment(listEnvironmentsMock, 'env-m4air', 'm4air')
    callMock.mockImplementation(async (method: string) => {
      if (method === 'accounts.setClaudeSessionMover') {
        return okFixture('req_session_mover', { accounts: [], activeAccountId: null, sessionMover: 'move' })
      }
      throw new Error(`unexpected ${method}`)
    })
    logSpy.mockClear()
    runtimeClientConstructorMock.mockClear()

    await main(['account', 'session-mover', '--agent', 'claude', '--move', '--environment', 'm4air', '--json'], '/tmp/repo')

    expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toEqual({ sessionMover: 'move' })
    expect(runtimeClientConstructorMock).toHaveBeenCalledWith(undefined, 'm4air')
    expect(callMock).toHaveBeenCalledWith('accounts.setClaudeSessionMover', { setting: 'move' })
  })
```
(`okFixture`, `pairRuntimeEnvironment`, `listEnvironmentsMock`, `runtimeClientConstructorMock`, `logSpy`, `callMock`, `main` are the helpers the neighbouring test already uses — copy their exact names from lines 272–298 if they differ.)

Run: `corepack pnpm exec vitest run --config config/vitest.config.ts src/cli/handlers/account.test.ts src/cli/index-local-command-routing-flags.test.ts 2>&1 | tail -8` → failures: `ACCOUNT_HANDLERS['account session-mover'] is not a function` and the routing test's unknown command.

- [x] **Step 4: CLI implementation**

`src/shared/cli-argument-boundary.ts` — insert `'ask',` after `'allow-failed-archive-hook',` (line 7) and `'move',` after `'mobile-pairing',` (line 36) in `CLI_BOOLEAN_FLAGS`.

`src/cli/handlers/account-session-mover.ts`:
```ts
import type { HandlerContext } from '../dispatch'
import { RuntimeClientError } from '../runtime-client'
import type { ClaudeSessionMoverSetting } from '../../shared/claude-account-switch-settings'
import type { ClaudeRateLimitAccountsState } from '../../shared/managed-account-types'

const SETTINGS: readonly ClaudeSessionMoverSetting[] = ['off', 'ask', 'move']

/**
 * `orca account session-mover --agent claude --off|--ask|--move`: writes the host setting behind
 * Settings › Accounts › Claude › "Move running sessions before a usage limit".
 *
 * Why no remote-flag rejection: the mover acts on the sessions of the runtime it is written on, so
 * `--environment <server>` is the one way to set it for a headless Orca server.
 */
export async function setClaudeSessionMover(ctx: HandlerContext): Promise<void> {
  const agent = ctx.flags.get('agent') ?? 'claude'
  if (agent !== 'claude') {
    throw new RuntimeClientError('invalid_argument', 'Only --agent claude supports session-mover today.')
  }
  const picked = SETTINGS.filter((setting) => ctx.flags.get(setting) === true)
  if (picked.length !== 1) {
    throw new RuntimeClientError('invalid_argument', 'Pass exactly one of --off, --ask or --move.')
  }
  const result = await ctx.client.call<ClaudeRateLimitAccountsState>('accounts.setClaudeSessionMover', {
    setting: picked[0]
  })
  const setting = result.result.sessionMover ?? picked[0]
  if (ctx.json) {
    console.log(JSON.stringify({ sessionMover: setting }, null, 2))
    return
  }
  console.log(`Claude session-mover: ${setting}`)
}
```
`src/cli/handlers/account.ts` — line 44 add `import { setClaudeSessionMover } from './account-session-mover'`; in the handlers map after `'account auto-switch': setClaudeAutoSwitch` add `,\n  'account session-mover': setClaudeSessionMover`.
`src/cli/handler-group-manifest.ts` line 38 — append `'account session-mover'` to `keys`.
`src/cli/specs/account.ts` — append a spec entry after the auto-switch one:
```ts
  {
    path: ['account', 'session-mover'],
    summary: 'Choose whether running Claude sessions move to another account before a usage limit',
    usage: 'orca account session-mover --agent claude (--off | --ask | --move) [--environment <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'agent', 'off', 'ask', 'move'],
    notes: [
      'Writes the host setting behind Settings › Accounts › Claude › "Move running sessions before a usage limit" (accounts.setClaudeSessionMover).',
      'move: a running session whose own account passes a line (5-hour 95 %, weekly or Fable-weekly 90 %) resumes between turns, in the same pane, on the account with the most room. ask: the desktop shows a notice instead; a headless server treats ask as move. off: never.',
      'With --environment the setting is written on that paired Orca server, whose sessions it then governs. `orca account list --json` shows the last decision per live session under claude.sessionMoves.'
    ],
    examples: [
      'orca account session-mover --agent claude --move',
      'orca account session-mover --agent claude --move --environment macstudio'
    ]
  }
```
`src/cli/root-help-text-primary.ts` — after line 31 add `'  account session-mover     Move running Claude sessions to another account before a usage limit',`; `src/cli/root-help-text-secondary.ts` — after line 47 add `'  orca account session-mover --agent claude --off|--ask|--move [--environment <selector>]',` (match the quoting/commas of the neighbouring entries).
`src/cli/index.ts` line 34 — change the carve-out to
```ts
    (commandPath[0] === 'account' &&
      commandPath[1] !== 'auto-switch' &&
      commandPath[1] !== 'session-mover') ||
```
`src/cli/handlers/account-list-format.ts` — add to `AccountsBlock`:
```ts
  /** Claude only: what the host does with running sessions near a usage limit (absent from older hosts). */
  sessionMover?: 'off' | 'ask' | 'move'
```
and after the `auto-switch` line push (line 47):
```ts
  if (block.sessionMover !== undefined) {
    lines.push(`  session-mover: ${block.sessionMover}`)
  }
```

```bash
corepack pnpm exec vitest run --config config/vitest.config.ts src/cli/handlers/account.test.ts src/cli/index-local-command-routing-flags.test.ts src/cli/specs 2>&1 | tail -6
corepack pnpm run typecheck:cli 2>&1 | tail -3
```
Expected: all CLI suites pass (the specs suite checks every `allowedFlags` entry is a known flag — that is why `ask`/`move` went into `CLI_BOOLEAN_FLAGS`); no `error TS`.

- [x] **Step 5: Settings row + strings**

`src/renderer/src/i18n/locales/en.json` — inside `"claude": { … }` under `"accounts"`, after the `"switchSessions": { … }` object, add a sibling:
```json
      "sessionMover": {
        "settingTitle": "Move running sessions before a usage limit",
        "settingDescription": "A running Claude session whose own account nears its limit continues on the account with the most room, between turns, in the same pane.",
        "settingOff": "Off",
        "settingAsk": "Ask",
        "settingMove": "Move",
        "noticeTitle": "Claude session mover",
        "movedBody": "{{from}} is near its usage limit. The session continues on {{to}}.",
        "askBody": "A session on {{from}} is near its usage limit. Set \"Move running sessions before a usage limit\" to Move to move it automatically.",
        "failedBody": "A session on {{from}} could not be moved: {{detail}}"
      },
```
(keep the file's two-space indentation and trailing commas consistent with its neighbours; `oxfmt --write` on commit normalises JSON.)

`src/renderer/src/components/settings/claude-session-mover-setting.tsx`:
```tsx
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import type { ClaudeSessionMoverSetting } from '../../../../shared/claude-account-switch-settings'
import { translate } from '@/i18n/i18n'
import { Label } from '../ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { SearchableSetting } from './SearchableSetting'

const SETTINGS: readonly ClaudeSessionMoverSetting[] = ['off', 'ask', 'move']

function isSetting(value: string): value is ClaudeSessionMoverSetting {
  return SETTINGS.some((setting) => setting === value)
}

export function ClaudeSessionMoverSetting({
  settings,
  updateSettings
}: {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}): React.JSX.Element {
  const title = translate('accounts.claude.sessionMover.settingTitle', 'Move running sessions before a usage limit')
  const description = translate(
    'accounts.claude.sessionMover.settingDescription',
    'A running Claude session whose own account nears its limit continues on the account with the most room, between turns, in the same pane.'
  )
  return (
    <SearchableSetting
      title={title}
      description={description}
      keywords={['claude', 'account', 'move', 'session', 'usage', 'limit', 'quota']}
      className="flex items-center justify-between gap-4 py-2"
    >
      <div className="min-w-0 flex-1 space-y-0.5">
        <Label>{title}</Label>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Select
        value={settings.claudeSessionMover ?? 'ask'}
        onValueChange={(value) => {
          if (isSetting(value)) {
            updateSettings({ claudeSessionMover: value })
          }
        }}
      >
        <SelectTrigger size="sm" className="w-[140px]" aria-label={title}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="off">{translate('accounts.claude.sessionMover.settingOff', 'Off')}</SelectItem>
          <SelectItem value="ask">{translate('accounts.claude.sessionMover.settingAsk', 'Ask')}</SelectItem>
          <SelectItem value="move">{translate('accounts.claude.sessionMover.settingMove', 'Move')}</SelectItem>
        </SelectContent>
      </Select>
    </SearchableSetting>
  )
}
```
`src/renderer/src/components/settings/accounts-pane-claude-section.tsx` — import `ClaudeSessionMoverSetting` beside line 11, and replace lines 372–374 with:
```tsx
      {isRemoteAccountScope ? null : (
        <>
          <ClaudeRunningSessionSwitchSetting settings={settings} updateSettings={updateSettings} />
          <ClaudeSessionMoverSetting settings={settings} updateSettings={updateSettings} />
        </>
      )}
```
(the row writes the local setting directly, as the running-session row does; a remote server's policy is set with the CLI's `--environment` flag — this is deliberate, not a gap.) No unit test for this component: it mirrors the untested `ClaudeRunningSessionSwitchSetting` one-to-one and is checked by `typecheck:web`, the localization verifiers and the rehearsal.

```bash
corepack pnpm run typecheck:web 2>&1 | tail -3
corepack pnpm run verify:localization-catalog 2>&1 | tail -4
corepack pnpm run verify:localization-extraction 2>&1 | tail -3
corepack pnpm run verify:localization-coverage 2>&1 | tail -3
```
Expected: each exits 0. If `verify:localization-catalog` lists the new keys as missing from a catalog, run `corepack pnpm run sync:localization-catalog`, then re-run the three verifiers and stage what it wrote.

- [x] **Step 6: Commit**

```bash
git add src/shared/rpc-contract/accounts-params.ts src/shared/rpc-contract/rpc-params-catalog.generated.ts src/main/runtime/rpc/methods/accounts.ts src/main/runtime/rpc/methods/accounts.test.ts src/main/runtime/runtime-account-controller.ts src/main/runtime/runtime-service-command-surface.ts src/shared/cli-argument-boundary.ts src/cli src/renderer/src/components/settings/claude-session-mover-setting.tsx src/renderer/src/components/settings/accounts-pane-claude-section.tsx src/renderer/src/i18n
git commit -m "feat(accounts): claudeSessionMover setting — RPC, CLI session-mover command, account list line, Settings row"
```

---

### Task 9: orcad starts usage polling when a usage-driven feature is on

**Files:**
- Create: `src/main/claude-accounts/claude-usage-polling-policy.ts`, `src/main/claude-accounts/claude-usage-polling-policy.test.ts`
- Modify: `src/main/orcad/orcad-account-services.ts` (lines 73–80)

- [x] **Step 1: Test**

`src/main/claude-accounts/claude-usage-polling-policy.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest'
import { createClaudeUsagePollingSwitch, shouldPollClaudeUsage } from './claude-usage-polling-policy'

describe('claude usage polling policy', () => {
  it('polls when auto-switch or the mover needs readings', () => {
    expect(shouldPollClaudeUsage({ claudeAutoSwitchEnabled: false, claudeSessionMover: 'off' })).toBe(false)
    expect(shouldPollClaudeUsage({ claudeAutoSwitchEnabled: true, claudeSessionMover: 'off' })).toBe(true)
    expect(shouldPollClaudeUsage({ claudeAutoSwitchEnabled: false, claudeSessionMover: 'move' })).toBe(true)
    // Absent means 'ask', which on a headless host acts as 'move'.
    expect(shouldPollClaudeUsage({})).toBe(true)
  })

  it('starts once, stops once, and ignores unrelated settings changes', () => {
    const rateLimits = { start: vi.fn(), stop: vi.fn() }
    let settings: { claudeAutoSwitchEnabled?: boolean; claudeSessionMover?: 'off' | 'ask' | 'move' } = { claudeSessionMover: 'off' }
    const polling = createClaudeUsagePollingSwitch(rateLimits, () => settings)

    expect(polling.apply()).toBe(false)
    expect(rateLimits.start).not.toHaveBeenCalled()

    settings = { claudeSessionMover: 'move' }
    expect(polling.apply({ claudeSessionMover: 'move' })).toBe(true)
    expect(polling.apply({ claudeSessionMover: 'move' })).toBe(true)
    expect(rateLimits.start).toHaveBeenCalledTimes(1)
    expect(rateLimits.start).toHaveBeenCalledWith({ fetchImmediately: true })

    expect(polling.apply({ theme: 'dark' })).toBe(true)
    expect(rateLimits.stop).not.toHaveBeenCalled()

    settings = { claudeSessionMover: 'off', claudeAutoSwitchEnabled: false }
    expect(polling.apply({ claudeSessionMover: 'off' })).toBe(false)
    expect(rateLimits.stop).toHaveBeenCalledTimes(1)
  })
})
```
Run: `corepack pnpm exec vitest run --config config/vitest.config.ts src/main/claude-accounts/claude-usage-polling-policy.test.ts 2>&1 | tail -4` → `Failed to load url ./claude-usage-polling-policy`.

- [x] **Step 2: Implement**

`src/main/claude-accounts/claude-usage-polling-policy.ts`:
```ts
import type { GlobalSettings } from '../../shared/global-settings-types'
import type { RateLimitService } from '../rate-limits/service'

export type ClaudeUsagePollingSettings = Partial<Pick<GlobalSettings, 'claudeAutoSwitchEnabled' | 'claudeSessionMover'>>

export const CLAUDE_USAGE_POLLING_SETTING_KEYS = ['claudeAutoSwitchEnabled', 'claudeSessionMover'] as const

/** Why: both features decide on readings; without polling a headless host never has one to decide on. */
export function shouldPollClaudeUsage(settings: ClaudeUsagePollingSettings): boolean {
  return settings.claudeAutoSwitchEnabled === true || (settings.claudeSessionMover ?? 'ask') !== 'off'
}

/** Starts polling when a usage-driven feature needs it and stops it when none does; idempotent. */
export function createClaudeUsagePollingSwitch(
  rateLimits: Pick<RateLimitService, 'start' | 'stop'>,
  getSettings: () => ClaudeUsagePollingSettings
): { apply: (updates?: object) => boolean; polling: () => boolean } {
  let polling = false
  return {
    polling: () => polling,
    apply: (updates) => {
      if (updates && !CLAUDE_USAGE_POLLING_SETTING_KEYS.some((key) => key in updates)) {
        return polling
      }
      const wanted = shouldPollClaudeUsage(getSettings())
      if (wanted && !polling) {
        rateLimits.start({ fetchImmediately: true })
        polling = true
      } else if (!wanted && polling) {
        rateLimits.stop()
        polling = false
      }
      return polling
    }
  }
}
```

- [x] **Step 3: Wire orcad**

`src/main/orcad/orcad-account-services.ts` — replace lines 76–80 (the `// Why no start(): …` comment and the `registerCleanup` call) with:
```ts
  // Why polling here: the auto-switch and the session mover decide on usage readings; without a window
  // asking for them a server never had one, so both features were inert on `orca serve` (#19900 etc.).
  const polling = createClaudeUsagePollingSwitch(services.rateLimits, () => store.getSettings())
  polling.apply()
  store.onSettingsChanged((updates) => {
    polling.apply(updates)
  })
  args.registerCleanup(() => {
    services.rateLimits.stop()
    args.setClaudeStatusLineListener(null)
  })
```
with `import { createClaudeUsagePollingSwitch } from '../claude-accounts/claude-usage-polling-policy'`.

- [x] **Step 4: Run, typecheck, commit**

```bash
corepack pnpm exec vitest run --config config/vitest.config.ts src/main/claude-accounts/claude-usage-polling-policy.test.ts src/main/orcad 2>&1 | tail -6
corepack pnpm run typecheck:node 2>&1 | tail -3
git add src/main/claude-accounts/claude-usage-polling-policy.ts src/main/claude-accounts/claude-usage-polling-policy.test.ts src/main/orcad/orcad-account-services.ts
git commit -m "feat(orcad): poll Claude usage while auto-switch or the session mover is on"
```
Expected: `Tests  2 passed (2)` plus the orcad folder's existing tests; no `error TS`.

---

### Task 10: Full suites, typecheck, lint, build and sign `1.4.233-blowzer.1`

**Files:** none changed unless a check fails (fix forward in a follow-up commit on the same branch).

- [x] **Step 1: The suites that touch anything this branch changed**

```bash
corepack pnpm exec vitest run --config config/vitest.config.ts src/main/claude-accounts src/main/rate-limits src/main/ipc/pty src/main/runtime/rpc/methods/accounts.test.ts src/main/runtime/orca-runtime-terminal-create-idempotency.test.ts src/main/orcad src/main/startup src/cli src/shared 2>&1 | tail -8
```
Expected: `Test Files  N passed (N)`, `Tests  M passed (M)` with zero `failed`. Record N and M in STATUS.md (Task 11). A failure here is a real failure — the shared slots/partition issues that plague the Phoenix repo do not apply to vitest.

- [x] **Step 2: Typecheck all three projects + generated artefacts**

```bash
corepack pnpm run typecheck:node 2>&1 | tail -2
corepack pnpm run typecheck:cli 2>&1 | tail -2
corepack pnpm run typecheck:web 2>&1 | tail -2
corepack pnpm run verify:rpc-params-catalog 2>&1 | tail -2
corepack pnpm run verify:localization-catalog 2>&1 | tail -2 && corepack pnpm run verify:localization-extraction 2>&1 | tail -2 && corepack pnpm run verify:localization-coverage 2>&1 | tail -2
```
Expected: no `error TS`, every verifier exits 0.

- [x] **Step 3: Lint the changed files**

```bash
git diff --name-only blowzer/auto-switch...HEAD -- 'src/**/*.ts' 'src/**/*.tsx' | xargs corepack pnpm exec oxlint 2>&1 | tail -3
git diff --name-only blowzer/auto-switch...HEAD -- 'src/**/*.ts' 'src/**/*.tsx' | xargs corepack pnpm exec oxlint --config config/oxlint-react-doctor.json 2>&1 | tail -3
git diff --name-only blowzer/auto-switch...HEAD -- 'src/**/*.ts' 'src/**/*.tsx' 'src/**/*.json' | xargs corepack pnpm exec oxfmt --check 2>&1 | tail -3
corepack pnpm run check:max-lines-ratchet 2>&1 | tail -2
```
Expected: `Found 0 warnings and 0 errors` twice; `oxfmt --check` reports nothing to format (lint-staged already formatted every commit); the max-lines ratchet passes (every new file is under 200 lines; if `claude-session-mover.ts` trips it, move `settle`/`remember` into `claude-session-mover-decisions.ts` and re-run).

- [x] **Step 4: Build the desktop assets and the native helpers (30–60 min; background + poll)**

```bash
corepack pnpm run build:desktop > /tmp/orca-mover-build-desktop.log 2>&1; echo "exit=$?" >> /tmp/orca-mover-build-desktop.log
tail -3 /tmp/orca-mover-build-desktop.log
corepack pnpm run build:computer-macos && corepack pnpm run build:keyboard-layout-macos && corepack pnpm run build:notification-status-macos && corepack pnpm run ensure:electron-runtime 2>&1 | tail -2
```
Expected: `exit=0` at the end of the log; the three helper builds print their output paths.

- [x] **Step 5: Package arm64, signed, no updater feed**

```bash
CSC_NAME="Apple Development: nachumi Eliyahu (BDK84XWD78)" ORCA_NO_PUBLISH=1 ORCA_BUILD_COMMIT=$(git rev-parse --short=12 HEAD) ORCA_LOCAL_BUILD_VERSION=1.4.233-blowzer.1 corepack pnpm exec electron-builder --config config/electron-builder.config.cjs --mac --arm64 > /tmp/orca-mover-electron-builder.log 2>&1; echo "exit=$?"
tail -5 /tmp/orca-mover-electron-builder.log
```
Expected: `exit=1` is normal (the second darwin/x64 pass is refused for missing x64 native modules — see STATUS.md 2026-10-19); the arm64 artefacts exist.

- [x] **Step 6: Verify the bundle**

```bash
codesign --verify --deep --strict dist/mac-arm64/Orca.app && echo "codesign ok"
/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' dist/mac-arm64/Orca.app/Contents/Info.plist
test ! -e dist/mac-arm64/Orca.app/Contents/Resources/app-update.yml && echo "no app-update.yml"
ls -la dist/Orca-1.4.233-blowzer.1-arm64-mac.zip && shasum -a 256 dist/Orca-1.4.233-blowzer.1-arm64-mac.zip
node -e 'const a=require("@electron/asar");const s=a.extractFile("dist/mac-arm64/Orca.app/Contents/Resources/app.asar","out/main/index.js").toString();for(const n of ["claude-session-mover","setClaudeSessionMover","claudeAccountId","replacesPtyId"])console.log(n, s.includes(n))'
```
Expected: `codesign ok`; `1.4.233-blowzer.1` (read the plist, not `bin/orca --version` — that shim reports the INSTALLED app's version); `no app-update.yml`; the zip with its sha; four `true` lines (the mover code is in the packaged main bundle; if the asar's main entry is not `out/main/index.js`, list it with `node -e 'console.log(require("@electron/asar").listPackage("dist/mac-arm64/Orca.app/Contents/Resources/app.asar").filter(p=>p.includes("/main/")).slice(0,5))'` and grep that file).

- [x] **Step 7: Push the branch**

```bash
git log --oneline blowzer/auto-switch..HEAD
git log blowzer/auto-switch..HEAD --format='%an <%ae>%n%b' | grep -ciE 'co-authored-by|claude-session|generated with' || echo "no trailers"
git push -u origin blowzer/session-mover
```
Expected: nine feature commits; `no trailers` (grep count 0 prints via the `|| echo`); push accepted by `A2Z-Operations/orca`. Never open a PR or issue against `stablyai/orca`.

---

### Task 11: Rehearsal — Studio (headless) first, then the MacBook; record in STATUS.md

**Files:**
- Modify (BLOWzer repo): `docs/team/orca-fork/STATUS.md` — one dated bullet per step below, plus the final verdict.

Everything here is observation plus the owner-approved install scripts; nothing new is built.

- [x] **Step 1: Install on the Studio under the stopped service**

```bash
cd ~/Documents/claude/orca-fork
Z=dist/Orca-1.4.233-blowzer.1-arm64-mac.zip
ssh macstudio 'mkdir -p ~/work/orca-fork-install && cat > ~/work/orca-fork-install/orca.zip' < "$Z"
ssh macstudio 'shasum -a 256 ~/work/orca-fork-install/orca.zip'
ssh macstudio 'cat > ~/work/orca-fork-install/install.sh && chmod +x ~/work/orca-fork-install/install.sh' < ~/Documents/claude/BLOWzer/scripts/orca-fork/studio-install.sh
ssh macstudio '~/work/orca-fork-install/install.sh'
orca --environment macstudio status 2>&1 | head -3
```
Expected: the sha matches the local one; the script prints `new build: … (current 1.4.231-blowzer.2)`, `codesign` passes, no `app-update.yml`, `version: …`, `orca serve service status` shows the service running; `orca --environment macstudio status` = ready/reachable. The previous fork stays as `/Applications/Orca.app.bak-1.4.231-blowzer.2` (rollback = stop the service, swap the folders back, `orca serve service install …` as in the script).

- [x] **Step 2: Turn the mover on for the Studio and read the state**

```bash
orca account session-mover --agent claude --move --environment macstudio
orca account session-mover --agent claude --move --environment macstudio --json
orca --environment macstudio account list 2>&1 | grep -E "auto-switch|session-mover"
orca --environment macstudio account list --json 2>&1 | node -e 'const s=JSON.parse(require("fs").readFileSync(0,"utf8"));console.log(JSON.stringify({sessionMover:s.claude.sessionMover, sessionMoves:s.claude.sessionMoves, inactive:s.rateLimits.inactiveClaudeAccounts.map(u=>[u.accountId,u.rateLimits?.session?.usedPercent,u.rateLimits?.weekly?.usedPercent,u.updatedAt])},null,1))'
```
Expected: `Claude session-mover: move`; `{ "sessionMover": "move" }`; the list shows `auto-switch: on` and `session-mover: move`; the JSON shows `sessionMoves: []` and, within ~15 s of the install (polling now starts at boot on the server), a reading per inactive account. Record which account has the least 5-hour headroom — that is the rehearsal account `R`.

- [ ] **Step 3: Start a scratch Claude session on `R` on the Studio and make it non-selected**

The headless selection is set from Orca on the MacBook: Orca → environment `macstudio` → status bar Claude account menu → pick `R`. Then:
```bash
REPO=$(orca --environment macstudio repo list --json 2>&1 | node -e 'const r=JSON.parse(require("fs").readFileSync(0,"utf8"));const x=(r.repos??r).find(e=>/BLOWzer/.test(e.path??""));console.log(x.id+"::"+x.path)')
orca --environment macstudio terminal create --worktree "id:$REPO" --agent claude --title "mover-rehearsal" 2>&1 | tail -3
```
Record the terminal handle `T`. Switch the Studio's selected account back to the account with the most room (same menu) so `R` is now a non-selected account with a live session. Confirm the registry knows the session: `orca --environment macstudio account list --json | …sessionMoves` is still empty (no decision yet — fine) and the serve log shows the spawn recorded nothing abnormal:
```bash
ssh macstudio 'tail -n 50 ~/Library/Logs/Orca/com.stablyai.orca.serve.log | grep -E "claude-session-mover|rate-limits" || true'
```

- [ ] **Step 4: Drive `R` to the line and watch the move**

Send prompts to `T` until `R`'s 5-hour window crosses 95 % (choose `R` so it is already close; never lower the lines in code for a rehearsal). Between prompts:
```bash
orca --environment macstudio terminal send "$T" "Summarise the last answer in one sentence."
orca --environment macstudio terminal read "$T" --lines 20 | tail -8
ssh macstudio 'grep -E "\[claude-session-mover\]" ~/Library/Logs/Orca/com.stablyai.orca.serve.log | tail -n 5'
orca --environment macstudio account list --json 2>&1 | node -e 'const s=JSON.parse(require("fs").readFileSync(0,"utf8"));console.log(JSON.stringify(s.claude.sessionMoves,null,1))'
```
Expected sequence in the log: `wait:mid-turn` while a prompt runs (if the line was crossed mid-turn), then `moving pty=<old> from=<R email> to=<best email>` then `moved pty=<old> …`; `sessionMoves` shows one record with `reason: "moved"`, `window: "session"`, `percent ≥ 95`, `line: 95`, `toAccountId` = the account with the most room. `terminal read` shows Claude restarting with the conversation history intact (the previous exchanges are visible, the next prompt gets an answer). `orca --environment macstudio terminal list` still lists `T` (same handle, same pane). Record the log lines and the `sessionMoves` JSON in STATUS.md. If instead the log says `skipped:no-provider-session`, the hook server had no `session_id` for the pane yet — send one more prompt (Claude's first hook post carries it) and watch again.

- [ ] **Step 5: Install on the MacBook (owner runs it from a plain terminal — it quits Orca)**

```bash
~/Documents/claude/BLOWzer/scripts/orca-fork/macbook-install.sh ~/Documents/claude/orca-fork/dist/Orca-1.4.233-blowzer.1-arm64-mac.zip
orca account session-mover --agent claude --move
orca account list | grep -E "auto-switch|session-mover"
```
Expected: the script prints `installing 1.4.233-blowzer.1 over 1.4.231-blowzer.1`, codesign ok, no `app-update.yml`, relaunch, `runtimeState` ready, `auto-switch: on`; then `Claude session-mover: move`, `session-mover: move`. Settings → AI Provider Accounts → Claude shows the new row "Move running sessions before a usage limit" set to Move. Repeat Step 3/4 on the MacBook with a desktop terminal pane: the pane itself must show the resumed conversation (the renderer follows the swapped pane binding to the new PTY) and a macOS notification "Claude session mover — <R> is near its usage limit. The session continues on <best>." appears.

- [ ] **Step 6: Record and hand off**

Append to BLOWzer `docs/team/orca-fork/STATUS.md` one bullet per step with: fork head sha, zip sha, test counts from Task 10 Step 1, the Studio `sessionMoves` JSON and log lines, the MacBook observation (pane continuity + notification), and the rollback paths (`/Applications/Orca.app.bak-1.4.231-blowzer.2` on the Studio, `.bak-1.4.231-blowzer.1` on the MacBook). Commit that file in the BLOWzer repo as `Nachumi Eliyahu <nachumi@a2zoperations.com>` (`git -C ~/Documents/claude/BLOWzer add docs/team/orca-fork/STATUS.md && git -C ~/Documents/claude/BLOWzer commit -m "Orca fork: session mover 1.4.233-blowzer.1 rehearsal on the Studio and the MacBook"`). Then observe one day of `[claude-session-mover]` lines on both hosts (spec §6 step 3) before the upstream-PR question goes to the owner.

---

## Self-review

**Spec coverage**

| Spec section | Where in this plan |
|---|---|
| §3.1 registry: record at spawn, forget on exit, `pinned`, transcript fallback, `list/get/byAccount` | Task 1 (registry + `recordClaudePaneAccountForSpawn` at both commit sites + `state-cleanup`), Task 7 Step 1 (`collectClaudeMoverSessions` infers + records pinned) |
| §3.2 live usage routing: non-selected managed account → its inactive entry, unknown dropped, selected unchanged | Task 2 |
| §3.3 decision: own account's usage, stale → read-usage once per poll, shared lines, pinned → at-limit only, target over signed-in same-runtime accounts minus claimed, debit, `done` only, off/ask/move, headless ask = move, cooldowns 5 min / 60 s / 60 s failure, decision record + log + `--json` | Task 5 (policy), Task 7 (mover service, `lastDecisions`, `sessionMoves` in the accounts state), Task 8 (`orca account list --json`) |
| §3.4 strategy: `buildAgentResumeStartupPlan` + provider session, target env via `launchEnvFor`, `replacesPtyId` through `pane-owner-replacement`, `initiallyHidden`, no provider session → skip + notice, owner-changed → abort/mark/retry, stop only after acceptance | Task 3 (`launchEnvFor`/`prepareLaunchFor`), Task 4 (`replacesPtyId`, `claudeAccountId`, swap/release), Task 6 (strategy), Task 7 (skip notice, failure hold) |
| §3.5 headless parity: `rateLimits.start()` when auto-switch or mover on; notices into the notification channel | Task 9 (polling switch), Task 7 Step 7 (orcad `dispatchMobileNotification`) |
| §3.6 setting `claudeSessionMover` default `ask`, RPC, CLI with `--environment`, `account list` line + `--json` decisions, Settings row | Task 5 Step 1 (type + default), Task 8 |
| §3.7 no double move with upstream's renderer flow | Task 1 (re-record at every spawn), Task 7 (`inflight` set; `replacesPtyId` refuses a pane whose owner changed); no renderer restart file edited |
| §4 safety | Task 5 (never mid-turn, cooldowns, retry-after candidates, stale never moves, limit relaxes gain), Task 4/6 (prep before stop, release on failure), Task 7 (every decision logged with inputs) |
| §5 tests | Tasks 1–9 each start with the test; the eleven mover scenarios are Task 7 Step 2; rehearsal = Task 11 |
| §6 rollout: branch, tests, build, Studio first, MacBook, setting `move` on both, observe a day | Task 0, Task 10, Task 11 |
| §7 files | File structure table above (every listed new/changed file appears in a task) |

**Placeholder scan:** every step carries its file path, the code to write, the command to run and the output to expect; no "TBD", no "similar to Task N", no "add error handling" without the code. Two deliberate non-code steps are stated as such: the Settings row has no unit test (mirrors an untested component; checked by `typecheck:web`, the localization verifiers and the rehearsal), and the headless selection change in Task 11 Step 3 is a UI click (the CLI has no Claude `select`).

**Type-consistency check (against the files read on 2026-10-19):** `ClaudeRuntimeAuthPreparation` fields and `provenance` strings; `ClaudeEnvPatch` keys (`CLAUDE_PROFILE_POINTER_ENV`, `CLAUDE_INJECTED_CONFIG_DIR_ENV`, `CLAUDE_CONFIG_DIR` — the selected-account `launchEnv()` carries all three; a per-account `launchEnvFor()` patch carries `CLAUDE_CONFIG_DIR` only, because any pointer re-routes the pane's `claude` function to the selected account, and Task 4's `applyRuntimeClaudeAuthEnv` strips the three from a pinned spawn's base env before the patch); `InactiveAccountUsage { accountId, rateLimits, updatedAt, isFetching }`; `ProviderRateLimits` with `fableWeekly?`, `usageMetadata.retryAtMs/authProvenance/source`; `AgentHookStatusChangeEntry` / `AgentHookProviderSessionIdentity` shapes; `RuntimePtyController.spawn` option names (`commandDelivery: 'provider'`, `launchAgent`, `resumeProviderSession`, `persistHostSessionBinding`, `initiallyHidden`, `isNewSession`) and its result `{ id }`; `PtyRuntimeControllerDeps` ⊇ `PtyKillIpcDeps`; `stopReplacedPaneOwner` / `swapReplacedPaneBinding` / `releaseStoppedPaneBinding` signatures; `reserveIdlePaneSpawn` / `makePaneSpawnReservationKey` / `rejectPaneSpawnReservation`; `ClaudeManagedAccountSummary` (`needsSignIn`, `runsOnSystemDefault`, `managedAuthRuntime`, `wslDistro`), `ClaudeManagedAccount.managedAuthPath`; `ClaudeRateLimitAccountsState`; `ClaudeAccountSelection` store/`saveSettings`; RPC `defineMethod({ name, permission: 'accounts-admin', params, handler })` and `runtime.<method>` dispatch via the command surface; CLI `HandlerContext.flags: Map<string, string | boolean>`, `ctx.client.call<T>()` → `{ result: T }`, `RuntimeClientError('invalid_argument', …)`; `CLI_BOOLEAN_FLAGS` membership required by the specs test; `buildAgentResumeStartupPlan` inputs and `AgentStartupPlan` outputs; `resolveStartupShell(platform)`; `parsePaneKey` → `{ tabId, leafId }`; `getDefaultSettings(homedir)`; `createEmptyRateLimitState(overrides)`; `getRuntimeDesktopSurface().showNotification({ title, body })`; `translateMain(key, fallback, options)`; `dispatchMobileNotification({ type: 'notification', source: 'plugin', title, body })`. Four names are introduced by this plan and used consistently across tasks: `getPtyController()` (Task 4 → Task 7), `prepareLaunchFor` (Task 3 → Task 4), `setUpForLaunch` (Task 3, a field of `ChosenAccountRouting` in `claude-profile-chosen-account.ts`, wired by the router to the setup queue's `runForLaunch`; `prepareLaunch()` calls `runForLaunch` directly) and `applyRuntimeClaudeAuthEnv` (Task 4 Step 6 → Step 10).

---

## Controller notes recorded during execution (2026-10-19)

Decisions taken while executing, binding on later tasks:

1. **`ClaudePaneAccountRecord.accountId` = the managed account whose quota the pane consumes.** A System-default pane records the account *covered* by System default (that login is the account's). The wiring task's `accountHomes` resolver therefore returns the system-default home as an extra home of the covered account (`coveredBySystemDefault` / `systemDefaultHome` on the router — make them public if they are private), so a transcript-inferred record names the same account a spawn record would.
2. **Deferred, by design:** the recorder reads the selected account at spawn COMMIT while routing was decided at preflight. A selection switch inside that window (milliseconds) attributes one System-default pane to the new selection. Not fixed in Task 1; the mover re-validates PTY liveness/ownership and account existence before acting, so a wrong record costs at most one skipped move. A later improvement is for preflight to stash the resolved id (or the router to emit `system:<id>`).
3. **Consumer rules (Tasks 7–8):** (a) never act on a registry record alone — confirm the PTY is still owned and live; (b) when a `transcript` record and a `spawn` record disagree for one PTY, the transcript wins (an inline `CLAUDE_CONFIG_DIR=… claude` beats Orca's env patch, and the transcript shows where Claude really writes); (c) a record whose `accountId` is not a managed account today is skipped, not moved.
4. **Known leak path:** a remote relay connection that never returns leaves its in-memory records until app quit (`preserveAgentSessionOwners` keeps them so a reattach finds them). Harmless for the mover under rule 3(a).
