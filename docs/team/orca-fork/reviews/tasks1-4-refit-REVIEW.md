# Review: session mover Tasks 1–4 on v1.4.243

Range `a880c7b912..6e60fc18ac` (mover delta on upstream v1.4.243 plus the auto-switch fork). Read at `6e60fc18ac`. Tasks 5–11 are out of scope. This review did not re-run the suites. The implementer's report claims the runtime, PTY, and updater runs; that claim is not re-checked here.

Line numbers are the file at `6e60fc18ac`.

## Spec compliance

### Task 1 registry and spawn record

| Requirement | Where | Verdict |
|---|---|---|
| File `claude-pane-account-registry.ts` | `src/main/claude-accounts/claude-pane-account-registry.ts` (96 lines) | ✅ |
| `ClaudePaneAccountSource` `'spawn' \| 'transcript'` | `claude-pane-account-registry.ts:12` | ✅ |
| `ClaudePaneAccountRecord` fields `ptyId`, `paneKey`, `accountId`, `configDir`, `launchedAt`, `pinned`, `source` | `claude-pane-account-registry.ts:14-22` | ✅ |
| `recordClaudePaneAccount` | `claude-pane-account-registry.ts:35` | ✅ |
| `forgetClaudePaneAccount` | `claude-pane-account-registry.ts:39` | ✅ |
| `getClaudePaneAccount` | `claude-pane-account-registry.ts:43` | ✅ |
| `listClaudePaneAccounts` | `claude-pane-account-registry.ts:47` | ✅ |
| `listClaudePaneAccountsByAccount` (plan name, not `listByAccount`) | `claude-pane-account-registry.ts:51` | ✅ |
| `ClaudeAccountHomes` | `claude-pane-account-registry.ts:55` | ✅ |
| `inferClaudeAccountIdFromTranscript` returns `{accountId, configDir}` or null, and undefined when the path is not a transcript; Windows compare is case-folded | `claude-pane-account-registry.ts:60` and `:70` | ✅ |
| `_internals` | `claude-pane-account-registry.ts:92` | ✅ |
| Spawn records are `pinned: false`, `source: 'spawn'` | `claude-pane-account.ts:76-86` | ✅ |
| Reattach does not overwrite | `claude-pane-account.ts:60-62` | ✅ |
| Non-Claude or unnameable provenance forgets | `claude-pane-account.ts:64-72` | ✅ |
| Test: records, lists, and forgets | `claude-pane-account-registry.test.ts:30` | ✅ |
| Test: re-recording replaces the row | `claude-pane-account-registry.test.ts:51` | ✅ |
| Test: infers from the transcript path | `claude-pane-account-registry.test.ts:58` | ✅ |
| Extra test: trailing slashes on the home and the transcript folder | `claude-pane-account-registry.test.ts:81` | ✅ |
| `recordClaudePaneAccountForSpawn` and `claudeAccountIdFromProvenance` | `claude-pane-account.ts:19` and `:49` | ✅ |
| `profile:<id>` names that account; `unavailable` / empty / `undefined` / `null` name none | `claude-pane-account.ts:23-28` | ✅ |
| Provenance `system` and `wsl:<distro>:system` record the selected account | `claude-pane-account.ts:29-32` | ✅ against the plan's mapper. See Correctness: a named covered account also uses `system`, and that row is the wrong account. |
| Test: maps provenance to the account | `claude-pane-account.test.ts:46` | ✅ |
| Test: routed launch is unpinned | `claude-pane-account.test.ts:77` | ✅ |
| Test: reattach left alone; a reused id that is not Claude is forgotten | `claude-pane-account.test.ts:90` | ✅ |
| Extra test: empty `configDir` stored as unknown | `claude-pane-account.test.ts:98` | ✅ |
| Test: a launch whose account cannot be named is forgotten | `claude-pane-account.test.ts:103` | ✅ |
| Record after the pane key is remembered, on both lanes | `spawn-commit-publication.ts:86-95`. Both lanes call `commitPtySpawn`: `ipc/spawn-commit.ts:23`, `runtime/spawn-commit.ts:18`. Publish is `spawn-commit-assembly.ts:190`. | ✅ Declared move off the old per-lane commit files. The survey says this is the right seam. |
| Forget beside the Codex forget, skipped when owners are preserved | `state-cleanup.ts:35-39`. Reconnect preserve is `state-cleanup.ts:109`. | ✅ |
| `inferClaudeAccountIdFromTranscript` has a production caller | No caller in this range. The plan's Task 1 delivers the function. Task 7 records inferred rows. | ✅ for Task 1. The hook is out of scope, not missing. |

### Task 2 live usage

| Requirement | Where | Verdict |
|---|---|---|
| Resolver runs before the selected path; a throw is swallowed and the selected feed still runs | `service-fetch-policy.ts:112-120` | ✅ |
| Inactive managed account is stored and the function returns | `service-fetch-policy.ts:121-128` | ✅ |
| A post with neither window is dropped | `service-fetch-policy.ts:217-219` | ✅ |
| A missing window is kept from the previous entry | `service-fetch-policy.ts:223-224` | ✅ |
| Same values inside `LIVE_CLAUDE_INGEST_DEDUPE_MS` are ignored | `service-fetch-policy.ts:225-232` | ✅ |
| `fableWeekly` retained on the inactive entry | `service-fetch-policy.ts:238` | ✅ |
| Selected path still uses `keepIfNewer` and retains `fableWeekly` | `service-fetch-policy.ts:150-162` and `:197` | ✅ The survey's "keep the guard" sentence is this branch. |
| Unknown folder still dropped | `service-fetch-policy.ts:140-145` after a resolver miss | ✅ |
| Setter `setLiveClaudeAccountResolver` | `service-configuration.ts` (field on `service-state.ts`) | ✅ |
| Wiring answers from `accountHome`, skips a `describe` throw, returns null when none match | `provider-account-services.ts:173-188` | ✅ |
| Test: non-selected post lands in that account | `service-live-claude-usage-routing.test.ts:90` | ✅ |
| Test: keeps an uncarried window and ignores a same-value repeat | `service-live-claude-usage-routing.test.ts:110` | ✅ |
| Test: unknown folder dropped | `service-live-claude-usage-routing.test.ts:143` | ✅ |
| Test: selected post stays on the bar | `service-live-claude-usage-routing.test.ts:155` | ✅ |
| Test: neither window ignored | `service-live-claude-usage-routing.test.ts:182` | ✅ |
| Test: throwing resolver drops the post and does not throw | `service-live-claude-usage-routing.test.ts:193` | ✅ |
| Test file path in the plan table, not under `service/` | `src/main/rate-limits/service-live-claude-usage-routing.test.ts` | ✅ |

### Task 3 chosen-account launch

| Requirement | Where | Verdict |
|---|---|---|
| `ChosenAccountRouting` and `chosenAccountLaunchEnv` / `chosenAccountPreparation` / `prepareChosenAccountLaunch` | `claude-profile-chosen-account.ts:16` and `:71`, `:79`, `:104` | ✅ |
| Router methods are one-line delegates | `claude-profile-router.ts:253`, `:261`, `:266`. Private `chosen` object `:236-245`. | ✅ |
| `prepareForClaudeLaunchOnAccount` delegates to `prepareLaunchFor` | `runtime-auth-service.ts:57-58` | ✅ |
| Bare `CLAUDE_CONFIG_DIR` for an uncovered account. No pointer, no injected marker. | `claude-profile-chosen-account.ts:53-56` | ✅ |
| Covered account env is `{}` or the user's own literal `CLAUDE_CONFIG_DIR`; provenance `system`; `configDir` is `systemDefaultHome()` | `claude-profile-chosen-account.ts:48-51` and `:94-99` | ✅ |
| Missing folder throws `claudeProfileMissing` | `claude-profile-chosen-account.ts:54-56`. Reason `claudeAccountFolderMissing` at `claude-profile-launch-errors.ts:12-14`. | ✅ |
| Unknown id throws before setup | `claude-profile-chosen-account.ts:33-37`. Factory `claude-profile-launch-errors.ts:24-26`. Message `claude-profile-routing.ts:17`. | ✅ |
| WSL account throws before setup | `claude-profile-chosen-account.ts` `assertKnownHostAccount`. Factory `claude-profile-launch-errors.ts:30-32`. Message `claude-profile-routing.ts:20`. | ✅ |
| One coverage read per public call, reused for the preparation | `claude-profile-chosen-account.ts:76`, `:84`, `:114-118` | ✅ |
| Setup only when not covered; `envReady` only without an own login | `claude-profile-chosen-account.ts:111-117` | ✅ |
| Setup queue `run` / `runInBackground` / `settle` / `runForLaunch`; first setup failure throws; later refresh capped | `claude-profile-setup-queue.ts` (97 lines) | ✅ |
| `claudeAccountUsagePreparation` and `systemDefaultRunsAnotherAccount` extracted | `claude-profile-system-default-comparison.ts` (43 lines) | ✅ |
| Both new reasons are in the failure kinds and the reason words | `agent-session-failure.ts` additions; `agent-session-refusal-reason-words.ts` `actFirst` | ✅ |
| User copy for both reasons | `src/renderer/src/i18n/locales/en.json` (es, fr, ja, ko, zh and `en-runtime-required.json` in the same diff) | ✅ |
| Test: bare folder, no pointer or marker | `claude-profile-router-launch-env-for.test.ts:136` | ✅ |
| Test: missing folder refused | `:147` | ✅ |
| Test: unknown id before setup | `:153` | ✅ |
| Test: WSL before setup, and in `launchEnvFor` | `:168` and `:182` | ✅ |
| Test: System default passthrough | `:194` | ✅ |
| Test: restores the user's `CLAUDE_CONFIG_DIR` | `:211` | ✅ |
| Test: first setup refused | `:221` | ✅ |
| Test: refresh hang uses the last refresh | `:231` | ✅ |
| Shell-function cases | `:259` and `:288` | ✅ |
| No `max-lines` disable on the router | Router is 332 physical lines, 268 counted (blanks and comments skipped). Cap is 300. | ✅ The plan's "347 physical / 265 counted" was the pre-split shape. The extraction is the declared deviation and it holds. |

### Task 4 runtime replace

| Requirement | Where | Verdict |
|---|---|---|
| `replacesPtyId` and `claudeAccountId` on the contract | `runtime-pty-controller-contract.ts:96-98` | ✅ |
| Same fields on `RuntimePtySpawnArgs`; `replacedPaneOwner` on spawn state | `runtime/spawn-state.ts` | ✅ |
| `getPtyController()` | `runtime-identity-state.ts:387-389` | ✅ |
| `beginRuntimePaneReplacement` takes an optional reservation and reuses it | `spawn-replacement.ts:38-57`. Caller passes `ctx.paneSpawnReservation` at `spawn.ts:88`. Outer reserve is `spawn-operation.ts:84`, before `replace` at `:242`. | ✅ No second reserve on the production path. |
| Unbound pane is stopped only when `ptyPaneKey` proves the id; otherwise `terminal_pane_owner_unknown` before stop | `spawn-replacement.ts:60-70` | ✅ |
| Auth for a named Claude command runs inside `replace`, before the stop | `spawn.ts:77-83` | ✅ |
| Bad host binding throws before `runPtySpawn` | `spawn.ts:28-32`. `resolveRuntimeHostSessionBinding` returns undefined unless persist was asked (`spawn-host-binding.ts:21`) and throws when the ids are missing or `tabId.length > 512` (`:29`). | ✅ |
| `adoptedStablePane` or `agentSessionEnsure` with `replacesPtyId` throws `terminal_pane_owner_unknown` before the pipeline | `spawn.ts:34-36` | ✅ |
| `facts().replacedPaneOwner` is read at call time | `spawn.ts:44-51`. `replace` sets `ctx.replacedPaneOwner` at `spawn.ts:90` before acquire. | ✅ `runtime/spawn-execute.ts` was not reintroduced. |
| Catch releases the stopped binding and rejects the reservation | `spawn-operation.ts:263` and `:266` | ✅ |
| `applyRuntimeClaudeAuthEnv` leaves a no-auth env unchanged | `spawn-claude-auth.ts:37` | ✅ |
| Pinned launch deletes the pointer, the injected marker, and `CLAUDE_CONFIG_DIR`, then spreads the patch. User dir stays. | `spawn-claude-auth.ts:47-49` | ✅ Preflight applies it at `spawn-preflight.ts:92`. Pin assertions `spawn-preflight-requested-shell.test.ts:288-289`. |
| Preflight reuses an auth value already set | `spawn-preflight.ts:85-86` | ✅ |
| `replacementAccountId` only for a Claude launch | `runtime/spawn-commit.ts:78` | ✅ |
| Refusal is `terminal_pane_owner_changed` when a replacement is in flight, else the split message | `runtime/spawn-commit.ts:79-81` | ✅ |
| One `console.info` after a successful durable swap, exact wording `[claude-session-mover] replaced pty <old> with <new> on account <accountId> (pane <paneKey\|none>)` | `spawn-commit-binding.ts:48-57` | ✅ |
| Typed refusals rethrown; other bind errors wrapped | `spawn-commit-binding.ts:60-72` | ✅ |
| Test: owner changed, stops nothing | `spawn-replacement.test.ts:69` | ✅ |
| Test: holds, stops, reports the replacement | `:82` | ✅ |
| Test title is now "needs a pane to replace into and stops nothing without one" | `:97` | ✅ Wording change from the plan. Behavior is the plan's. |
| Test: proved unbound id is replaced | `:110` | ✅ This is addendum case (m), not a second twin. |
| Test: unproven unbound id is not stopped | `:122` | ✅ Case (m) pair. |
| Test: stopped owner is not offered for reattach | `:145` | ✅ |
| Test: swap only if the leaf still names the stopped id | `:163` | ✅ |
| Test title is now "throws the refusal that fits the spawn and rethrows either refusal as is" | `:171` | ✅ |
| Test: selected account unless the spawn names one | `spawn-claude-auth.test.ts:28` | ✅ |
| Test: no router refuses a named account; no resolver yields null | `:50` | ✅ |
| Test: no auth leaves the env untouched | `:78` | ✅ |
| Test: unpinned launch keeps the pointer and markers | `:83` | ✅ |
| Test: pinned launch drops the three keys and keeps the user dir | `:90` | ✅ |
| Test: covered account resumes on the user's folder | `:101` | ✅ |
| Test: refused swap reported as owner-changed | `spawn-commit-replacement.test.ts:49` | ✅ |
| Test: split refusal rethrown | `:57` | ✅ |
| Test: other bind failure is a save failure | `:66` | ✅ |
| End-to-end pin: only that account's `CLAUDE_CONFIG_DIR` | `spawn-preflight-requested-shell.test.ts:219-294` | ✅ |
| `runtimePaneBindingInput`, `runtimePaneBindRefusal`, `isRuntimePaneBindRefusal`, `resolveRuntimeStablePaneOwner` exist | `spawn-replacement.ts:84`, `:103`, `:111`, `:118` | ✅ Production commit inlines the refusal (`runtime/spawn-commit.ts:79-81`). Behavior matches. Quality note below. |

### Addendum cases (k)–(p)

| Case | Where | Verdict |
|---|---|---|
| (k) Chosen account launches, registry row replaced after the swap, old row gone, reservation empty | `spawn-replacement-addendum.test.ts:125` | ✅ `toMatchObject` does not prove the pointer is absent. The preflight pin test does (`spawn-preflight-requested-shell.test.ts:288-289`). |
| (l) Persist false and an invalid leaf refuse before stop or spawn; old registry identity kept; no `console.info` | `spawn-replacement-addendum.test.ts:141`. Same throws with mocked stages at `spawn-replacement-flow.test.ts:103` and `:114`. | ✅ |
| (m) Proved unbound stop, unproven unbound refusal | `spawn-replacement.test.ts:110` and `:122` | ✅ Not a new file. Matches the report. |
| (n) Unknown and WSL typed refusals do not stop or spawn; old identity kept; no info log | `spawn-replacement-addendum.test.ts:158` | ✅ |
| (n) Non-Claude `bash` with an account id does not prepare, does not record, does not log | `spawn-replacement-addendum.test.ts:176`. Order proof also at `spawn-replacement-flow.test.ts:121`. | ✅ |
| (o) Execution `EIO` rejects with that error; stop once; reservation empty; both registry rows null; no info log | `spawn-replacement-addendum.test.ts:186`. Flow twin `:142`. | ✅ The stop mock calls `clearProviderPtyState('old')` (`addendum` lines 104-106), so the old-row forget is the mock's stand-in for the exit listener. |
| (p) Exactly one `console.info` after the binding is `'new'`, exact string with the pane key | `spawn-replacement-addendum.test.ts:198` | ✅ |
| (p) Refused swap (`terminal_pane_owner_changed`, binding forced to `'successor'`) does not log and does not record the new id | `spawn-replacement-addendum.test.ts:208` | ✅ |
| `'none'` pane in the log format | `spawn-commit-binding.ts:52-54` | ✅ Unreachable for a runtime replacement: host binding requires a worktree and a valid pane (`spawn.ts:30-32`). Not a bug. |

### Seams, scope, accepted deviations

| Requirement | Where | Verdict |
|---|---|---|
| Survey: do not revive `runtime/spawn-execute.ts`; pass `replacedPaneOwner` from `facts()` | `spawn.ts:51`. The range does not add `runtime/spawn-execute.ts`. | ✅ |
| Survey: check the host binding before `runPtySpawn` when replacing | `spawn.ts:28-32` | ✅ |
| Survey: record in `publishCommittedPtySpawn` after `rememberPaneKeyForPty` | `spawn-commit-publication.ts:86-95` | ✅ |
| `spawn-commit.ts` stays at or under 300 counted lines | `runtime/spawn-commit.ts` is 84 physical lines | ✅ |
| Updater `app?.isPackaged === true` | `updater-disabled.ts` one-line diff | ✅ Declared. Packaged `true` stays true. A missing `app` in the Node updater RPC runtime is treated as not packaged. Not a mover behavior change. |
| `tabId.length > 512` now fails every runtime persist, including a plain spawn | `spawn-host-binding.ts:29` via `spawn-preflight.ts:90` | ✅ Accepted alignment with the pane-key rule. Hypothetical ids only. |
| Tasks 5–11 files absent at this commit | `claude-session-mover-policy.ts`, `claude-session-move-strategy.ts`, `claude-session-mover.ts`, `claude-usage-polling-policy.ts`, `src/cli/handlers/account-session-mover.ts`, `claude-session-mover-setting.tsx` are absent. `claudeSessionMover` is not in the settings file at this commit. | ✅ |
| Known `runtime-failed-local-worktree-removal.test.ts` failure | Not in this diff. Report says it fails the same way on `a880c7b912`. | Not a mover finding. |

## Correctness

### Important

1. A named account that System default covers is recorded as the selected account. `coveredBySystemDefault` (`claude-profile-router.ts:126-132`) is true for any saved account with no own login whose saved identity matches the system-default login. It does not require that account to be the selected one. `prepareChosenAccountLaunch` then sets provenance `system` (`claude-profile-chosen-account.ts:99` and `:114-118`). `claudeAccountIdFromProvenance` maps every `system` provenance to `getSelectedClaudeAccountIdForTarget` (`claude-pane-account.ts:31-32`). The publication call does not pass the requested id (`spawn-commit-publication.ts:87-95`).

   Failing scenario: account A is selected and has its own folder. Account B has no own login and matches the system-default login, so B is covered. A runtime replace with `claudeAccountId` B runs on the user folder (B's login) and the log names B (`runtime/spawn-commit.ts:78`, `spawn-commit-binding.ts:55-56`). The registry row's `accountId` is A. Design §3.1 says the registry is which account the live session runs on. The comment at `claude-pane-account.ts:29-31` says to record the account System default covers. The return value records the selected id instead.

   The plan's mapper text does say `system` means the selected account. That recipe was for an unpinned launch. Task 3 reused provenance `system` for a named covered account, and the mapper was not taught the requested id. The unpinned path should stay on the selected id.

   Fix: pass `claudeAccountId` into `recordClaudePaneAccountForSpawn`, and when provenance is `system` and that id is set, record that id.

### Minor

1. An inactive live post can roll a newer reading backwards. `ingestLiveInactiveClaudeRateLimits` stores `freshSession ?? previous?.session` (`service-fetch-policy.ts:223-224`) with no `keepIfNewer`. The selected path refuses an older snapshot (`service-fetch-policy.ts:149-162`). An idle older statusline on an inactive account replaces a newer poll. The plan's inactive algorithm is `fresh ?? previous`, and the survey only required `keepIfNewer` on the selected branch. Fix: use that same `keepIfNewer` before replacing an inactive window.

2. Windows case is folded in one attribution path and not the other. Transcript inference lowercases on `win32` (`claude-pane-account-registry.ts:60`). `normalizeClaudeConfigDir` keeps case (`service-types.ts:156-159`). The live resolver compares that form to `accountHome` (`provider-account-services.ts:183`). A statusline whose folder differs only by case misses the account and is dropped (`service-fetch-policy.ts:140-145`). The plan tests use exact strings, and a statusline usually echoes the env string Orca set. Fix: case-fold the resolver compare on `win32` the same way inference does.

3. The success line can print for a process that is then rejected. `savePtySpawnPaneBinding` logs after the swap (`spawn-commit-binding.ts:48-57`), which `commitPtySpawn` awaits at `spawn-commit-assembly.ts:137-138`. A following `registration-exited` return (`spawn-commit-assembly.ts:168-180`) skips `publishCommittedPtySpawn` (`:190`), so the new registry row is never written. The old row is already forgotten on the replaced process's exit (`state-cleanup.ts:35-39`). The addendum asked for the log immediately after the durable swap, which is what the code does. Fix: log only on the path that also publishes, or cancel the line when registration returns `registration-exited`.

## Quality

New production files are under the plan's about-200-line guide: registry 96, recorder 87, chosen-account 119, setup queue 97, system-default comparison 43, launch-errors 34, replacement 124, auth 52, host binding 43, `runtime/spawn-commit.ts` 84. The router is 332 physical and 268 counted, under the oxlint cap of 300, with no `max-lines` disable.

Three test files are over the plan's about-200 guide and under the test cap of 800: `claude-profile-router-launch-env-for.test.ts` 313, `spawn-replacement-addendum.test.ts` 218, `service-live-claude-usage-routing.test.ts` 210. The enforced cap is oxlint. Splitting them is not required for this range.

The diff adds no `eslint-disable`, no `max-lines` disable, no `@ts-ignore`, and no `@ts-expect-error`. The `oxlint-disable-next-line typescript/consistent-type-assertions` lines in the new tests each carry a `SAFETY:` comment. That is the cast pattern Agents.md requires. They are not the Blocker class named in this review.

`runtimePaneBindRefusal` (`spawn-replacement.ts:111-114`) is not called from production. `runtime/spawn-commit.ts:79-81` inlines the same ternary. The helper is tested. One call site would remove the copy.

`inferClaudeAccountIdFromTranscript` is pure and has no production caller in this range. Task 7 is the caller. That is the plan.

Case (k) uses `toMatchObject` on the spawn env (`spawn-replacement-addendum.test.ts:125`), so a leftover pointer would still pass. The preflight pin test asserts the pointer and the marker are absent.

The known worktree-removal failure is outside this diff. This review did not re-run vitest.

## Verdict

With fixes

0 Blockers, 1 Important, 3 Minors.

Required fix:

1. When a named account is covered by System default, pass `claudeAccountId` into `recordClaudePaneAccountForSpawn` (today `spawn-commit-publication.ts:87-95` does not receive it) and return that id from the `system` branch of `claudeAccountIdFromProvenance` (`claude-pane-account.ts:31-32`) instead of `getSelectedClaudeAccountIdForTarget`, leaving the unpinned path unchanged, and add a test where A is selected, B is covered, the replace names B, and the registry row is B.

The three Minors stay in Correctness. They do not add items to this list.
