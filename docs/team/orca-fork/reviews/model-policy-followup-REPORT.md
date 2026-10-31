# Claude model policy follow-up: inactive windows and an immediate flip

Date: 2026-10-30. Branch: `nachumi-a2zoperations/fix-model-policy-ticker`, off `blowzer/session-mover` at `ab69753dc31`. Code commit: `077c2e2dc30`. Not pushed.

The account list already knew how to print an inactive window. The headless host never filled that cache. The ticker already started inside `orca serve`. A line change never asked it to look, so a forced flip produced no `model` row and no log line. Both are fixed here. The Studio service was left on build `1.4.244-blowzer.9` (`9b08f117626`) with `fable<90, weekly<91`. It was not restarted and its settings were not changed.

## What the Studio showed

Read-only, `ssh macstudio`, `PATH=/Applications/Orca.app/Contents/Resources/bin`. Emails omitted.

`orca account list` printed 10 Claude accounts. The active row was `sessions: 0  weekly 64% · fable 63%`. The other nine were `sessions: 0  weekly — · fable —`. The footer was `auto-switch: on`, `session-mover: move`, `pool: on`, `model-policy: on (fable<90, weekly<91)`, `auth-proxy: on`. `orca account model-policy --agent claude --status` printed the same lines. `grep -c claude-model-policy` on `~/Library/Logs/Orca/com.stablyai.orca.serve.log` was 0. `orca account moves --agent claude | grep -c model` was 0. `sessions: 0` means the chat that was open for the original report was already closed by the time of this read. `orca account list` takes no `--agent claude`; that flag is only for OpenCode and Devin.

## Root causes

**Inactive rows.** `formatWindowPercent` prints an em dash when the percent is null. The active account uses `state.claude` when the reading's provenance matches that account. Every other account uses `state.inactiveClaudeAccounts`. `fetchAll` does not fill that cache. `fetchInactiveClaudeAccountsOnOpen` runs on a mover or auto-switch `read-usage` decision, on a mobile refresh, and from the desktop panel. With weekly at 64 and Fable at 63, both under 90 and 91, neither the mover nor auto-switch asks for a read, so the cache stays empty for hours even while pool, auto-switch, and the mover are on. `limitsForAccount` in `claude-account-pool-launch.ts` reads the same cache, so pool ranking was blind to the same nine accounts. The list getter was not the bug, and it still has no fetch side effect.

**The flip.** `createClaudeModelPolicyTicker` is started from `createProviderClaudeSessionMover`, which `createOrcadAccountServices` always builds. The ticker was in the serve process. `start()` only subscribed to `rateLimits.onStateChange`, which does not fire on subscribe, and a settings write does not publish usage. The usage poll is 15 minutes. Three minutes of an unchanged statusline is no evaluation. The only previous log line was the strand `console.warn`, so a silent log was expected. A structured launch that does not pass `--model` or `ANTHROPIC_MODEL` already stamps `modelSource: 'policy'` through `resolveClaudeLaunchModel`. An explicit flag, `agentDefaultArgs --model`, or `ANTHROPIC_MODEL` already in the child env stays `pinned` on purpose, and the ticker skips it. macOS `orcad` does not copy a login-shell environment. Nothing under `src/main/orcad/` sets `ANTHROPIC_MODEL`. This host's serve log had no policy lines at all, which fits "the ticker never evaluated", not "every pane was pinned".

## Fix

Headless `createClaudeUsagePollingSwitch` now starts usage polling with `pollInactiveClaude: true` next to `pollWithoutWindow`. After each `fetchAll` (the immediate start and each 15-minute tick), `afterBackgroundFetch` calls `fetchInactiveClaudeAccountsOnOpen` when that flag is set. `stop()` clears the flag. The 60-second debounce still collapses a double call. The desktop app does not use this switch, so a desktop panel-open fetch is unchanged. Filling the cache fixes the list row and the pool ranking together.

The ticker subscribes to `store.onSettingsChanged` and evaluates when the update is a full settings snapshot or includes `claudeModelPolicy`. `start()` evaluates once immediately. Each pane is recorded and logged. Identical consecutive lines for one pane are dropped. A flip is logged on its own line, applied with `setClaudePaneModel`, then recorded so `--status` shows the model after the flip. Skip reasons are `policy-off`, `pinned`, `not-policy`, `unrecognized-model`, `stale`, `same`, and `cooldown`.

`setClaudeAuthProxySlotModel` logs `[claude-model-policy] proxy slot <slot> <from> → <to>` once when the recognized policy target changes. A pinned model does not log. The body is not logged.

`orca account model-policy --agent claude --status` prints the policy line and one evaluation per live pane: pane key, account, model, source, choice, reason, skip, and time. JSON is `{ modelPolicy, evaluations }`. `--on`, `--off`, and `--set` still print only the policy line. The evaluation list is omitted from `accounts.list` when it is empty, so older snapshots stay the same shape. The rows live in module memory, the same way flip history does.

## Files

- `src/main/rate-limits/service/service-state.ts`, `service-polling.ts`, `service-configuration.ts`, `service-inactive-accounts.ts` — headless inactive fetch after each background poll
- `src/main/claude-accounts/claude-usage-polling-policy.ts` — `pollInactiveClaude: true` on the headless switch
- `src/main/claude-accounts/claude-account-usage-windows.ts` — one reading helper for the list row, the ticker, and the same inactive cache the pool already used
- `src/main/claude-accounts/claude-model-policy-ticker.ts` — settings subscription, immediate evaluate, per-pane log
- `src/main/claude-accounts/claude-model-policy-evaluations.ts` — last evaluation per pane
- `src/main/claude-accounts/claude-account-selection.ts` — `modelPolicyEvaluations` on `accounts.list` when any exist
- `src/main/provider-claude-session-mover.ts` — ticker settings subscription and the shared usage reading
- `src/main/claude-accounts/claude-auth-proxy/claude-auth-proxy-slot-owners.ts` — one proxy line per slot change
- `src/cli/handlers/account-model-policy.ts`, `account-list-format.ts`, `src/cli/specs/account.ts` — `--status`
- `src/shared/managed-account-types.ts` — `ClaudeModelPolicyEvaluation`

## Tests

Node v24.22.0.

`pnpm check:changed --base=blowzer/session-mover --maxWorkers=2` saw 25 files since `ab69753dc31` and ran 22 checks in 1508.9s. 21 passed, including format, oxlint, changed-code quality, and `typecheck (tsconfig.node, tsconfig.tc.web, tsconfig.tc.cli)`. The only failure was the related unit suite.

That suite reported 24 failed tests. 23 are the commit-msg hook on this machine refusing fixture authors:

- `Test User <test@example.com>` in `runtime-git-stage-worktree-scope.test.ts` (1)
- `Test <test@example.com>` in `ephemeral-vm-provisioned-root-ref.test.ts` (4)
- `Orca Test <test@orca.invalid>` in `orca-runtime.test.ts` (1)
- `Worktree Removal <removal@example.invalid>` in `runtime-interrupted-local-worktree-removal.test.ts` (17)

The 24th is `claude-auth-proxy.test.ts` "cuts an idle stream at the configured budget and keeps an active stream" with `Error: aborted`. Re-run alone: 1 passed, 18 skipped, 1.1s. The same test failed inside the previous model-policy `check:changed` and passed alone there too. No `wsl-host-agent-launch-paths` failure and no pty failure in this run. None of the new or edited policy tests were in the 24.

An earlier direct vitest of the nine touched test files, before the lint fixes, was 35 passed. The related run after those fixes is the one above. The locks for this change are:

- `service-headless-polling.test.ts` — inactive fetch on each headless poll, and not after `stop()`
- `orcad-account-services.test.ts` — headless `start({ fetchImmediately, pollWithoutWindow, pollInactiveClaude })`, and a line change records a pane evaluation without a usage publish
- `claude-model-policy-ticker.test.ts` — fresh 64/63 usage at lines 90/91 stays on Fable; lines 1/1 flip to Opus with reason `fable-line` without a usage publish
- `claude-structured-pane-account.test.ts` — a structured launch with an empty env stamps `ANTHROPIC_MODEL=claude-fable-5-1` and `modelSource: 'policy'`; a launch `ANTHROPIC_MODEL` stays pinned
- `claude-account-usage-windows.test.ts` — active 64/63 from the selected reading, idle 12/8 from the inactive cache, unread stays null
- `claude-auth-proxy-model-log.test.ts` — `unset → fable` once, then `fable → opus`, no log for a pinned Sonnet, no `{` in the lines
- `account-model-policy.test.ts` and `account-list-format.test.ts` — `--status` human lines and JSON

A first `check:changed` on the unfixed tree failed three product checks and was not the result above: a type assertion in the usage-windows test, `claude-account-selection.ts` over the 300-line oxlint cap, and a narrowed `never` callback in the ticker test. Those are fixed in `077c2e2dc30`. The selection file calls `claudeModelPolicyEvaluations()` directly so it stays under the cap.

## Not covered

The installed Studio binary is still `1.4.244-blowzer.9`. This worktree was not installed and that service was not restarted, so the nine dashes are still what `orca account list` prints there. A live flip on that host waits for the next build. Whether the launchd job has `ANTHROPIC_MODEL` in its environment was not read; `--status` showing `source pinned` is the check. The `keepRecordedPreparation` error path still returns a preparation that has not been through `attachPolicyModel`. Desktop inactive fetches stay on panel open and `read-usage`. WSL guest `orcad` still starts only the auth proxy. A user `--model` stays pinned across a line crossing. Returning from Opus to Fable still waits out the 5-point band and the 10-minute cooldown.

## Hand check

Install the build that contains `077c2e2dc30` and let that install start `orca serve`. Do not treat a result from `1.4.244-blowzer.9` as this fix. On the Studio:

```sh
export PATH=/Applications/Orca.app/Contents/Resources/bin:$PATH
orca account list
```

Every signed-in Claude row should show `weekly N% · fable N%`, including the nine that are not active. The new process fetches them on startup, then again every 15 minutes. The pool ranks from that same cache.

Open one native Claude chat with no `--model` and with `ANTHROPIC_MODEL` unset in the serve environment. Then:

```sh
orca account model-policy --agent claude --status
```

Expect one pane line with `source policy` and `model fable` while the lines are 90/91 and the windows are still near 63/64. The serve log should contain `[claude-model-policy] started` and a pane line for that chat. If the line says `source pinned`, the launch command or the daemon environment set `ANTHROPIC_MODEL` or `--model`. Unset it and launch the chat again. A pinned pane is skipped on purpose.

Force the flip. This does not wait for the next usage poll:

```sh
orca account model-policy --agent claude --set fable-line=1 --set weekly-guard=1
```

With Fable at 63, the choice is Opus for `fable-line` (that check wins over the weekly guard). Within a few seconds, not minutes:

- `~/Library/Logs/Orca/com.stablyai.orca.serve.log` contains `[claude-model-policy] flip` with `fable → opus` and `reason=fable-line`, and `[claude-model-policy] proxy slot` with `fable → opus`. The proxy line names the slot only.
- `orca account moves` prints a row that ends in `model`.
- `--status` shows that pane with `choice opus`, `reason fable-line`, and no `skip`.

Put the lines back:

```sh
orca account model-policy --agent claude --set fable-line=90 --set weekly-guard=91
```

A return to Fable waits for the 10-minute cooldown. At 63/64 both windows are already 5 points under 90/91, so the first evaluation after the cooldown chooses Fable again.
