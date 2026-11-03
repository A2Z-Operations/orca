# Upstream v1.4.235..v1.4.243 overlap with the session mover

Date 2026-10-28. Read-only survey of local tags against the session-mover spec and plan. No working tree or index was touched.

Refs used:

- `v1.4.235` commit `136dc46477` (`release: v1.4.235`). Annotated tag object `9d00655e9e`.
- `v1.4.243` commit `2d9b595785` (`release: v1.4.243`). Annotated tag object `9548f13248`.
- Range length: `git rev-list --count v1.4.235..v1.4.243` is 1665.
- `blowzer/auto-switch` is `a880c7b912` (merge of tag v1.4.243).
- `blowzer/session-mover` tip is `ca700d5a02` (`Merge branch 'blowzer/auto-switch' (Orca v1.4.243) into blowzer/session-mover`). Parents: `9fc769ba56` (our Task 4 tip) and `a880c7b912`.
- `b93676d809` is the earlier merge of v1.4.232 into session-mover. A diff from that commit to the branch tip includes the whole v1.4.243 merge. Our Tasks 1-4 are the commits from merge-base `be87ad28a9` through `9fc769ba56`: `5375102ce8`, `5cfc908deb`, `c049bcd32f`, `6989d1ac1d`, `66c0720680`, `bc6d91df73`, `e6b9944979`, `b93676d809`, `51bca6b991`, `90ce8fb1ce`, `9fc769ba56`.

Spec: `docs/superpowers/specs/2026-10-19-orca-session-mover-design.md`. Plan: `docs/superpowers/plans/2026-10-19-orca-session-mover.md` (Tasks 1-4 built, Tasks 5-11 not started).

The answers below are about pure `v1.4.243` unless a line cites `ca700d5a02`. That tip already moved Task 1's record call and Task 4's runtime replacement onto the new seams. Later tasks should continue from the tip. This survey did not re-run those tests.

## 1. PTY spawn path

`407069bc63` (`Unify terminal starts under one host operation (#32076)`, parent `5fea2893f6`) is the restructure.

What that commit did to the two files the brief named:

- `src/main/ipc/pty/runtime/spawn-execute.ts` was renamed to `src/main/ipc/pty/spawn-execute.ts`. Numstat versus the parent is `83 127` on `src/main/ipc/pty/{runtime => }/spawn-execute.ts`. The runtime path is absent at `407069bc63` and at `v1.4.243`.
- `src/main/ipc/pty/runtime/spawn-commit-response.ts` was edited, not deleted. Numstat versus the parent is `0 39`. `git cat-file -e v1.4.243:src/main/ipc/pty/runtime/spawn-commit-response.ts` succeeds. The file is 30 lines. `resumeOutcomeOf` is at line 11 and `reportRuntimeResumeOutcome` is at line 24.

The new host operation is `runPtySpawn` in `src/main/ipc/pty/spawn-operation.ts`.

```ts
type SpawnAdapter<State extends PtySpawnOperationState> = {
  state: State
  prepare: () => Promise<void>
  commit: () => Promise<PtySpawnOutcome>
  facts: () => PtySpawnExecutionFacts
  admission?: Promise<void>
  drainsExitedStart?: true
  onCommitted?: () => void
  onOutcome?: (outcome: PtySpawnOutcome) => void
  onError?: (error: unknown) => unknown
  releasePreparation?: () => void
  releaseHiddenMark?: () => void
  adoption?: () => Pick<AdoptStablePaneArgs, 'renderer' | 'keepAbsentBinding' | 'completed'>
  replace?: () => Promise<void>
}

export async function runPtySpawn<State extends PtySpawnOperationState>(
  adapter: SpawnAdapter<State>
): Promise<PtySpawnOutcome>
```

File comment at `spawn-operation.ts:73`: "One host operation owns preparation, dispatch, settlement and cleanup for every start entry."

Order that matters for a replacement (`spawn-operation.ts:81-86`, then `:241-267`):

1. If `adapter.replace` is set, `reserveIdlePaneSpawn(replacementKey)` runs before the try.
2. Inside the try, `await adapter.replace()` runs first, then `admission`, then `beginPtySpawn`.
3. The catch calls `releaseStoppedPaneBinding` when `ctx.replacedPaneOwner` is set, then `rejectPaneSpawnReservation`.

`beginPtySpawn(ctx: PtySpawnOperationState, renderer?: boolean): Promise<AdoptStablePaneResult | null>` is `src/main/ipc/pty/spawn-begin.ts:15`.

`executePtySpawn(ctx, facts: PtySpawnExecutionFacts, chooseFresh): Promise<void>` is `src/main/ipc/pty/spawn-execute.ts:29`. Lines 40-56 already call `excludeReplacedPaneOwner(..., facts.replacedPaneOwner ?? null)` before they throw `PaneOwnerContentionError`.

`commitPtySpawn(input: PtySpawnCommitInput): Promise<PtySpawnOutcome>` is `src/main/ipc/pty/spawn-commit-assembly.ts:109`. `PtySpawnCommitState.replacedPaneOwner` is optional at line 74.

`publishCommittedPtySpawn(input: PtySpawnCommitInput): PtySpawnOutcome` is `src/main/ipc/pty/spawn-commit-publication.ts:32`. Line 44 calls `recordCodexPaneAccountForSpawn`. That is the one publication both lanes share (`9613563f5c`, `#31596`, "one commit step for both terminal start lanes").

`savePtySpawnPaneBinding(...)` is `src/main/ipc/pty/spawn-commit-binding.ts:29`. When `state.replacedPaneOwner` is set, line 42 persists through `swapReplacedPaneBinding`. A `false` persist throws the caller-supplied `refusal` (line 45).

`stopReplacedPaneOwner(deps, args): Promise<ReplacedPaneOwner>` is `src/main/ipc/pty/pane/pane-owner-replacement.ts:10`. `swapReplacedPaneBinding(store, binding, replaced)` is line 50. `reserveIdlePaneSpawn` remains in `src/main/ipc/pty/pane/spawn-reservation.ts`.

### Renderer lane already replaces a pane

`runPtyIpcSpawn(deps: PtySpawnIpcDeps, request: PtySpawnIpcArgs)` is `src/main/ipc/pty/ipc/spawn-run.ts:21`. `replacesPtyId?: string` is on the IPC args at `src/main/ipc/pty/ipc/spawn-types.ts:60`.

When `args.replacesPtyId` is set, admission is skipped up front (line 28) and the adapter gets this callback (lines 97-108):

```ts
replace: async () => {
  ctx.replacedPaneOwner = await stopReplacedPaneOwner(deps, {
    replacesPtyId: args.replacesPtyId!,
    paneKey: resolveEarlyPaneKey(args),
    worktreeId: args.worktreeId,
    connectionId: args.connectionId
  })
  await admit()
}
```

`facts()` passes `replacedPaneOwner: ctx.replacedPaneOwner` (line 69). The IPC commit asks for refusal `'terminal_pane_owner_changed'` (`src/main/ipc/pty/ipc/spawn-commit.ts:88`). There is no `claudeAccountId` on this lane. `spawn-env-codex.ts:27` only sets `resumeOnSelectedAccount: Boolean(args.replacesPtyId)`.

### Runtime lane at v1.4.243 does not replace a pane

`spawnPtyFromRuntimeController(deps: PtyRuntimeControllerDeps, request: RuntimePtySpawnArgs)` is `src/main/ipc/pty/runtime/spawn.ts:15`. The file is 74 lines. The adapter passed to `runPtySpawn` has `prepare`, `facts`, `commit`, `onCommitted`, `releaseHiddenMark`, and `adoption`. It does not pass `replace`. `facts()` does not pass `replacedPaneOwner`.

`commitRuntimePtySpawn(ctx: RuntimePtySpawnState)` is `src/main/ipc/pty/runtime/spawn-commit.ts:11`. It calls `commitPtySpawn`. `runtimeSpawnPaneBinding` (line 51) hardcodes `refusal: 'terminal_split_source_not_found'` at line 78.

`prepareRuntimePtySpawn` is `src/main/ipc/pty/runtime/spawn-preflight.ts:27`. Selected-account auth is still lines 84-87:

```ts
ctx.claudeAuth =
  ctx.isClaudeLaunch && ctx.deps.prepareClaudeAuth
    ? await ctx.deps.prepareClaudeAuth(ctx.codexSelectionTarget)
    : null
```

The IPC twin is `src/main/ipc/pty/ipc/spawn-preflight.ts:95-98`.

`RuntimePtyController` still wires `spawn: async (args) => spawnPtyFromRuntimeController(deps, args)` at `src/main/ipc/pty/runtime/controller.ts:61`.

The contract at `src/main/runtime/runtime-pty-controller-contract.ts:95` has `persistHostSessionBinding?: boolean` and, at line 110, `onResumeOutcome`. A grep of `src/main/**/*.ts` at `v1.4.243` finds no `claudeAccountId`, no `getPtyController`, and no `replacesPtyId` on the runtime contract. `replacesPtyId` in `src/main` is the IPC lane plus `pane-owner-replacement.ts`. `protected ptyController` remains at `src/main/runtime/construction/runtime-identity-state.ts:384`. `RuntimePtySpawnState` (`runtime/spawn-state.ts:36`) has no `replacedPaneOwner`. `spawn-state.ts:143` has `persistHostSessionBinding?: boolean` only.

`launchEnvFor` and `prepareLaunchFor` have no matches at `v1.4.243`.

### Where each of our Task 4 files must land

Our pre-merge signatures are at `9fc769ba56`.

| Our file at `9fc769ba56` | At `v1.4.243` | Seam our lines use |
|---|---|---|
| `runtime/spawn-execute.ts` (`resolveRuntimeStablePaneOwner`) | File is gone. Shared `executePtySpawn` already excludes `facts.replacedPaneOwner`. | Pass `replacedPaneOwner` from the runtime `facts()` callback. Do not revive `runtime/spawn-execute.ts`. |
| `runtime/spawn.ts` replacement block before the old pipeline | `runtime/spawn.ts` is the thin `spawnPtyFromRuntimeController` adapter. | `adapter.replace` on that `runPtySpawn` call, same shape as `runPtyIpcSpawn` lines 97-108. |
| `runtime/spawn-replacement.ts` `beginRuntimePaneReplacement` | File absent. `stopReplacedPaneOwner` and `reserveIdlePaneSpawn` still exist. | Keep the helper, but do not call `reserveIdlePaneSpawn` again. `runPtySpawn` already reserved when `replace` is set (`spawn-operation.ts:83-85`). |
| `runtime/spawn-claude-auth.ts` `resolveRuntimeClaudeAuth` / `applyRuntimeClaudeAuthEnv` | Absent. Selected account still goes through `prepareClaudeAuth` in preflight. | Call `resolveRuntimeClaudeAuth` inside `replace`, before `stopReplacedPaneOwner`. Preflight still applies the env patch. |
| `runtime/spawn-host-binding.ts` `resolveRuntimeHostSessionBinding` | The same checks are inline in `prepareRuntimePtySpawn` at `spawn-preflight.ts:89-99`, which runs after `replace`. | Run the check before `runPtySpawn` when `replacesPtyId` is set, so a bad pane id never stops the old process. |
| `runtime/spawn-commit.ts` `runtimePaneBindingInput` | Swap already lives in `savePtySpawnPaneBinding` (`spawn-commit-binding.ts:41-42`) if `state.replacedPaneOwner` is set. Runtime refusal is still the split message. | Put `replacedPaneOwner` on `RuntimePtySpawnState`. In `runtimeSpawnPaneBinding`, use `terminal_pane_owner_changed` when that field is set (`runtime/spawn-commit.ts:78`). |
| `runtime/spawn-state.ts` and the contract fields `replacesPtyId` / `claudeAccountId` | Neither field exists. | Add them on `RuntimePtySpawnArgs` and on `runtime-pty-controller-contract.ts` next to `initiallyHidden` (line 94). |
| `runtime-identity-state.ts` `getPtyController()` | Method absent. Field at line 384. | Add the getter beside that field. |
| `runtime/spawn-commit-response.ts` | Still there, 30 lines. We did not own it. | Leave it. `reportRuntimeResumeOutcome` publishes only when `ORCA_LAYOUT_OWNER_IS_MAIN` is on (line 26). |

Our pre-merge signatures, so the move is concrete:

```ts
export async function beginRuntimePaneReplacement(
  deps: RuntimePaneReplacementDeps,
  args: {
    replacesPtyId: string
    paneKey: string | null
    worktreeId: string | undefined
    connectionId: string | null | undefined
  },
  stopReplacedPty?: (id: string) => Promise<void>
): Promise<RuntimePaneReplacement>
```

`9fc769ba56:src/main/ipc/pty/runtime/spawn-replacement.ts:42`. It calls `reserveIdlePaneSpawn` itself (line 60). An unbound pane whose `ptyPaneKey.get(replacesPtyId)` is not `paneKey` throws `terminal_pane_owner_unknown` (lines 72-74). That extra proof is ours. `stopReplacedPaneOwner` only compares a bound owner (`pane-owner-replacement.ts:30-33`) and then stops the id.

```ts
export async function resolveRuntimeClaudeAuth(ctx: {
  args: { claudeAccountId?: string }
  deps: { prepareClaudeAuth?: ... }
  codexSelectionTarget: ...
}): Promise<ClaudeRuntimeAuthPreparation | null>
```

`spawn-claude-auth.ts:13`. A set `claudeAccountId` calls `getClaudeProfileRouter().prepareLaunchFor(accountId)`. Otherwise it calls `deps.prepareClaudeAuth`.

```ts
export function applyRuntimeClaudeAuthEnv(
  env: Record<string, string> | undefined,
  auth: ClaudeRuntimeAuthPreparation | null,
  pinnedToAccount: boolean
): Record<string, string> | undefined
```

`spawn-claude-auth.ts:37`. When pinned, it deletes `CLAUDE_PROFILE_POINTER_ENV`, `CLAUDE_INJECTED_CONFIG_DIR_ENV`, and `CLAUDE_CONFIG_DIR` before spreading `auth.envPatch`.

```ts
export function resolveRuntimeHostSessionBinding(deps, args): hostSessionBinding | undefined
```

`spawn-host-binding.ts:9`. Throws `Cannot persist runtime PTY binding without worktreeId, tabId, and leafId` when persist was requested without those ids.

Contract fields at `9fc769ba56:src/main/runtime/runtime-pty-controller-contract.ts:85-88`:

```ts
replacesPtyId?: string
claudeAccountId?: string
```

`getPtyController(): RuntimePtyController | null` is `9fc769ba56:src/main/runtime/construction/runtime-identity-state.ts:388`.

### Task 1's record call moves with the shared publication

At `9fc769ba56` we recorded in both commit files:

- `src/main/ipc/pty/ipc/spawn-commit.ts:135`
- `src/main/ipc/pty/runtime/spawn-commit.ts:233`

```ts
export function recordClaudePaneAccountForSpawn(args: {
  ptyId: string
  paneKey: string | null
  isClaudeLaunch: boolean
  isReattach: boolean
  claudeAuth: ClaudeRuntimeAuthPreparation | null
  settings: ClaudePaneAccountSettings | undefined
  target: ClaudeAccountSelectionTarget
  now?: number
}): void
```

`9fc769ba56:src/main/ipc/pty/host-env/claude-pane-account.ts:48`.

At `v1.4.243` those two commit files both go through `publishCommittedPtySpawn`. The Codex twin is the call at `spawn-commit-publication.ts:44`, defined as `recordCodexPaneAccountForSpawn` in `src/main/ipc/pty/host-env/codex-home.ts:197`. Our Claude call belongs in that same function, after `rememberPaneKeyForPty`, because the record comment says the stored pane key must equal `ptyPaneKey`.

Forget stays beside Codex. At `v1.4.243`, `forgetCodexPaneAccount(id)` is `src/main/ipc/pty/provider/state-cleanup.ts:37`.

Selected-account `prepareClaudeAuth` stays in `prepareRuntimePtySpawn` (lines 84-87) and the IPC preflight (lines 95-98). A chosen account is the `replace` callback, not a second preflight.

### The branch tip already applied this re-fit

`ca700d5a02` (not pure upstream) already does the following. Treat it as the current fork shape, and review it, rather than porting `9fc769ba56` again.

- `spawn-commit-publication.ts:87` calls `recordClaudePaneAccountForSpawn` after `rememberPaneKeyForPty` (line 86). Codex record stays at line 45.
- `state-cleanup.ts:39` calls `forgetClaudePaneAccount(id)`.
- `runtime/spawn.ts:75-92` passes `replace` only when `args.replacesPtyId !== undefined`. Inside it, a Claude launch with `claudeAccountId` calls `resolveRuntimeClaudeAuth` before `beginRuntimePaneReplacement`. `facts()` passes `replacedPaneOwner` (line 54).
- `beginRuntimePaneReplacement` takes `reservation?: PaneSpawnReservation` and uses `args.reservation ?? (await reserveIdlePaneSpawn(...))` (`spawn-replacement.ts:45` and `:57`). The spawn passes `reservation: ctx.paneSpawnReservation ?? undefined` (line 88), which is the reservation `runPtySpawn` already took.
- `runtime/spawn-commit.ts:78-80` chooses `terminal_pane_owner_changed` when `ctx.replacedPaneOwner` is set.
- `runtime/spawn-state.ts:45` has `replacedPaneOwner`. Args lines 146-147 have `replacesPtyId` and `claudeAccountId`.
- The contract has both fields (`runtime-pty-controller-contract.ts:96` and `:98`). `getPtyController()` is back at `runtime-identity-state.ts:387`.
- Preflight still calls `resolveRuntimeClaudeAuth` and `applyRuntimeClaudeAuthEnv` (`spawn-preflight.ts:86` and `:92`).

## 2. Account-switch restarts

Spec §1 says the restart after a switch was renderer-only and desktop-only. That is still true for the account-switch PRs. Two other PRs in the list are main-process resume of a recorded session into a new pane. They do not implement spec §3.4.

| PR | SHA | Where the change is | What it does |
|---|---|---|---|
| #31945 | `d8aeb1f984` | Renderer `agent-account-restart-startup.ts` and `claude-session-account-move.ts`. No `src/main` file. | Restart WSL Claude panes after a switch. |
| #33659 | `b7a6570e04` | Same renderer startup file. No `src/main` file. | The restart uses the tab's `startupCwd`. Comment at `agent-account-restart-startup.ts:104`: "Both restart executors spawn in the tab's start folder." |
| #33793 | `916c6a09b5` | Restart executor stays in the renderer (`claude-account-switch-sessions.ts`, `claude-session-account-move.ts`, new `claude-pane-account-folder.ts`). Main touch is `src/main/claude-accounts/claude-account-selection.ts`: the folder summary gains `systemDefaultHome` and `home`. | System default sessions are classified on the outgoing login. The restart action is still the renderer. |
| #34403 | `5a0bf8ae6e` | Renderer `pty-connection/connect-pane-pty.ts` and `fresh-spawn-start.ts`, plus tests. No `src/main` file. | Hidden Claude pane restarts stay out of the live cap. |
| #31994 | `72864c1844` | Renderer detached-pane restart scheduler, slots, and pty release. No `src/main` file. | Independent hidden account restarts can proceed. |
| #34214 | `c5f48b5cd3` | Renderer `agent-account-restart-startup.ts` only. | Restart metadata is scoped to its execution host. |
| #30328 | `a0672840b1` | Renderer `claude-account-switch-sessions.ts` and `claude-session-account-move.ts`, plus shared `agent-node-entrypoint-identities.ts`. | A user's node or python program is left alone. Classification stays in the renderer. |
| #31718 | `0a8c7680be` | Main `src/main/runtime/session-lifecycle/projection/` (`resume-agent-session-in-workspace.ts`, `agent-session-resume-claims.ts`, `agent-session-resume-ownership.ts`). | Targeted resume of a recorded agent session into a fresh pane, sharing an in-flight claim with pane resume. |
| #32120 | `f0450469e4` | Same projection files, plus `src/main/agent-hooks/agent-hook-runtime-deps.ts`. | The resume claim ends when the hook store reports the session, not at the next claim. |

### The function that restarts a Claude pane after a switch

It is still the renderer.

```ts
export function resolveAgentAccountRestartResumeStartup(
  agent: AccountRestartAgent,
  args: AccountRestartPane
): AgentAccountRestartStartup | null
```

`v1.4.243:src/renderer/src/lib/agent-account-restart-startup.ts:49`. It calls `buildAgentResumeStartupPlan` (line 82) with the pane's recorded provider session. Line 53: a hand-started Claude must not come back with configured defaults. Lines 70-76 return null for a Codex WSL resume ("a WSL Claude resume reads the guest's selected-account pointer at launch"). Lines 105-110 set `launchCwd` from the tab `startupCwd`. The return value includes `resumeProviderSession` (line 122). Comment at line 121: "Main repins launch home only when the spawn names its resumed session."

```ts
export function buildPaneAccountRestartStartup(
  agent: AccountRestartAgent,
  args: AccountRestartPane
): AgentAccountRestartStartup | null
```

Line 127. Comment at line 126: Claude requires its recorded conversation. Codex may fall through to a fresh `buildCodexAccountRestartStartup`.

```ts
export async function handleRunningClaudeSessionsAfterSwitch(args: {
  owner: RuntimeClientTarget
  target: CodexAccountSelectionTarget
  before: ClaudeAccountSnapshot
  after: ClaudeAccountSnapshot
}): Promise<'show-confirmation' | 'handled'>
```

`v1.4.243:src/renderer/src/lib/claude-account-switch-sessions.ts:98`. Line 107 returns `'show-confirmation'` when `args.owner.kind !== 'local'` or the two launch account ids are equal. Comment at line 106: "a server's switch, or one between coinciding launch folders, moves nothing here." Comment at line 114: "an accepted restart relaunches on whatever is selected when it runs." Policy `'restart'` calls `queueClaudeRestarts` of `found.onAccount` pty ids (line 176).

That queue ends in the renderer IPC spawn, which sets `replacesPtyId`. Call sites at `v1.4.243` include `codex-detached-pane-restart.ts` and the pty spawn request builder. They do not call `RuntimePtyController.spawn` and they do not pass `claudeAccountId`. The new process runs as the selected account, because main's preflight calls `prepareClaudeAuth(ctx.codexSelectionTarget)`.

### Main-process resume is a new pane, not a replacement

```ts
async resumeAgentSessionInWorkspace(
  worktreeId: string,
  request: {
    agent: TuiAgent
    providerSession: AgentProviderSessionMetadata
    captureHostId: ExecutionHostId
    mutationId: string
    signal?: AbortSignal
  }
): Promise<AgentSessionResumeResult>
```

`v1.4.243:src/main/runtime/session-lifecycle/projection/resume-agent-session-in-workspace.ts:36`. Comment at line 35: "Resume the recorded conversation into a fresh bound pane or refuse; never substitute a plain shell or fresh agent." Lines 52-56 mint a new `tabId` and `leafId` from `mutationId`. Line 58 claims through `agentSessionResumeClaims.claim`. A grep of this file finds no `claudeAccountId`, no `replacesPtyId`, and no `buildAgentResumeStartupPlan`.

`AgentSessionResumeClaims` is `agent-session-resume-claims.ts:34`. Comment at line 12: the hold lasts "from the decision until the hook store covers it." Lines 73-78 end the hold when `reportCoversHold` is true. That is `#32120`.

`create` in `terminal-create.ts` calls `dependencies.spawnInAdmittedPane` (line 119) with `resumeProviderSession` (line 135) and no `replacesPtyId` or `claudeAccountId` in the payload through line 175.

### Does any of this already do spec §3.4?

No. Spec §3.4 spawns a replacement PTY in the same pane, on a chosen account, with the conversation resumed, and stops the old process only after the new spawn is accepted.

The renderer restart resumes on the newly selected account, on a local desktop, through IPC `replacesPtyId`. A server owner returns before any restart (`claude-account-switch-sessions.ts:107`). It never names a non-selected account.

`resumeAgentSessionInWorkspace` resumes into a new pane on the host that reported the hook row. It does not take an account id and it does not replace a pty id.

Task 6 should not call `resumeAgentSessionInWorkspace`. It should spawn through the runtime adapter's `replace` callback (section 1) and build the command with `buildAgentResumeStartupPlan` (`src/shared/tui-agent-resume-startup.ts:20`), which already calls `getAgentResumeArgv`. Claude's argv is `['claude', ...optional effort, '--resume', id]` when `providerSession.key === 'session_id'` (`src/shared/agent-resume-argv.ts:13-20`). The provider session still comes from `agentHookServer.getProviderSessionIdentities()` (`server-listeners.ts:220`), as the spec says.

## 3. Usage and rate limits

`ingestLiveClaudeRateLimits` did not move. It is still `src/main/rate-limits/service/service-fetch-policy.ts:109`.

```ts
ingestLiveClaudeRateLimits(event: ClaudeStatusLineRateLimits): void {
  const snapshot = this.lastClaudeAuthSnapshot
  if (!snapshot) {
    // dropped live Claude usage: no auth snapshot yet
    return
  }
  if (normalizeClaudeConfigDir(event.configDir) !== snapshot.configDir) {
    // dropped live Claude usage: configDir mismatch
    return
  }
  // keepIfNewer via isStaleClaudeUsageWindow, then updateState on this.state.claude
}
```

Lines 109-125 are the drop. Comment at line 110: "Wait for a selected-account snapshot rather than guessing live-post attribution." Comment at line 118: "Different accounts/runtimes report their own quota; never merge them into this bar." A non-selected managed account is still dropped. `inactiveClaudeCache` exists at `service-state.ts:116` and this function does not write it. Task 2 is not superseded.

`#32249` is `18adb179b7` ("Keep Claude weekly usage from jumping back to an idle session's old value"). It added `keepIfNewer` at lines 128-137: an incoming window that `isStaleClaudeUsageWindow` rejects is ignored, and an identical window keeps the current object. Task 2 must keep that guard inside the selected-account branch.

`#29759` has no commit in this clone. `git log --all --grep=29759` is empty. The "keep OAuth credits through a statusline post" behavior is older than this range: at `v1.4.235` the same function already assigned `fableWeekly: previous?.fableWeekly ?? null` (then line 152). At `v1.4.243` that assignment is line 176, with the comment on line 175: "Statusline lacks Fable scope; retain the latest OAuth value." Blame on line 176 is `1bd308bd84` (`#33542`). Blame on the comment is `7d6603aa17` (`#33249`, comment audit). Which SHA is `#29759` is unknown.

`#33542` is `1bd308bd84`. An idle Claude account whose access token lapsed reads as waiting, not signed out. It edits fetch policy, result policy, and the status bar. It does not route a foreign `configDir` into `inactiveClaudeCache`.

`#32945` is `da620ad632` ("remove unreachable setPollingInterval and refreshMiniMax IPC"). A grep of `src/main/ipc/**/*.ts` and `src/main/runtime/rpc/**/*.ts` at `v1.4.243` finds no `setPollingInterval`. The method remains on the service at `src/main/rate-limits/service/service-polling.ts:16`. Task 9 should call `rateLimits.start()` and should not revive that IPC.

`#20842` is `037cf27429` ("show live usage on the active account row, including System default"). The subject is Codex. It is not Claude statusline routing.

### orcad still does not start the poller

`createOrcadAccountServices` is `src/main/orcad/orcad-account-services.ts:48`. Line 68: "Refresh usage on demand through list/subscribe rather than starting a background poller." The cleanup at line 70 calls `services.rateLimits.stop()`. A WSL orcad process returns null at lines 61-62. `prepareClaudeAuth` at lines 78-79 is `prepareForClaudeLaunch(target)` (the selected target).

The desktop window does start polling: `src/main/startup/main-window-core-services.ts:155` is `rateLimits.start({ fetchImmediately: false })`.

Spec §1 row 3 still holds. Task 9 is not done upstream.

## 4. Layout groundwork (switched off)

The four named commits, all with the subject prefix "Layout groundwork (switched off)":

- `ce71535bbf` `#31258`: main starts every split and new pane, the window only attaches.
- `ed13ca1e6f` `#31567`: main starts and restores every pane, the window only attaches and paints history. This commit touches `spawn-begin.ts`, `spawn-execute.ts`, and `spawn-run.ts`.
- `4165c9545c` `#31908`: main tells the window whether its start resumed a pane's agent. This adds `resumeOutcomeOf` / `reportRuntimeResumeOutcome` and `onResumeOutcome` on the contract.
- `7cabd3a8dc` `#32002`: every question about which pane holds a terminal asks main's layout.

The switch is `src/shared/layout-owner-switch.ts`:

```ts
// Off in shipped builds; remove with the old path in phase F.
declare const ORCA_LAYOUT_OWNER: 'window' | 'main' | undefined
export const ORCA_LAYOUT_OWNER_IS_MAIN =
  typeof ORCA_LAYOUT_OWNER !== 'undefined' && ORCA_LAYOUT_OWNER === 'main'
```

`config/dark-build-switches.cjs:4-8` lists `{ variable: 'ORCA_LAYOUT_OWNER', off: 'window' }`. Comment at line 4: "Only main-valued switches compile dark paths; marked main/mobile-web/orcad/template outputs cannot ship." `darkBuildDefines` stringifies `'main'` only when the env var is `'main'` (lines 21-28). An absent define reads as off. Shipped builds keep the window as the starter.

When the switch is off, a pane's PTY still starts in the renderer, and the only `replacesPtyId` implementation is `runPtyIpcSpawn`.

When the switch is on, main starts panes through `RuntimePtyController.spawn`. `terminal-create.ts:40-41` takes `this.ptyController` and returns early without `spawn`. The payload at lines 119-175 includes `resumeProviderSession`, `connectionId`, `worktreeId`, `tabId`, `leafId`, and `BACKGROUND_TERMINAL_SPAWN_FLAGS`. It does not include `replacesPtyId` or `claudeAccountId`.

Restored panes share one main-owned start. The file moved to `src/main/runtime/terminal/recovery/restored-pane-start.ts`. Line 1: "Share one main-owned restored-pane start across CLI, mobile and orchestration triggers." `restoredPaneStartPlan` (line 39) returns `{ sessionId: boundPtyId }` or `{}`. `RestoredPaneStarter.ensureStarted` is line 56. Comment on the port at line 30: "Starts the pane in place, resuming its recorded agent." That is "resume this pane's own agent," not "replace this PTY on a chosen account."

`reportRuntimeResumeOutcome` (`spawn-commit-response.ts:24-29`) calls `onResumeOutcome` only when the switch is on. `resumeOutcomeOf` (line 11) returns `'resume-unavailable'` or `'restored'` or null. A mover that spawns with `resumeProviderSession` on a layout-owner build will publish that outcome. On a shipped build the call is a no-op.

What the mover must respect:

- Ship the runtime `replace` callback even though shipped builds start panes in the renderer. A layout-owner build starts them in `spawnPtyFromRuntimeController`, which at `v1.4.243` cannot replace a pane.
- Use the reservation `runPtySpawn` already takes, so a mover does not race `RestoredPaneStarter` or a layout-owner create for the same pane.
- Keep the renderer restart flow untouched (spec §3.7). It still owns IPC `replacesPtyId` for the selected-account case.

The switch does not change the default product. Packaging rejects an enabled `ORCA_LAYOUT_OWNER`.

## 5. Verdict table

| Task | Verdict | Why |
|---|---|---|
| 1. Registry and record at spawn | re-fit onto `publishCommittedPtySpawn` | Both old commit files now publish in `spawn-commit-publication.ts`. Codex is recorded at line 44. Forget stays beside `forgetCodexPaneAccount` at `state-cleanup.ts:37`. The tip already calls our recorder at line 87. |
| 2. Live usage routing | re-fit onto `ingestLiveClaudeRateLimits` | The function is still `service-fetch-policy.ts:109` and still returns on `configDir` mismatch at lines 118-124. Keep `keepIfNewer` from `#32249` (lines 128-137) and the `fableWeekly` retain at line 176. |
| 3. `launchEnvFor(accountId)` | unchanged | `launchEnvFor` and `prepareLaunchFor` have no matches at `v1.4.243`. Chosen-account env is still our code. |
| 4. Runtime `replacesPtyId` and `claudeAccountId` | re-fit onto `runPtySpawn`'s `replace` | `407069bc63` deleted the runtime `spawn-execute.ts` home. The runtime adapter at `runtime/spawn.ts:15` has no `replace` and the contract has no `claudeAccountId`. The shared swap in `savePtySpawnPaneBinding` is the commit seam. The tip `ca700d5a02` already passes `replace`, the existing reservation, and the owner-changed refusal. Review that merge. |
| 5. `claudeSessionMover` setting | unchanged | No `claudeSessionMover` match at `v1.4.243`. `claudeAccountSwitchRunningSessions` is still `'ask' \| 'restart' \| 'keep'` in `src/shared/claude-account-switch-settings.ts`. The range only deleted the file's leading comment. |
| 6. `MoveStrategy.resume` | re-fit onto the Task 4 runtime `replace` seam | The renderer restart and `resumeAgentSessionInWorkspace` (`#31718`) do not spawn a same-pane replacement on a chosen account. Build the command with `buildAgentResumeStartupPlan` and spawn through the runtime adapter. Do not call `resumeAgentSessionInWorkspace`. |
| 7. `ClaudeSessionMover` service | unchanged | `subscribeStatusChanges` is still `server-listeners.ts:122` and `getProviderSessionIdentities` is still line 220. `AgentStatusState` still includes `'done'` (`agent-status-types.ts:50`). Resume claims (`#31718`, `#32120`) are a different hold on a new pane. |
| 8. RPC, CLI, Settings row | unchanged | No session-mover RPC or CLI exists upstream. Settings keys added in the range are unrelated (section 6). |
| 9. orcad starts polling | unchanged | `orcad-account-services.ts:68-70` still refreshes on demand and only calls `stop()`. Desktop already starts at `main-window-core-services.ts:155`. Call `rateLimits.start()` directly. `#32945` removed the IPC, and `setPollingInterval` remains a service method (`service-polling.ts:16`). |
| 10. Suites, typecheck, lint, signed build | unchanged | The gate is the same. The plan's version stamp `1.4.233-blowzer.1` is behind the new base `v1.4.243`. Pick the stamp when cutting the build. |
| 11. Studio then MacBook rehearsal | unchanged | Headless proof is still the point. Account-switch restart stays local-renderer (`claude-account-switch-sessions.ts:107`) and orcad still does not poll. |

## 6. Other changes a mover author should know

### Hook status

`AgentHookServer` is still `src/main/agent-hooks/server.ts:28` (`export class AgentHookServer extends AgentHookServerAgentPresence`) and the singleton `agentHookServer` is line 30. The class is split across `server/*.ts`. The methods the spec names did not move:

```ts
subscribeStatusChanges(listener: (statuses: AgentHookStatusChangeEntry[]) => void): () => void
```

`server-listeners.ts:122`.

```ts
getProviderSessionIdentities(): AgentHookProviderSessionIdentity[]
```

`server-listeners.ts:220`. The comment says "Include metadata-only provider identities."

```ts
export type AgentHookStatusChangeEntry = {
  paneKey: string
  state: AgentStatusState
  receivedAt: number
  observedInCurrentRuntime: boolean
}
```

`server-types.ts:61`.

```ts
export type AgentHookProviderSessionIdentity = {
  paneKey: string
  sessionId: string
  transcriptPath?: string
  worktreeId?: string
}
```

`server-types.ts:73`. Transcript inference in spec §3.1 still has `transcriptPath` here.

```ts
export const AGENT_STATUS_STATES = ['working', 'blocked', 'waiting', 'done'] as const
```

`src/shared/agent-status-types.ts:50`.

There is a second listener, `subscribeStatusFreshness` (`server-listeners.ts:130`). The mover's "wait until `done`" decision still belongs on `subscribeStatusChanges`. Freshness renews a lease and is not a turn boundary.

Child-agent work in this range can keep a row out of `done` while helpers finish, or can stop a nested agent from stealing the parent:

- `589499e3bd` `#31780`: a nested `claude -p` no longer takes over its parent pane's status.
- `9639426abe` `#33645`: an Antigravity subagent finishing no longer ends its parent's turn.
- `d5ee28d716` `#33738`: a Pi row stays working while a pi-subagents child outlives the parent's done.
- `52f4db7196` `#34128`: an Antigravity run stays working while its helper agents finish.
- `a944e37a62` `#33572`: a pane's owner can reclaim it from a nested agent's hooks.
- `2990d274c9` `#33605`: follow Claude sessions continued into a daemon job.

Task 7's `done` check should keep reading the pane's own status entry. A parent that is `working` because a child is running is still mid-turn. That matches spec §3.3 step 4.

`setClaudeStatusLineListener` is still on the hook server (`server-listeners.ts:116`). Comment at line 115: "Claude statusline carries usage windows for RateLimitService, not agent status." orcad already passes that listener into `createProviderAccountServices` (`orcad-account-services.ts:65-67`). Task 2's routing change is inside `ingestLiveClaudeRateLimits`, which that listener already calls. No new hook wiring is required for live posts on orcad.

### Resume claims and `claude --resume`

`#31718` / `#32120` added `AgentSessionResumeClaims`. A hold is one conversation into one pane until the hook store reports it (`agent-session-resume-claims.ts:12` and `:73-78`). The mover's in-flight mark (spec §3.3 cooldown) is a different object. Sharing the claim class would also share its "fresh pane" identity (`resume-agent-session-in-workspace.ts:52-56`).

`8a001a93c4` `#34054`: a restored host pane resumes its agent from the hook store and does not replay the launch. New helper `hook-row-pane-resume-record.ts` under the same projection directory. This is restore, not an account move.

`4af4bc1a03` `#33527`: resume an agent from the folder it ran in, not the pane's start folder. `AgentProviderSessionMetadata` gained the run folder (`agent-session-resume.ts` around the comment at line 46: "Folder the agent ran in; resume runs there, not the pane's start folder"). `buildAgentResumeStartupPlan` already takes `launchCwd` (`tui-agent-resume-startup.ts:36`). Task 6's "target folder is applied by preflight" still has to agree with this recorded folder or the resume will start in the old account's folder.

`a1da3c0a3b` `#33765`: resume Claude sessions at their own effort level. `getAgentResumeArgv` inserts `--effort` before `--resume` when `providerSession.effort` is set (`agent-resume-argv.ts:16-19`). A hand-built `claude --resume <id>` that drops `effort` will not match upstream. Call `getAgentResumeArgv` or `buildAgentResumeStartupPlan`.

Claude still resumes by session id, not by transcript path. `agent-session-resume.ts:44` says "Prefer hook-reported transcript paths: recent Claude filenames differ from session_id. Claude/Codex still resume by ID." The registry's transcript fallback (spec §3.1) is for guessing the account, not for the resume argv.

`#33659` and the renderer restart put the shell in the tab start folder (`agent-account-restart-startup.ts:104-110`). `#33527` says the agent itself is resumed from its recorded folder. Task 6 should pass both and let `buildAgentResumeStartupPlan` decide, the way the renderer restart already does.

### Codex pane account registry

`src/main/codex/codex-pane-account-registry.ts` still exports the same functions: `recordCodexPaneAccount`, `forgetCodexPaneAccount`, `getCodexPaneAccount`, the legacy-home predicates, and `reconcileCodexPaneAccountsWithLivePtys`. Between the tags the file shrank (`git diff --stat` is 63 lines removed, mostly comments). The spawn-time record moved to `recordCodexPaneAccountForSpawn` in `host-env/codex-home.ts:197`, called only from `publishCommittedPtySpawn`. Reattach returns early (lines 206-208) so a reattach does not overwrite the account the launch recorded. Our Claude recorder has the same reattach rule (`claude-pane-account.ts:60-62` at `9fc769ba56`).

No Claude registry exists upstream. Codex remains out of scope (spec non-goal).

### Settings vocabulary

`src/shared/claude-account-switch-settings.ts` at `v1.4.243`:

```ts
export type ClaudeAccountSwitchRunningSessions = 'ask' | 'restart' | 'keep'
export type ClaudeAccountSwitchSettings = {
  /** Absent means 'ask'. */
  claudeAccountSwitchRunningSessions?: ClaudeAccountSwitchRunningSessions
}
```

The only range diff is deletion of the old leading comment (`git diff v1.4.235 v1.4.243`).

New fields on `src/shared/global-settings-types.ts` in the range include `uiLanguagePortugueseMigrationApplied`, `orchestrationChatErrorEscalationEnabled`, `browserProfileScope`, and `telemetry`. Related commits: `a53c2a2a72` `#31784` (onboarding language), `ae64a215a3` `#31627` (Brazilian Portuguese), `846851237c` `#32039` (browser profile scope), `23798eff7c` `#32334` (chats follow the agent permission setting), `ca8eb2904e` `#34070` and `01db1c6326` `#34071` (worker heartbeat off switch and interval), `295ed991dd` `#34356` (grouped native-chat session options). None of these is `claudeSessionMover`. Task 5 still adds that field beside `claudeAccountSwitchRunningSessions`. Task 8's `en.json` row can collide with the i18n edits in `#33793` and the locale files that commit touched. Spec §8 already expected `en.json` conflicts.

### One more restore/resume fact

`b94ad9870e` `#33380` does not resume an agent whose spawned PTY is still live. A mover that replaces a live pane must go through `replacesPtyId` so the old owner is stopped under the reservation. Calling a plain resume while the old PTY is alive hits this guard.

`82a3214049` `#33598` reopens a slept agent whose tab is gone into a fresh tab. That is the fresh-pane path again, not an in-place move.
