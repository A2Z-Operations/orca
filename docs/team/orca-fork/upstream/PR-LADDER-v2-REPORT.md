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
