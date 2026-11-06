# PR ladder v2 report

Built on 2026-11-01 on `upstream/main` = `8bb3b8bb93128a75f081d7ccf5af2454221d0b37` (fetched at the start of the run; the brief named `cd4b9d33dc8`, which was already behind). Nothing was pushed to or opened on `stablyai/orca`. The six `pr/*` branches are pushed to `origin` (A2Z-Operations/orca) with no tracking branch. The v1 branches are kept as tags `pr-v1/claude-account-pool`, `pr-v1/claude-auth-proxy`, `pr-v1/claude-pane-account-registry`, `pr-v1/claude-session-mover`, `pr-v1/claude-monitoring-pane-restart`, `pr-v1/claude-durable-background-jobs`, `pr-v1/plugin-accounts-api` (local only).

Author and committer on every commit: Nachumi Eliyahu <nachumi@a2zoperations.com>. No AI trailers (checked with `git log --format=%B upstream/main..<branch> | grep -ciE 'co-authored-by|claude-session|generated with'` = 0 on every branch). No `docs/team/**` on any branch. Fork defaults: `claudeAuthProxy: false`, `claudeAccountTokenRefresh: false`, `claudeAccountPool: 'off'`, `claudeSessionMover: 'ask'`, `claudeAutoSwitchEnabled: false`. The model policy (`ab69753dc31`, `173c7aa24a0`) is on no branch; every hunk that touched `claude-account-usage-windows.ts`, `accounts-model-policy.ts`, `claude-model-*` or the weekly/Fable list columns was dropped. `grep -rn 'blowzer\|BLOWzer\|a2z\|Studio'` on each branch's added lines returns only upstream's own hits (`Snap Studio` fixtures, `parseVisualStudioUrl`, an ssh key fragment containing `a2z`). CLI spec examples use `--environment macstudio` as the example selector name (lowercase, carried from the v1 registry commit); it is not matched by the required grep, but a neutral name would read better upstream.

## Shape of the ladder

The brief's table had A and B on nothing, C on the registry, D on C, E on D, F on C. The code disagrees in three places, each settled with the coordinator during the run:

- **C/D split (coordinator: SPLIT).** The v1 proxy commit `991f86cc2b4` edited three mover-created files. C carries the proxy infrastructure only (listener, slots, launch-env stamping, `account auth-proxy`, RPCs, registry `assignedAccountId`/`proxySlot`, robustness, remote hosts, slot hygiene). The proxy move strategy (`createProxyMoveStrategy` wiring in `provider-claude-session-mover.ts`), the runtime-spawn foreign-slot replacement in `spawn-claude-auth.ts`, the `accounts-pane-claude-mover-settings.tsx` row placement and the mover-only tests moved to D. One hunk could not be split cleanly and was rewritten instead: the registry commit never wired `recordClaudePaneAccountForSpawn` (only the mover did), so C wires it in `spawn-commit-publication.ts` itself; without it the registry on C would hold no spawn records.
- **F base (coordinator: F on D).** The v1 pool commit is mover-coupled (the rebalancer is a session move, `account moves` reads the mover's `sessionMoves`, `claude-account-pool-policy.ts` imports the mover, 8 mover-created files are edited). F stacks on D.
- **E base (not asked, reported here).** The coverage merge's core file `claude-structured-pane-account.ts` imports `claude-account-pool-launch` and records `source: 'pool'`; E needs the pool, so E stacks on F, not on D.
- **A and B base.** A's serve-launch polling arms `createClaudeUsagePollingSwitch` and `pollWithoutWindow`, which exist only in the registry commit `0db4fc68236` (auto-switch); B's `claudeTokenRefreshFields` reads the pane registry's account list. Both therefore stack on the registry commits. See "A and upstream #28044" below for what A actually needs from that commit.

Resulting land order (coordinator-confirmed for A, B, C, D, F; E follows F because of the pool import):

1. `pr/serve-usage-polling` (A) — registry + headless polling + serve arming
2. `pr/idle-token-refresh` (B) — A + token refresh
3. `pr/claude-auth-proxy` (C) — registry + proxy
4. `pr/claude-session-mover-proxy` (D) — C + mover (+ proxy move strategy, quiet wait, observability, hand-off note)
5. `pr/claude-account-pool` (F) — D + pool (policy, surface, rebalancer, `account moves`)
6. `pr/native-chat-account-coverage` (E) — F + native-chat coverage

A, B and C all carry the same three registry commits (`0db4fc68236`, `c7ddab0db13`, `7f0a1586872`) plus `d6137a0c285`; whichever lands first makes them drop out of the others on rebase.

## Rebase work common to every branch

- Upstream moved modules: `agent-view-service` → `claude/agent-view/`, `agent-session-failure*` → `shared/agent-session/failures/`, `agent-session-resume` → `shared/agent-session/lifecycle/`, `persistence` → `persistence/loading-store/store`, `structured-agent-session-projection` → `shared/agent-session/view/`, `local-pty-provider` → `providers/local-pty/`, the structured launch files → `claude/structured/launch/`. Import paths were fixed in place (`d6137a0c285` for the registry, per-branch commits elsewhere).
- Upstream refactored `ClaudeProfileRouter` (`claude-account-usage-preparation.ts`, `claude-profile-launch-preparation.ts`, `claude-profile-selection-homes.ts`, `savedAccount`, `routedHome(availability)`). The registry's `ClaudeProfileSetupQueue` and chosen-account module are kept; the fork's duplicate `claudeAccountUsagePreparation` was dropped in favour of upstream's; `selectedProfile` and `userHome` are public because upstream's `claude-profile-routed-home.ts` Picks them.
- `max-lines` (300 per `.ts`, 400 per `.tsx`, not in the baseline): `runtime-account-controller.ts`, `handler-group-manifest.ts`, `handlers/account.ts`, `claude-profile-router.ts`, `claude-structured-session-close.ts` and `SortableTab.tsx` went over on current upstream. Splits: `runtime-account-claude-policy.ts` (C/D/F/E), `runtime-account-data-snapshot.ts` (A/B/C/D/F/E, identical file), `cli/account-handler-group.ts` (A/B/C/D/F/E), `cli/handlers/account-command-guards.ts` (F/E).
- `CLI_BOOLEAN_FLAGS`: the v1 registry commit registered `on`/`off` (and the mover `ask`/`move`) as global valueless flags. On current upstream that breaks `orchestration worker-start --on <server>` (`helper-follow-up-cli.integration.test.ts` › "still refuses a worker's explicit --on": `Unknown command: orchestration worker-start other-host`). The test passes on clean `upstream/main` (targeted run, 122/122) and failed on the first C and D gates because of this. Fixed on every branch by removing the global entries; the account commands still read the flags as switches because `parseArgs` treats a flag followed by another flag or by nothing as `true`. Targeted re-run on the final A, C, D: pass.
- `flaky-test-pattern-ratchet` and `changed-code quality` findings introduced by the ports were fixed (fixed clocks in `claude-auth-proxy-slot-hygiene.test.ts` and `claude-profile-usage.test.ts`, `ast-grep-ignore` on the two real-clock proxy assertions, SAFETY notes on the two nullable-slot casts in A).
- `pnpm-lock.yaml` was rewritten by the gate's workspace-package build each time and restored; it is on no branch.

## This Mac's gate

Node 24.22 via `N_PREFIX=$HOME/.n-orca`; `corepack pnpm` works on this install (the v1 report's `/tmp/pnpm-wrap` note no longer applies). Gates ran in the `pr-proxy` worktree (`/Users/nachumieliyahu/orca/workspaces/orca-fork/pr-proxy`, now detached) so the build worktree stayed free; one vitest/check at a time. Commands per branch:

```
export N_PREFIX=$HOME/.n-orca PATH=$HOME/.n-orca/bin:$PATH
corepack pnpm run typecheck:node && corepack pnpm run typecheck:web && corepack pnpm run typecheck:cli
GIT_IDENTITY_ALLOW_OTHER=1 node config/scripts/check-changed.mjs --base=upstream/main --maxWorkers=2 --timeout=120
```

`check-changed` runs the branch's own test files and the suites its diff touches, so the separate `vitest run <files>` step from the brief is covered by it; the branch-only vitest runs made while building are listed per branch. Logs: `/tmp/prv2-<name>-typecheck.log`, `/tmp/prv2-<name>-check.log`, `/tmp/prv2-<name>-targeted.log`.

Env-only failures seen on this Mac (ignored, listed per branch below):

- `src/main/runtime/wsl-host-agent-launch-paths.test.ts` — this Mac has `/usr/local/bin/claude`.
- The macOS pty flakes from the v1 report: `pty-claude-agent-view-readiness`, `pty-runtime-hidden-at-spawn-mark`, `pty-attach-view-joins-main-start` (3), `pty-launch-race-parity`, `pty-hidden-at-spawn-mark`, `pty-spawn-scaling.performance`, `pty-pane-materialization-race`.
- `plugin-service-reconciliation.test.ts` worker `SIGTRAP` (vitest pool crash, not an assertion).
- `tests/e2e/helpers/persisted-profile-state.unit.test.ts` — `unable to open database file` under `/tmp/ovols/...` (sandbox temp path), not in any diff.
- `profile-project-domain-transfer` timeouts did not occur on these runs.

## A and upstream #28044 (coordinator question 1)

What A's two polling commits need that bare `upstream/main` lacks: `createClaudeUsagePollingSwitch`, `shouldPollClaudeUsage` (`claude-usage-polling-policy.ts`), the `pollWithoutWindow`/`pollInactiveClaude` options on `RateLimitService.start` (`service-configuration.ts`, `service-state.ts`, `service-polling.ts`), the orcad polling hook (`orcad-account-services.ts`) and their two tests. That is a 7-file, 157-line slice of `0db4fc68236`, not the registry and not the switcher. The polling switch keys on `claudeAutoSwitchEnabled`, which exists only in the auto-switch work; on bare upstream nothing asks for a headless reading, so A has no consumer there.

`309dbf11c11` (PR #28044, 13 commits, merge-base `ca310a52882`, 2443 commits behind current `upstream/main`) has `claudeAutoSwitchEnabled` but none of the polling pieces above (`git grep` for `createClaudeUsagePollingSwitch`, `pollWithoutWindow`, `pollInactiveClaude` returns 0 on it). A cannot be rebased onto it without first bringing #28044 forward 2443 commits.

Answer: **(b)**, narrowed. A needs the headless-polling plumbing from `0db4fc68236` and the `claudeAutoSwitchEnabled` setting, nothing else from it. A should be described as **stacked on the auto-switch work** (#28044 once it is current, or the registry commits as carried here), not as a stand-alone bug fix. If the maintainers want A on #28044, the cut is: the 7-file slice above as its own commit on top of a refreshed #28044, then `a361c8c0a6a`, `944a6714f21` and the two fix-ups. That is not done on this branch; A currently carries the full registry because the gate needs a buildable base and #28044 is not one today.

## Coordinator question 2: `helper-follow-up-cli.integration.test.ts`

Fails on the first C and D gates, passes on clean `upstream/main` (targeted run, `/tmp/prv2-upstream-main-targeted.log`: 5 files, 122 tests). Cause and fix are under "Rebase work common to every branch" (`CLI_BOOLEAN_FLAGS`). It is a regression the registry commit introduced against newer upstream, not an env failure; fixed on all six branches and re-verified on A, C, D with the targeted run.

## Per branch

Every HEAD below is pushed to `origin` under the same name. "Gate" rows cite the log; where the gated sha is not the final one the delta is named and the final sha was typechecked and had the changed tests run.

### A — `pr/serve-usage-polling` — HEAD `b4efeeed5acafdcc1776efd8cb767e3fd859c80f`

Base `upstream/main` `8bb3b8bb931`. Diff vs base: 105 files, +4564/−175 (24 files, +831/−45 beyond the registry).

Commits, oldest first:

| sha                          | from                                                                  | kept / changed                                                                                                                                           |
| ---------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0db4fc68236`                | v1 `cb595fb45e0` (registry + auto-switch)                             | kept; replayed with conflicts in the profile router, selection, service, controller, CLI manifest resolved by hand                                       |
| `c7ddab0db13`                | v1                                                                    | kept (named polling types, fixture clocks)                                                                                                               |
| `7f0a1586872`                | v1                                                                    | kept (root help)                                                                                                                                         |
| `d6137a0c285`                | new                                                                   | upstream module moves and router helpers (see common section)                                                                                            |
| `a361c8c0a6a`                | `4c6ae71a5c4` + the `pollInactiveClaude` infra hunks of `077c2e2dc30` | kept; dropped: `claude-account-usage-windows.ts`, weekly/Fable columns, model-policy re-evaluation, `accounts-model-policy.ts`                           |
| `944a6714f21`                | `9c88f17a9eb`                                                         | kept; `state.stopClaudeUsagePolling` on `main-process-state.ts`                                                                                          |
| `e5922f0937f`                | new                                                                   | `CLI_BOOLEAN_FLAGS` fix                                                                                                                                  |
| `205d5d6d83d`                | new                                                                   | controller split, SAFETY notes on two casts, fixed expiry in `claude-profile-usage.test.ts`                                                              |
| `87020d3511e`, `b4efeeed5ac` | new                                                                   | serve polling tests keyed on `claudeAutoSwitchEnabled` (the v1 tests keyed on the model policy, which is not on this branch); named settings-update type |

Dropped entirely: `ab69753dc31`, `173c7aa24a0` (model policy), the usage-windows merge's `claudeModelPolicy` hunks.

Gate on the final sha: `/tmp/prv2-serve-usage-polling-final-check.log` — `✗ 1 of 30 check(s) failed in 3861.4s: unit tests`; 29 static checks pass; typecheck node/web/cli `TYPECHECK EXIT 0`. Unit failures, all env-only: `wsl-host-agent-launch-paths` (5), `pty-attach-view-joins-main-start` (3), `persisted-profile-state.unit` (2), `pty-runtime-hidden-at-spawn-mark`, `pty-pane-materialization-race`, `pty-launch-race-parity`, `pty-hidden-at-spawn-mark`, `pty-spawn-scaling.performance`, `pty-claude-agent-view-readiness`. **Green apart from the env list.** (The earlier gate at `944a6714f21` failed oxlint `max-lines`, two cast findings, a wall-clock ratchet and the serve-polling tests keyed on the model policy; all fixed by the four fix-up commits.)

### B — `pr/idle-token-refresh` — HEAD `9a792c8a796eee77efdf496485045e92be45bc0d`

Base: A (`b4efeeed5ac`). Diff vs `upstream/main`: 127 files, +7707/−195; vs A: 43 files, +3146/−23.

| sha           | from                          | kept / changed                                                                                                                                                                                                                                                                   |
| ------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `60efa0e3d70` | `ecbd9899a96` + `ce77644bfcb` | kept as one commit; the proxy-401 refresh path is out (no proxy on B): `claude-token-refresh-list.ts` is proxy-free, `claudeAccountTokenRefreshEnabled` is `=== true`, default `false`; RPC methods in `accounts-claude-policy.ts`; dropped the usage-windows/model-policy hunks |
| `9a792c8a796` | `41d935267fd`                 | kept (Node http client with Claude Code's user-agent); plus: `limitErrorCode` narrows to a plain record once, SAFETY note on the credential-document cast, fixed timestamps in `claude-active-usage-refresh.test.ts`                                                             |

Gate on final sha: `/tmp/prv2-idle-token-refresh-check.log` — `✗ 1 of 30 check(s) failed in 3704.2s: unit tests`; 29 static checks pass; typecheck node/web/cli `TYPECHECK EXIT 0`. Unit failures, all env-only: `wsl-host-agent-launch-paths` (6), `pty-attach-view-joins-main-start` (3), `pty-runtime-hidden-at-spawn-mark`, `pty-pane-materialization-race`, `pty-launch-race-parity`, `pty-hidden-at-spawn-mark`, `pty-spawn-scaling.performance`, `pty-claude-agent-view-readiness`. **Green apart from the env list.**

### C — `pr/claude-auth-proxy` — HEAD `c1ef1cbb2a9b59de39a1df110bde574df6cd3485`

Base `upstream/main` `8bb3b8bb931` (registry commits folded in). Diff vs base: 134 files, +6855/−182 (71 files, +3142/−72 beyond the registry).

| sha                                                        | from          | kept / changed                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0db4fc68236`, `c7ddab0db13`, `7f0a1586872`, `d6137a0c285` | registry      | as on A                                                                                                                                                                                                                                                                                                                                                                                                       |
| `c3efa62ce02`                                              | `991f86cc2b4` | kept minus the mover hunks (moved to D): `provider-claude-session-mover.ts` proxy strategy, `spawn-claude-auth.ts` foreign-slot replacement, mover settings pane, AccountsPane `sessionMoves` test. `ClaudeAuthProxySetting` renders from `accounts-pane-claude-section.tsx`; WSL guest proxy block after the `ctx.env` assignment in `spawn-preflight.ts`; `stopClaudeAuthProxy()` in `main-process-quit.ts` |
| `07c06a30849`                                              | `c511409fff0` | kept minus mover files; the v1 `docs/team` report dropped                                                                                                                                                                                                                                                                                                                                                     |
| `0c0719ee5d6`                                              | new           | `recordClaudePaneAccountForSpawn` wired in `spawn-commit-publication.ts` (v1 registry never wired it outside the mover); `runtime-account-claude-policy.ts`, `runtime-account-data-snapshot.ts`, `cli/account-handler-group.ts` splits for `max-lines`; slot-hygiene test on a fixed clock; `ast-grep-ignore` on two real-clock proxy assertions                                                              |
| `580bb07cc3a`, `c1ef1cbb2a9`                               | new           | idle-stream test tolerances (10 s request timeout, 2 s idle budget on the active half) for a loaded machine                                                                                                                                                                                                                                                                                                   |
| `15d1e7e74a2`                                              | new           | `CLI_BOOLEAN_FLAGS` fix                                                                                                                                                                                                                                                                                                                                                                                       |

Gate at `e21d7e6d98e` (tree = `0c0719ee5d6` + the since-dropped docs file): `/tmp/prv2-claude-auth-proxy-check.log` — `✗ 1 of 30 check(s) failed in 3465.7s: unit tests`, 29 static pass. Unit failures: `wsl-host-agent-launch-paths` (5, env), the nine pty flakes (env), `plugin-service-reconciliation` worker SIGTRAP (env), `claude-auth-proxy.test.ts` idle-stream `Error: aborted` (fixed by the two tolerance commits), `helper-follow-up-cli.integration.test.ts` (fixed by `15d1e7e74a2`). Targeted run on the final sha (`/tmp/prv2-claude-auth-proxy-targeted.log`): 7 files, 147 tests pass, including both previously failing files. No full gate was rerun on the final sha (the delta is the flag fix plus two test tolerances; the coordinator asked for no further full suites).

### D — `pr/claude-session-mover-proxy` — HEAD `73ef62c5bbdada4977cb7b94df2f44c57eab9257`

Base: C (`c1ef1cbb2a9`). Diff vs `upstream/main`: 193 files, +13358/−234; vs C: 93 files, +6533/−82.

| sha           | from                                           | kept / changed                                                                                                                 |
| ------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `48b7c62255f` | `367e93d8d83` + the proxy hunks dropped from C | kept; import paths follow upstream moves; quiet-wait, observability, hand-off note included per the coordinator's SPLIT answer |
| `9386c5fabd6` | new                                            | drops the new mover type assertions (casting gate)                                                                             |
| `e612c11fe37` | new                                            | headless language reader without Electron; test rebuilt on upstream's with a `loadSystemLanguage()` helper                     |
| `835ab2bc5f6` | new                                            | typed optional job lister                                                                                                      |
| `73ef62c5bbd` | new                                            | `--ask`/`--move` out of `CLI_BOOLEAN_FLAGS`                                                                                    |

Gate at `655a4fe3aa3`: `/tmp/prv2-claude-session-mover-proxy-check.log` — `✗ 1 of 30 check(s) failed in 3487.9s: unit tests`, 29 static pass. Unit failures: `wsl-host-agent-launch-paths` (6, env), the auth-proxy idle test and `helper-follow-up-cli` (both fixed since, see C). Targeted run on the final sha (`/tmp/prv2-claude-session-mover-proxy-targeted.log`): 7 files, 148 tests pass. No full gate was rerun on the final sha.

### F — `pr/claude-account-pool` — HEAD `6b105b7f574933b5a6732ca97e56ad16c07ca633`

Base: D (`73ef62c5bbd`). Diff vs `upstream/main`: 218 files, +14889/−281; vs D: 63 files, +1612/−128.

| sha           | from          | kept / changed                                                                                                                                                                                                                                                                                    |
| ------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `07b3c484842` | `82f9ce675b9` | kept; the pool badge and `claudeSessionCountLabel` ported into upstream's rewritten switcher (`ClaudeSwitcherForOwner.tsx`, new `badge` prop on `AccountSwitchList`); `cli/handlers/account-command-guards.ts` split from `account.ts` for `max-lines`; `setAccountPool` on the policy controller |
| `6b105b7f574` | new           | polling switch takes `Partial<GlobalSettings>` (anti-slop `no-object-parameters`); `text-3xs` removed from two `<Badge>`s (shadcn `no-restyle`: Badge owns its typography)                                                                                                                        |

Gate at `d7ad86ec0d9` (final minus the rebased C tolerance commit): `/tmp/prv2-claude-account-pool-check.log` — `✗ 1 of 30 check(s) failed in 4227.8s: unit tests`, 29 static pass, typecheck `EXIT 0`. Unit failures: `wsl-host` (5), nine pty flakes, `persisted-profile-state.unit` (2), all env; `claude-auth-proxy.test.ts` active-stream half `Error: aborted` under load, fixed by `c1ef1cbb2a9` (2 s idle budget). No full gate was rerun on the final sha (delta = that tolerance commit).

### E — `pr/native-chat-account-coverage` — HEAD `757e305afcaf608f5df2e0c474c37ac28d9c82df`

Base: F (`6b105b7f574`). Diff vs `upstream/main`: 227 files, +15839/−295; vs F: 23 files, +968/−32.

| sha           | from          | kept / changed                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `c737a6008e3` | `6e2a01122b2` | kept as one commit; new `claude-structured-pane-account.ts` (+`selectedClaudeAccountId(router)`), `claude-structured-session-key.ts` (+`forgetStructuredClaudeSession`), `claude-structured-launch-home.ts` rewritten around upstream's `ClaudeAccountRecipe` (`prepareStructuredClaudeLaunchAccount(router, env, recordHome, session)`), `SortableTab` pane mark hoisted to keep the file under 400 lines; duplicate import merged (import `no-duplicates`) |
| `757e305afca` | new           | the ported pool test read the second launch recipe as a path; it now reads `.home` (the only test failure the final E's changed files showed)                                                                                                                                                                                                                                                                                                                |

Gate at `dcfe31a30d0` (final minus the import merge and the test fix): `/tmp/prv2-native-chat-account-coverage-check.log` — `✗ 2 of 30 check(s) failed in 3872.1s: changed-code quality, unit tests`. The quality finding is the duplicate import, fixed in the final sha. Unit failures: `wsl-host` (5), nine pty flakes, `persisted-profile-state.unit` (2), all env; `claude-auth-proxy.test.ts` active-stream half (fixed by `c1ef1cbb2a9`, which this sha predates). On the final sha, per the coordinator's instruction, only the quality checks were rerun (`/tmp/prv2-native-chat-account-coverage-final-quality.log`): `check-changed-code-quality.mjs` passed (`Changed-code quality gate passed since 8bb3b8bb9312`), oxlint and oxfmt on the changed files clean, typecheck node/web/cli `EXIT 0`, and the six test files E changes vs F ran alone: 42 tests, one failure (`claude-structured-pane-account.test.ts` › pool pick, a bad assertion in the ported test) fixed by `757e305afca`; that file passes 6/6 after the fix and the quality script passes again on `757e305afca`.

## Gate results, summary

| branch                              | sha gated                                               | result                                                             | non-env failures                                                                                      |
| ----------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| A `pr/serve-usage-polling`          | `b4efeeed5ac` (final)                                   | 29/30, unit = env only                                             | none                                                                                                  |
| B `pr/idle-token-refresh`           | `9a792c8a796` (final)                                   | 29/30, unit = env only                                             | none                                                                                                  |
| C `pr/claude-auth-proxy`            | `e21d7e6d98e` (= `0c0719ee5d6` + docs file)             | 29/30                                                              | `claude-auth-proxy` idle test, `helper-follow-up-cli` — both fixed on the final sha, targeted 147/147 |
| D `pr/claude-session-mover-proxy`   | `655a4fe3aa3`                                           | 29/30                                                              | same two, fixed; targeted 148/148                                                                     |
| F `pr/claude-account-pool`          | `d7ad86ec0d9`                                           | 29/30                                                              | `claude-auth-proxy` active-stream half under load — fixed by `c1ef1cbb2a9`                            |
| E `pr/native-chat-account-coverage` | `dcfe31a30d0`; quality + changed tests on `757e305afca` | 28/30 → quality passes on final; unit = env + the proxy test above | ported test assertion, fixed by `757e305afca`                                                         |

Typecheck (node, web, cli) passes on every final sha. Logs: `/tmp/prv2-<branch>-check.log`, `/tmp/prv2-<branch>-final-check.log` (A), `/tmp/prv2-<branch>-targeted.log`, `/tmp/prv2-native-chat-account-coverage-final-quality.log`, `/tmp/prv2-upstream-main-targeted.log`.

## Notes for the PR descriptions

- `0db4fc68236` keeps `--environment macstudio` as the example selector in the account CLI specs; rename before opening if a neutral example is preferred.
- The pool's rebalancer is a session move (coordinator note); F lands after D.
- E depends on the pool (`claude-structured-pane-account.ts` imports `claude-account-pool-launch`), so E lands after F, not after D as the brief's table had it.
- A/B/C share the four registry commits; after the first of them lands, rebase the other two and those commits drop out.
- The v1 branches are not deleted; `pr-v1/*` tags point at them. The `pr-pool` and `pr-proxy` worktrees are detached.

## PR 0: `pr/claude-pane-account-registry-v2` (2026-11-02 follow-up)

Upstream #28044 is 2443 commits behind `main`; PR 0 is its refreshed replacement and the base the other six now share. Cut on `upstream/main` `8bb3b8bb931`, pushed to `origin`, tracking unset. Diff vs base: 93 files, +3774/−162.

| sha                                                        | content                                                                                                                                                                                                            |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `0db4fc68236`, `c7ddab0db13`, `7f0a1586872`, `d6137a0c285` | the four registry commits A/B/C shared, unchanged objects                                                                                                                                                          |
| `9e6c4380485`                                              | the `CLI_BOOLEAN_FLAGS` fix (cherry-picked from the former A commit; the copies on A and C dropped out as already upstream)                                                                                        |
| `d213bad0959`                                              | `--environment macstudio` → `--environment build-box` in `src/cli/specs/account.ts` (`build-box` is upstream's own example name)                                                                                   |
| `31947597645`                                              | `runtime-account-data-snapshot.ts` split out of `runtime-account-controller.ts`; the registry alone put the controller at 301 lines, which `max-lines` refuses, so PR 0 carries the split that A and C used to add |

Gate on `31947597645` (`/tmp/prv2-registry-v2-check.log`, typecheck `/tmp/prv2-registry-v2-typecheck.log`): typecheck node/web/cli `EXIT 0`; `✗ 1 of 30 check(s) failed in 3336.9s: unit tests`, 29 static checks pass; unit failures env-only (`wsl-host-agent-launch-paths` 5, `pty-attach-view-joins-main-start` 3, `persisted-profile-state.unit` 2, the six single pty flakes). **Green apart from the env list.**

### The six rebased on PR 0

Each branch's tree is byte-identical to its previous HEAD apart from the example rename (verified with `git diff <old> <new>` = empty before the rename commits). The rename is applied in one commit per branch that introduced further `macstudio` examples (B: token-refresh spec; C: auth-proxy spec and `wsl-guest-auth-proxy-env.test.ts`; D: mover specs; F's pool commit took the neutral name during the rebase). `git grep macstudio -- src` is empty on all seven.

| PR  | branch                               | HEAD                                       | base            | own diff vs base     | own commits |
| --- | ------------------------------------ | ------------------------------------------ | --------------- | -------------------- | ----------- |
| 0   | `pr/claude-pane-account-registry-v2` | `319475976458cc9328096a2591e99b62111ab6a0` | `upstream/main` | 93 files, +3774/−162 | 7           |
| A   | `pr/serve-usage-polling`             | `6dcef705dc5d54729d0f496af6c3e02b436f63f5` | PR 0            | 21 files, +798/−21   | 5           |
| B   | `pr/idle-token-refresh`              | `0d049a840eb44b773cdbe03225106ebb1f26a542` | A               | 43 files, +3146/−23  | 3           |
| C   | `pr/claude-auth-proxy`               | `11a977c2c6fd2dd3997be846399520eac1f4040f` | PR 0            | 69 files, +3109/−48  | 6           |
| D   | `pr/claude-session-mover-proxy`      | `7bfbacd8a7d8824a88e1c5c9d168a9b02f349764` | C               | 93 files, +6533/−82  | 6           |
| F   | `pr/claude-account-pool`             | `f3aaeacfb4ed0a65f10f38201f029bff6460815a` | D               | 63 files, +1612/−128 | 2           |
| E   | `pr/native-chat-account-coverage`    | `408c05f034c16bdbea6dcbaa8cb5fd21cd0c004a` | F               | 23 files, +968/−32   | 2           |

Per the task, the six had typecheck node/web/cli plus targeted suites only (their content did not change): each branch's own `*.test.ts(x)` files vs its base plus the four CLI-flag suites (`args`, `cli-argument-boundary`, `index-local-command-routing-flags`, `helper-follow-up-cli.integration`). Logs `/tmp/prv2-<branch>-v3-targeted.log`:

| branch | typecheck | targeted vitest          |
| ------ | --------- | ------------------------ |
| A      | `EXIT 0`  | 10 files, 150 tests pass |
| B      | `EXIT 0`  | 11 files, 173 tests pass |
| C      | `EXIT 0`  | 20 files, 187 tests pass |
| D      | `EXIT 0`  | 28 files, 297 tests pass |
| F      | `EXIT 0`  | 15 files, 197 tests pass |
| E      | `EXIT 0`  | 10 files, 129 tests pass |

**Land order: 0, A, B, C, D, F, E.** After PR 0 lands, A and C rebase onto `main` with no change; B, D, F, E follow their parents. Author and committer on every commit is Nachumi Eliyahu <nachumi@a2zoperations.com>; no trailers; no `docs/team/**`; `pnpm-lock.yaml` untouched.

## Rebase onto `5e02b47d114` (2026-11-02, task_42251369e551)

All seven open PRs (#37567–#37573) were "dirty" against upstream/main `5e02b47d1140` (175 commits past `8bb3b8bb931`). Rebased in stack order 0 → A → B and 0 → C → D → F → E in `~/orca/workspaces/orca-fork/pr-ladder-v2-claude`; every commit kept (no squash), author and committer Nachumi Eliyahu <nachumi@a2zoperations.com>, no trailers. All seven pushed with `--force-with-lease`; GitHub updated the open PRs in place.

### New HEADs

| PR  | branch                               | old HEAD      | new HEAD                                   | base            | own diff vs base     | own commits |
| --- | ------------------------------------ | ------------- | ------------------------------------------ | --------------- | -------------------- | ----------- |
| 0   | `pr/claude-pane-account-registry-v2` | `31947597645` | `45b20e30523fecc28de13a999a5028f1174f7c7a` | `upstream/main` | 94 files, +3897/−167 | 8           |
| A   | `pr/serve-usage-polling`             | `6dcef705dc5` | `a3d1068e7bdcc568b0344c5ff4355efc2ba711b7` | PR 0            | 21 files, +798/−21   | 5           |
| B   | `pr/idle-token-refresh`              | `0d049a840eb` | `990bd8ec2f137ee549a29cd2fcd6cc5413edc4ea` | A               | 43 files, +3146/−23  | 3           |
| C   | `pr/claude-auth-proxy`               | `11a977c2c6f` | `80f72b89483b6b16d787945903b932e0f1032161` | PR 0            | 69 files, +3109/−48  | 6           |
| D   | `pr/claude-session-mover-proxy`      | `7bfbacd8a7d` | `6b4adf7e354cbbcb242ec12e259c29ab300f7788` | C               | 93 files, +6533/−82  | 6           |
| F   | `pr/claude-account-pool`             | `f3aaeacfb4e` | `d8c80f7385fee75422f48d920d03943e994efe56` | D               | 63 files, +1612/−128 | 2           |
| E   | `pr/native-chat-account-coverage`    | `408c05f034c` | `18ba2dec20350dc0d6cf67fc5117011c90897ed1` | F               | 23 files, +968/−32   | 2           |

`git merge-tree --write-tree upstream/main <branch>`: no CONFLICT on any of the seven. `git diff upstream/main <branch> | grep -iE 'blowzer|macstudio|a2z|sabrent'`: empty on all seven. Stack ancestry verified (`merge-base --is-ancestor`).

### Conflicts resolved

- **Every branch** — `src/renderer/src/components/native-chat/agent-session-failure-words-text.ts`: upstream `4343dc212a2` split the start-failure pieces into `agent-session-start-failure-words-text.ts`; we had split the chosen-account pieces into `agent-session-chosen-account-words-text.ts`. Kept both imports and both spreads; neither file defines the other's keys, the `AgentSessionFailureCopyId` union compiles.
- **PR 0** — upstream moved `shared/agent-session-failure-copy` → `shared/agent-session/failures/agent-session-failure-copy` and `shared/agent-session-acquired-account` → `shared/agent-session/lifecycle/agent-session-acquired-account`; import paths followed. Upstream deleted the `REMOTE` const from `runtime-provider-accounts-client.test.ts`; our registry test still needs it, so it is re-added inside the registry commit. `agent-session-refusal-details.ts` hit `max-lines` (302 code lines) after the move; the 4-line `RewindFacts` type is now one line.
- **C, D, F, E** — `src/renderer/src/lib/claude-session-account-move.test.ts`: kept our appended `describe('a pane the auth proxy has moved')`, dropped the `claudeLaunchAccountId` describe upstream deleted.
- **D** — `src/main/provider-account-services.ts`: the new System Default coverage resolver (below) and the session mover both touch the wiring; both kept, resolver registered before `createProviderClaudeSessionMover`.
- **E** — `claude-structured-launch-resolution.ts` and `claude-structured-launch-home.ts`: single `ClaudeAccountRecipe` import from the moved lifecycle path, no `prepareClaudeLaunchAccount` import, no duplicate launch-home import (the earlier duplicate-import regression did not recur).

### CodeRabbit findings on PR 0 (coordinator addendum)

One extra commit on PR 0, re-stacked under all six children before any gate: **`45b20e30523`** "Reject non-boolean auto-switch toggles, keep foreign billed posts off the bar, and state the real switch lines."

1. `src/main/ipc/claude-accounts.ts` — `claudeAccounts:setAutoSwitch` throws `TypeError` unless `args.enabled` is a boolean. New `src/main/ipc/claude-accounts.test.ts`: `claudeAccounts:setAutoSwitch › passes a boolean through and rejects anything else without touching the setting` (`true` passes; `'true'`, `1`, `null`, `undefined`, `{}` and missing args throw; `setAutoSwitch` called once).
2. `src/main/rate-limits/service/service-fetch-policy.ts` — a billed live reading updates `state.claude` only when the billed account is the selected one: `profile:<id>` provenance compares ids; `system` / `wsl:<distro>:system` provenance asks the new `claudeSystemDefaultCoverageResolver` (wired in `provider-account-services.ts` to `router.coveredBySystemDefault`). A billed account that is neither inactive nor selected is dropped with a debug line. New tests in `service-live-claude-usage-routing.test.ts`: `leaves the bar alone when a billed post names an account that is neither inactive nor selected` and `accepts a billed post on System Default only for an account the user folder covers`.
3. Copy in `accounts-pane-claude-auto-switch.tsx`, `accounts-claude-search.ts` and `en.json` (`accounts.claude.autoSwitchDescription`) now reads "passes 95% of its 5-hour limit or 90% of its weekly limit"; policy unchanged at 95/90. The runtime-required catalog does not list this key, so `en-runtime-required.json` is unchanged (the `--fix` run only produced unrelated upstream ordering drift, reverted).

### Gate results

Strategy: PR 0 and E (the two ends of the long stack) got the full `check-changed.mjs --base=upstream/main --maxWorkers=2 --timeout=120`; A, B, C, D, F got typecheck node/web/cli, `check-changed-code-quality.mjs upstream/main`, `oxlint` on their changed `src` files, and vitest on their own changed test files plus the four CLI-flag suites (the full gate takes ~60 min per branch on this Mac).

| branch | typecheck node/web/cli | quality gate | oxlint | targeted vitest / full gate                                                                 |
| ------ | ---------------------- | ------------ | ------ | ------------------------------------------------------------------------------------------- |
| 0      | `EXIT 0`               | pass         | —      | full: 29/30 static checks pass; unit tests fail env-only (list below)                       |
| A      | `EXIT 0`               | pass         | pass   | pass                                                                                        |
| B      | `EXIT 0`               | pass         | pass   | pass                                                                                        |
| C      | `EXIT 0`               | pass         | pass   | pass                                                                                        |
| D      | `EXIT 0`               | pass         | pass   | pass                                                                                        |
| F      | `EXIT 0`               | pass         | pass   | pass                                                                                        |
| E      | `EXIT 0`               | pass         | —      | full: `✗ 2 of 30 … changed-code quality, unit tests` → quality fixed (below), unit env-only |

The one real finding was the quality gate's `typescript(consistent-type-assertions)` on `src/main/ipc/claude-accounts.test.ts:24`: the `as unknown as ClaudeAccountService` cast spanned a multi-line object literal, so the `SAFETY` disable comment was not on the line above the expression. Fixed on PR 0 (cast moved to one annotated line), fixup-squashed into `45b20e30523`, six children re-stacked, then `check-changed-code-quality.mjs upstream/main` re-run on all seven (all pass) plus `typecheck:node` on PR 0 (`EXIT 0`). The first gate queue's per-branch logs were overwritten by a shell-variable bug in the queue script, so only E's full log (`/tmp/prv2-5e--check.log`) and the re-gate logs (`/tmp/prv2-regate-*`) survive.

Unit-test failures, all env-only on this Mac: `wsl-host-agent-launch-paths` ×5, `pty-attach-view-joins-main-start` ×3, `persisted-profile-state.unit` ×2, the single pty flakes (`pty-claude-agent-view-readiness`, `pty-runtime-hidden-at-spawn-mark`, `pty-launch-race-parity`, `pty-hidden-at-spawn-mark`, `pty-spawn-scaling.performance`, `pty-pane-materialization-race`). **New since the last report:** `src/main/runtime/runtime-failed-local-worktree-removal.test.ts` (15 tests) failed in PR 0's full run because the global `commit-msg` identity hook refuses the fixture's `Worktree Removal <removal@example.invalid>` author on its `git commit -qm seed`; env-only (upstream CI has no such hook). The cross-version harness also cannot resolve tags `v1.4.244`/`v1.4.245` here.

**Land order unchanged: 0, A, B, C, D, F, E.**

## Light rebase onto `aaf4a5d9539a` (2026-11-03, task_96287b1293af)

Brief asked for `900146b9da7`; upstream moved to `aaf4a5d9539a` (11 more commits, owner-grouping refactors) before the push, so the coordinator redirected to that and the ladder was rebased twice in stack order. All seven force-pushed with lease. **Standing rule: no further rebases on my own; the leader asks when a maintainer engages or PR 0 is about to merge.**

| PR  | branch                               | old HEAD      | new HEAD       |
| --- | ------------------------------------ | ------------- | -------------- |
| 0   | `pr/claude-pane-account-registry-v2` | `45b20e30523` | `69e2f3381182` |
| A   | `pr/serve-usage-polling`             | `a3d1068e7bd` | `b603a4dd7e95` |
| B   | `pr/idle-token-refresh`              | `990bd8ec2f1` | `c9bbdd1fceaa` |
| C   | `pr/claude-auth-proxy`               | `80f72b89483` | `d26005d993cf` |
| D   | `pr/claude-session-mover-proxy`      | `6b4adf7e354` | `f753a197baad` |
| F   | `pr/claude-account-pool`             | `d8c80f7385f` | `0502db183ee5` |
| E   | `pr/native-chat-account-coverage`    | `18ba2dec203` | `6b33f7eae53b` |

Commit counts unchanged (8/13/16/14/20/22/24); merge-tree clean, forbidden-word grep empty, Nachumi-only author/committer, no trailers.

Conflicts and import moves (all mechanical, folded into the commits that introduced the lines):

- C `src/main/startup/main-process-quit.ts` (upstream `b89cfbd09d6` moved the quit imports under `./quit/`): upstream paths kept, our `stopClaudeAuthProxy` import and call kept.
- PR 0 `src/main/provider-account-services.ts` → `src/main/providers/accounts/provider-account-services.ts` (upstream #37612) and `src/main/orcad/orcad-account-services.ts`: upstream path taken, our registry/auto-switch/home-attribution imports re-pointed with `../../`.
- B `claude-oauth-refresh.ts`: `integration-credential-file` moved to `src/main/credentials/` (upstream #37606); fixup into the token-refresh commit.
- D: `orcad-account-services.ts` and `provider-claude-session-mover.ts` import the moved provider file; the provider file's `./provider-claude-session-mover` import became `../../provider-claude-session-mover` (caught by E's typecheck). F: `claude-account-pool-launch` import re-pointed.

Gate (coordinator-reduced): typecheck node/web/cli `EXIT 0` on PR 0 and E; PR 0 targeted suites 240/240 pass; `oxlint src/main/startup/main-process-quit.ts` clean on C. The `run-vitest.mjs related` selection from the brief was dropped on the coordinator's instruction (it pulled in unrelated runtime/persistence specs that fail for environment reasons here).

## Rebase #5 onto `480842c82a72` (A dropped after #37633) (2026-11-05, task_354bd99fb16a)

A maintainer closed PR A #37568 (`pr/serve-usage-polling`) and merged #37633 instead: every host now runs the poll timer from `createProviderAccountServices` (`rateLimits.start({ fetchImmediately: false })`), and a tick fetches only while someone watches — the focused desktop window, or a viewer taken with `RateLimitService.addUsageViewer()` (held by a paired device's `accounts.subscribe` stream). The ladder now has six PRs: **0 → B** and **0 → C → D → F → E**. All six rebased onto upstream/main `480842c82a72` (527 commits past `af6cb2cf8c3`), force-pushed with lease on 2026-11-06 12:50Z, after both full gates had passed on the pushed SHAs. Author and committer Nachumi only, no trailers (the `(cherry picked from …)` line on PR 0's `--on/--off` commit was removed), forbidden-word grep of messages and diffs empty, merge-tree clean on all six, stack ancestry verified.

### New HEADs

| PR  | branch                               | old HEAD      | new HEAD                                   | own diff vs parent        | own commits |
| --- | ------------------------------------ | ------------- | ------------------------------------------ | ------------------------- | ----------- |
| 0   | `pr/claude-pane-account-registry-v2` | `7e4c2859da3` | `67ca11eec50f0ebd22d3897bf7a9b4ca91a6c4c0` | 88 files, +3726/−161      | 8           |
| B   | `pr/idle-token-refresh`              | `46fdb2215f3` | `ef5d9d35c253b4e7a932853ba76713127a4c9f09` | 42 files, +3113/−17       | 3           |
| C   | `pr/claude-auth-proxy`               | `9d0edf9c67c` | `201c5c5ba43e6c6f0842680b894a1aa1b61a035d` | 69 files, +3089/−45       | 6           |
| D   | `pr/claude-session-mover-proxy`      | `d71e1c88c45` | `0eaa8d69d298bb7435ddece842a388ab5ada3471` | 91 files, +6474/−82       | 7           |
| F   | `pr/claude-account-pool`             | `d7df158ab79` | `2cc838e29c3bda3abdf0d814465db8b807060372` | 61 files, +1600/−135      | 2           |
| E   | `pr/native-chat-account-coverage`    | `9621971791e` | `c8874dcd51786bb794ef987a6ca81d87c5548929` | 23 files, +1012/−31       | 2           |

### A dropped

B was rebased with `--onto` PR 0 and these five commits removed from the todo: `9388eb948f7` (poll inactive accounts under Electron serve, failure logging), `f378f85466f` (arm polling from Electron serve launch, `serve-claude-usage-polling.ts`, selected-account usage), `069eb76978b`, `bb7931f98ac`, `00e0c396fb1` (their test/line-budget follow-ups). B's three own commits stayed.

What of A survived inside B (folded into B's first commit, `Refresh idle Claude account tokens…`): only the `httpStatus?: number` field on `UsageRateLimitMetadata`, because B's lapsed result reports `httpStatus: 401`. B's ordering hook now calls `orderInactiveClaudeRefreshAccounts(accounts, null)` inside upstream's `fetchInactiveClaudeAccountsOnOpen` (A's selected-host-account fetch is gone), and B no longer adds `setActiveClaudeUsageAccountResolver` in `provider-account-services.ts`. The token-refresh retry therefore runs on #37633's path: the inactive-account fetch that `accounts.list`/`accounts.subscribe` and window focus trigger, on a host someone watches.

### PR 0 polling re-wired onto #37633

PR 0 had its own headless opt-in (`start({ pollWithoutWindow: true })`). That flag is removed from `service-configuration.ts`, `service-polling.ts` and `service-state.ts`, and `service-headless-polling.test.ts` is deleted. `createClaudeUsagePollingSwitch` now holds one usage viewer (`addUsageViewer()`, plus one `refreshIfStale()`) while auto-switch is on and releases it when off; orcad still applies it from settings. D and F extend the same switch with the session mover and the pool, as before. D's `orcad-account-services.test.ts` case now spies on `addUsageViewer`/`refreshIfStale`. `docs/reference/claude-accounts.md` states the headless behaviour in viewer terms. No window-only start was added, so `runtime-composition-parity.test.ts` passes unchanged.

### Conflicts resolved

- **PR 0** — upstream moves: `codex/configuration/homes/`, `agent-hook-listener/configuration/agent-status-hooks-setting` (also in the new `claude-profile-setup-queue.ts`), `settings/accounts/claude/` (our `accounts-pane-claude-auto-switch.tsx` moved there), `runtime/agent-session/environment/` (our `runtime-account-data-snapshot.ts` moved beside the controller). Upstream deleted `ClaudeAccountSwitchDialog.test.tsx`, `AccountsPane.test.tsx`, `runtime-provider-accounts-client.test.ts` (low-value test sweeps); our additions to them went with them. `AccountsPane.owner-scope.test.tsx` moved to `settings/accounts/`; our auto-switch case re-added there.
- **B** — `claude-credential-persistence-ratchet.test.ts` was deleted upstream (#38763); our allowance for `claude-oauth-refresh.ts` went with it. Import moves in `runtime-service-command-surface.ts` and the Claude settings section.
- **C** — `main-process-quit.ts`: upstream path kept, `stopClaudeAuthProxy` import and call kept. `runtime-auth-service.ts` (wsl moves), `spawn-commit-assembly.ts`, `orcad-account-services.test.ts`. `runtime-account-claude-policy.ts` and `claude-auth-proxy-setting.tsx` moved beside their upstream neighbours. `index-local-command-routing-flags.test.ts` deleted upstream (#38733), our `auth-proxy --environment` case went with it.
- **D** — `provider-account-services.ts`: upstream `rateLimits.start` kept above our `sessionMover` return. ~20 shared-module moves fixed (`workspace-layout/stable-pane-id`, `agent-status/contracts/*`, `agent-launch/startup/*`, `push/notifications/…`). Mover settings UI moved into `settings/accounts/claude/`. Our new cases in `server-status-listener-fanout.test.ts` kept, the ones upstream deleted dropped.
- **F** — `ClaudeSwitcherForOwner.tsx`: upstream's `AccountSwitchSection`/signed-out grouping kept; our Pool badge goes through a new optional `badge` prop on `AccountSwitchSection`, and the per-account session count joins the row's `detail` line. `use-tab-agent.ts`: upstream's memoised resolver kept with our `focusedTerminalPtyId`. `account.ts` imports merged with upstream's `account-command-guards`. `claude-account-pool-setting.tsx` moved to `settings/accounts/claude/`.
- **E** — `claude-structured-launch-resolution.ts` (moved composition import), `runtime-mobile-structured-tab-status.ts` (moved). Upstream deleted the old `runtime-mobile-structured-tab-status.test.ts`; our billed-account case is recreated beside the moved source.

### Found by the full gate and fixed: saved-roster rows (D)

Upstream's newer `src/main/runtime/agent-session-saved-roster.test.ts` asserts the exact status-change row (`paneKey`, `state`, `receivedAt`, `observedInCurrentRuntime`). D adds `mainAgentState` (and `backgroundWork`/`turnEndedAt` when present) to those rows for the session mover, so the four seeding cases failed from D onward (passes on upstream/main, PR 0, B and C; fails on D, F, E). Fixed by one test-only commit on D, "Expect the main agent state on saved-roster status rows." (`0eaa8d69d29`, 11/11 pass); F and E restacked with `--onto` onto it, each keeping only its own two commits.

### Found by the full gate and fixed: launch on a deleted account home (PR 0)

The first full gate of PR 0 failed two cases of upstream's `claude-profile-router.test.ts` ("makes a launch redo a first setup that was cut off after its ownership gate", "requires concurrent launches to finish rebuilding a home whose marker survived"): `prepareLaunch()` resolved where upstream rejects with `claudeAccountSetupFailed`. Cause: upstream #38389 moved the profile marker out of the home folder (`claude-profiles/<id>/profile.json`), and its `prepareClaudeProfileForLaunch` now treats a missing **folder or** marker as a first construction that must succeed. PR 0's `ClaudeProfileSetupQueue.runForLaunch` (the setup logic PR 0 extracts from the router) had carried the older marker-only check, so a deleted home with a surviving marker took the capped-refresh path and launched. Fix (14 lines removed, 10 added, one file): `runForLaunch` now delegates to upstream's `prepareClaudeProfileForLaunch` with the queue's `run` as the setup, so the launch policy stays upstream's. Squashed into PR 0's "Follow upstream module moves and router helpers" commit (PR 0 stays at 8 commits); B, C, D, F, E restacked with `--onto`, each unchanged apart from inheriting the fix. 11/11 pass on PR 0; both full gates re-run on the new SHAs (below).

### Gates

Per branch: typecheck node/web/cli, targeted vitest on every changed test file plus `src/main/rate-limits/**/*.test.ts` and `runtime-composition-parity.test.ts`, oxlint on changed files, `check-changed-code-quality.mjs upstream/main`.

| branch | typecheck node/web/cli | targeted vitest       | oxlint | quality |
| ------ | ---------------------- | --------------------- | ------ | ------- |
| 0      | 0/0/0                  | 69 files, 840 pass    | pass   | pass    |
| B      | 0/0/0                  | 74 files, 876 pass    | pass   | pass    |
| C      | 0/0/0                  | 83 files, 931 pass    | pass   | pass    |
| D      | 0/0/0                  | 102 files, 1061 pass  | pass   | pass    |
| F      | 0/0/0                  | 107 files, 1098 pass  | pass   | pass    |
| E      | 0/0/0                  | 109 files, 1110 pass  | pass   | pass    |

Full `check-changed.mjs --base=upstream/main --maxWorkers=2 --timeout=150` on PR 0 and E, run one at a time (another worker's build kept the load average at 90–235 during round one; two parallel runs had both hit the 120-min timeout before that). Round one: PR 0 `3a9b828fcbf` 102 min, E `3c66a34af74` 79 min — found the profile-router regression above. Round two, on the pushed SHAs: PR 0 `67ca11eec50` 67 min, E `c8874dcd517` 64 min (load ~40). Both rounds: 29/30 checks pass, "unit tests" the only ✗.

Unit failures on the pushed SHAs, all env-only on this Mac: `pty-attach-view-joins-main-start` ×3, `pty-claude-agent-view-readiness`, `pty-hidden-at-spawn-mark`, `pty-launch-race-parity`, `pty-pane-materialization-race`, `pty-runtime-hidden-at-spawn-mark`, `wsl-host-agent-launch-paths` ×4 (PR 0) / ×5 (E), `persisted-profile-state.unit` ×2. One flake on PR 0: `runtime-rpc-websocket-bind-host` ("widens the listener" re-bound on port 59803 instead of 59802 — another process took the freed port; 19/19 on three reruns; PR 0 does not touch `rpc/server`).

Two more env-only groups showed in round one only, both failing identically on upstream/main `480842c82a7`: `runtime-failed-local-worktree-removal.test.ts` ×15 (the global `commit-msg` identity hook refuses the fixture author `Worktree Removal <removal@example.invalid>`) and `tests/e2e/cross-version-wire/*` ×9 (`released-chat-upgrade`, `agent-session-outcome-chat-downgrade`, `agent-session-kill-delivered-downgrade`: the harness needs the two latest release tags, which `git fetch upstream` does not bring in; `git fetch upstream --tags` clears it). Two more things learnt about the gate on this terminal: `pty-spawn-env-terminal-basics` fails only because the Orca terminal exports `GIT_CONFIG_{KEY,VALUE}_0/1`, `GIT_CONFIG_COUNT`, `GIT_EDITOR`, `GIT_TERMINAL_PROMPT`, `GIT_ASKPASS` (42/42 with them unset — the gate script now unsets them); `pty-connection-hidden-replay` is a load flake (90/90 rerun unloaded). The renderer tests need `corepack pnpm exec vitest run --config config/vitest.config.ts`; the direct runner cannot resolve the `@/lib/...` alias.

### GitHub state after the push

Still **CONFLICTING on all six** (#37567, #37569–#37573): upstream/main moved 94 commits (`480842c82a7` → `f3cba2e772c`) during the ~26 h the four full-gate runs took, and `git merge-tree` against the new tip reports 5/5/6/7/7/7 conflicting files (PR 0: `src/cli/handlers/account.ts`, `account-list-format.ts`, `root-help-text-primary.ts`, `root-help-text-secondary.ts`, and `src/main/rate-limits/claude-profile-usage.test.ts` deleted upstream). The branches are clean against the base this task was given. Rebase #6 onto `f3cba2e772c` was asked for and not answered within 30 min, so under the standing rule it was not started; it needs its own dispatch (expect ~4–5 h: resolve + two sequential full gates).

#37569's body sentence "Stacked on the headless-polling PR" → "Stacked on #37567" was changed with `gh pr edit --body-file` (pre-approved for this task; the old body is kept in the task scratchpad). No comments were posted on any upstream PR or issue.

**Land order: 0, B, C, D, F, E.** Standing rule unchanged: no further rebases on my own.

## Rebase #6 onto `26741256dcc` (2026-11-06)

Asked for once rebase #5's branches were CONFLICTING against an upstream/main that had moved on. All six were rebased in stack order **0 → B** and **0 → C → D → F → E** onto upstream/main `26741256dcc`, which is 101 commits past `480842c82a7`. They were force-pushed with explicit leases against the rebase #5 heads, and GitHub reports **MERGEABLE on all six** (#37567, #37569–#37573).

**Push before full gates (decision).** I pushed once the targeted gates were green, before the two full gates finished. During rebase #5, upstream moved 94 commits while those gates ran and every PR conflicted again. The plan was a fix commit pushed with a lease on the affected branch if a full gate found a real regression; none did. Five hours after the push upstream had moved 6 more commits, and GitHub still showed all six MERGEABLE. No seventh rebase.

Author and committer on every commit is Nachumi Eliyahu <nachumi@a2zoperations.com>, with no trailers. The forbidden-word grep of messages and diffs is empty, `git merge-tree` against `26741256dcc` is clean, stack ancestry is verified, and `pnpm-lock.yaml` is untouched. #37569's body already read "Stacked on #37567" and was not edited. Nothing was posted upstream.

### New HEADs

| PR  | branch                               | old HEAD      | new HEAD      | own diff vs parent   | own commits |
| --- | ------------------------------------ | ------------- | ------------- | -------------------- | ----------- |
| 0   | `pr/claude-pane-account-registry-v2` | `67ca11eec50` | `bc09ca7485b` | 88 files, +3734/−164 | 8           |
| B   | `pr/idle-token-refresh`              | `ef5d9d35c25` | `a062912fddb` | 41 files, +3110/−16  | 3           |
| C   | `pr/claude-auth-proxy`               | `201c5c5ba43` | `ae0df5704cb` | 68 files, +3075/−45  | 6           |
| D   | `pr/claude-session-mover-proxy`      | `0eaa8d69d29` | `2c734004a52` | 89 files, +6434/−82  | 6           |
| F   | `pr/claude-account-pool`             | `2cc838e29c3` | `efe10dececb` | 61 files, +1600/−135 | 2           |
| E   | `pr/native-chat-account-coverage`    | `c8874dcd517` | `d6ebc616765` | 23 files, +1012/−31  | 2           |

D went from 7 commits to 6: "Expect the main agent state on saved-roster status rows" only touched `agent-session-saved-roster.test.ts`, which upstream deleted, so the commit was skipped.

### Conflicts resolved

- **PR 0**
  - `src/cli/handlers/account-list-format.ts`: upstream now prints each account's id, a `system  System default` line, and a new Antigravity formatter. Our per-account `sessions:` count and the `auto-switch:` and `pane …` lines sit on top of upstream's id lines.
  - `src/cli/handlers/account.ts`: `account rm` calls upstream's `removeAgentAccount`. `account auto-switch` stays.
  - `root-help-text-{primary,secondary}.ts`: upstream's `select` and `rm` lines are kept, and our auto-switch lines are added.
  - Upstream's test sweep (#38943) deleted `claude-profile-usage.test.ts`, and our test case in it went too.
  - `claude-profile-router-launch-env-for.test.ts`: the adapter import follows its move to `agent-session-wire/providers/`.
- **PR 0, line budget.** Upstream left `global-settings-types.ts` and `agent-session-failure-words.ts` at exactly 300 counted lines.
  - `claudeAutoSwitchEnabled` moved into `ClaudeAccountSwitchSettings` in `src/shared/claude-account-switch-settings.ts`, where B, C, D and F already keep their Claude switch settings. `GlobalSettings` still includes it through `GlobalSettingsBase`.
  - The four plain Claude-account failure sentences (`claudeAccountFolderMissing` and `claudeAccountSetupFailed` from upstream, plus our `claudeAccountUnknown` and `claudeAccountWslUnsupported`) moved into a new `src/shared/agent-session/failures/claude-account-failure-words.ts`. It is spread into `FAILURE_SENTENCES`, and the object's `satisfies Record<AgentSessionFailureKind, Sentence>` check still covers them.
  - Both changes are folded into PR 0's first commit, so PR 0 stays at 8 commits.
- **B**
  - `claude-account-switch-settings.ts`: keeps both `claudeAutoSwitchEnabled` and `claudeAccountTokenRefresh`.
  - B's edits to the deleted `claude-profile-usage.test.ts` went with it. Its own `claude-active-usage-refresh.test.ts` and `claude-oauth-refresh.test.ts` still cover the refresh path.
- **C**
  - The same three spots as PR 0: the list-format lines (auth-proxy and WSL auth-proxy lines on top of upstream's), `account.ts` imports and handlers, and the switch settings.
  - Upstream deleted `orcad-account-services.test.ts` (#38905), and C's case in it went too.
- **D**
  - `orcad-account-services.test.ts` (deleted upstream): D's polling-switch case went with it. `claude-usage-polling-policy.test.ts` still covers the viewer switch.
  - The saved-roster commit was skipped, as noted above.
- **F**: rebased with no conflicts.
- **E**
  - `claude-structured-session-close.ts`: the logger import follows its move to `agent-session-wire/host/`. `forgetStructuredClaudeSession` stays.
  - `claude-structured-launch-home.ts`: the pre-spawn error import follows its move to `agent-session-wire/providers/`. Our pool, proxy and registry imports are kept.

### Gates

On each branch:

- typecheck node, web and cli
- targeted vitest: every changed test file, plus `src/main/rate-limits/**/*.test.ts` and `runtime-composition-parity.test.ts`
- oxlint on changed files
- `check-changed-code-quality.mjs upstream/main`

The vitest counts are lower than in rebase #5 because upstream removed several thousand test cases between the two bases.

| branch | typecheck node/web/cli | targeted vitest     | oxlint | quality |
| ------ | ---------------------- | ------------------- | ------ | ------- |
| 0      | 0/0/0                  | 53 files, 285 pass  | pass   | pass    |
| B      | 0/0/0                  | 58 files, 321 pass  | pass   | pass    |
| C      | 0/0/0                  | 66 files, 372 pass  | pass   | pass    |
| D      | 0/0/0                  | 85 files, 501 pass  | pass   | pass    |
| F      | 0/0/0                  | 90 files, 538 pass  | pass   | pass    |
| E      | 0/0/0                  | 92 files, 550 pass  | pass   | pass    |

The first PR 0 runs caught a stale import and two budget overruns: `global-settings-types.ts` at 301 lines and `agent-session-failure-words.ts` at 303. The fixes above were folded into commit 1, and the table shows the re-run.

Full `check-changed.mjs --base=upstream/main --maxWorkers=2 --timeout=120` ran in parallel on the pushed SHAs. PR 0 `bc09ca7485b` took 68 min and E `d6ebc616765` took 68 min. Both had 29/30 checks pass, with "unit tests" the only ✗. Every unit failure is from the env-only list in earlier sections:

- `persisted-profile-state.unit` ×2
- `wsl-host-agent-launch-paths` ×5
- `pty-claude-agent-view-readiness` ×1, on E only

This round found no regressions.

**Land order: 0, B, C, D, F, E.** Standing rule unchanged: no rebase on my own while GitHub shows the six as mergeable.
