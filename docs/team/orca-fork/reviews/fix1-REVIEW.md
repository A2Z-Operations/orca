# Review: Tasks 1–4 fix round (A1–A5)

Range `24902c029e..74ff884c04` (one commit, `74ff884c04`). Line numbers are that commit. `HEAD` is `4b52731e8b` (Task 6). Task 6 adds only the two strategy files and is out of scope. The working tree was clean.

This review re-ran the three touched test files. 3 files, 19 tests, all passed. The implementer's broader Claude-account, PTY, rate-limit, typecheck, and lint gates were not re-run.

## Spec compliance

Contract: the A1–A5 items in `tasks1-4-refit-REVIEW.md`. Plan Tasks 1–4 are cited only where this commit changes them. Declared adaptations in `fix1-task6-REPORT.md` hold against the current code.

| Item | Requirement | Where | Verdict |
|---|---|---|---|
| A1 | A named account covered by System default is recorded as that account. An unpinned launch still records the selected account. The test has A selected, B covered, the replace names B, and the registry row is B. | The commit args carry `claudeAccountId` (`spawn-commit-assembly.ts:53`). Publication forwards it (`spawn-commit-publication.ts:93`). `claudeAccountIdFromProvenance` returns that id when provenance is `system` and the id is defined (`claude-pane-account.ts:38-40`), and otherwise keeps the selected account (`claude-pane-account.ts:41-42`). `recordClaudePaneAccountForSpawn` passes the id through (`claude-pane-account.ts:58`, `:72-76`). The test writes A's own login and B's identity as the system-default login, expects `prepareLaunchFor('b')` provenance `system`, then expects row B (`accountId` `b`, system-default `configDir`, `pinned: false`) and, after an unpinned spawn, row A (`spawn-replacement-addendum.test.ts:156-178`). Fixture account `b` is `b@example.test` and the selected id is `a` (`spawn-replacement-flow-fixture.ts:50-67`). | ✅ |
| A2 | The inactive live path keeps a newer reading when an idle statusline is older, using the same stale-window guard as the selected feed. | `keepNewerClaudeUsageWindow` (`claude-usage-window.ts:115-124`) replaces the selected feed's inline `keepIfNewer` (`service-fetch-policy.ts:150-151`) and is what the inactive path calls (`service-fetch-policy.ts:210-211`). The inactive path also keeps a window past reset only through `withoutResetWindows`, and it does not refresh `updatedAt` when a stale post repeats the surviving windows (`service-fetch-policy.ts:215-227`). The selected feed already had that shape. The test seeds a newer polled snapshot and posts an older session percent with the same weekly window, then expects the same object and the same `updatedAt` (`service-live-claude-usage-routing.test.ts:150-173`). | ✅ |
| A3 | One Windows case-folding helper is used by the live resolver and by transcript attribution. | `claudeAccountHomeKey` folds only on `win32` after `normalizeClaudeConfigDir` (`claude-account-home-attribution.ts:4-6`). Transcript inference compares with it and still returns the folder Claude wrote (`claude-pane-account-registry.ts:76-81`). The live resolver calls `resolveClaudeAccountHome` (`provider-account-services.ts:174-177`), which uses the same key and still skips a throwing home (`claude-account-home-attribution.ts:18-26`). The test expects both paths to resolve `b` on `win32`, both to miss on Linux when only case differs, and a throwing home to be skipped (`claude-account-home-attribution.test.ts:11-36`). | ✅ |
| A4 | The success log runs only when the swap is final. The rejected registration path is tested. | The log is gone from `savePtySpawnPaneBinding`. That function still clears `replacedPaneOwner` after a persisted swap (`spawn-commit-binding.ts:47-49`). `commitRuntimePtySpawn` captures the replaced owner first, awaits `commitPtySpawn`, and logs only when the outcome is `committed`, a pane was replaced, the launch is Claude, and an account id was supplied (`spawn-commit.ts:14-16`, `:51-62`). A registration exit is returned, not published (`spawn-commit-assembly.ts:169-181`), so the log condition fails. `requireAcceptedSpawn` then throws `agent_session_exited_during_start` (`spawn-outcome.ts:23-26`, called at `runtime/spawn.ts:95`). The success spy expects the registry row `b` before the one log line (`spawn-replacement-addendum.test.ts:237-245`). The rejection test expects the throw, the persisted swap (`bound === 'new'`), no log, and no registry row (`spawn-replacement-addendum.test.ts:248-253`). | ✅ |
| A5 | `runtime/spawn-commit.ts` calls `runtimePaneBindRefusal` instead of copying its ternary. | `runtimeSpawnPaneBinding` passes `runtimePaneBindRefusal(ctx.replacedPaneOwner)` (`spawn-commit.ts:95`). The helper still returns `terminal_pane_owner_changed` when a pane was replaced and `terminal_split_source_not_found` otherwise (`spawn-replacement.ts:111-114`). | ✅ |

Adaptations the report declared:

- Sharing `keepNewerClaudeUsageWindow` is the selected feed's old inline guard, now one function. Copying the reset-window and stale-age returns onto the inactive path matches the selected feed. That reason holds.
- A 29-line home module, rather than folding case inside `normalizeClaudeConfigDir`, matches the review's request for one helper on both attribution paths. The plan's Task 2 note left the selected feed's stored-folder string compare alone (`service-fetch-policy.ts:139` still uses `normalizeClaudeConfigDir`). That reason holds.
- Moving the log from the durable binding to the committed outcome is what A4 asked for. That reason holds.

## Correctness

No findings.

A covered named host launch uses provenance `system` (`claude-profile-chosen-account.ts:99`) and runs in the system-default folder (`claude-profile-chosen-account.ts:94`). Recording the supplied id (`claude-pane-account.ts:38-40`) matches design §3.1: the registry names the account whose login the live session runs on. Omitting the id still uses the selected account (`claude-pane-account.ts:41-42`).

The async commit callback is awaited (`opencode-startup-prompt-owner.ts:42`, `:54`). A thrown registration error is swallowed only for `agent_session_exited_during_start` and becomes `registration-exited` before the log (`spawn-commit-assembly.ts:169-181`). The log's account gate is the same one the old binding used (`ctx.isClaudeLaunch` and a defined `claudeAccountId`).

A stale post on one window and a newer post on the other still writes. The early return runs only when both surviving windows are the same as the previous snapshot (`service-fetch-policy.ts:221-227`).

Named mover launches call the host router's `prepareLaunchFor` (`spawn-claude-auth.ts:20-25`). `prepareForClaudeLaunchOnAccount` states that WSL accounts are out of scope there (`runtime-auth-service.ts:56-58`). A `wsl:<distro>:system` provenance is the unpinned WSL path, and that path still records the selected account (`claude-pane-account.ts:41-42`).

## Quality

`spawn-commit.ts` is 98 physical lines, under the 300-line cap. `claude-account-home-attribution.ts` is 29 lines, under the plan's about-200-line cap for a new file.

The diff adds no `eslint-disable`, `oxlint-disable`, `max-lines`, `@ts-ignore`, `@ts-expect-error`, or `as any`.

`keepNewerClaudeUsageWindow` and `claudeAccountHomeKey` replace the two copies the review named. The inactive ingest tail now follows the selected feed's existing reset and age checks. `runtimePaneBindRefusal` replaces the copied ternary.

The new tests assert concrete account ids, `configDir`, `pinned: false`, snapshot object identity, `updatedAt`, Windows match, Linux miss, a skipped throwing home, one success log after the registry write, and no log plus a null row on the rejected path.

The header at `claude-pane-account.ts:19-20` says a `wsl:<distro>:system` provenance runs the supplied account. The return at `claude-pane-account.ts:38-40` does that for exact `system` only. Lines 36-37 still describe the WSL form as the selected account. No named launch in this commit produces the WSL form, so this is a comment mismatch with no live caller.

## Verdict

Yes

0 Blockers, 0 Importants, 0 Minors. A1 through A5 are fixed as the earlier review described. This re-run of the three touched files passed (19 tests). The broader gates in the implementer's report were not re-run.
