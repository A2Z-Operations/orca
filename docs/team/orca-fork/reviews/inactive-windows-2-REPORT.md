# Inactive Claude windows on Electron serve, second pass

Date: 2026-10-30. Branch: `nachumi-a2zoperations/fix-inactive-claude-usage-2`, off `blowzer/session-mover` at `4c6ae71a5c4`. Code commit: `14c86c8e23f`. Not pushed.

`d2b4528eded` is in Studio build `1.4.244-blowzer.11` (fork-only `74f94ca7073`). `strings app.asar | grep -c "inactive fetch start"` is 1. Five minutes after start the serve log still has no `[claude-usage]` line. All ten `orca account list` rows print `weekly — · fable —`, including the active account, because no Claude session is open. On `.10` the active row showed numbers only while a session was open. This pass did not reinstall, restart, or change settings.

## What the Studio showed

Read-only evidence supplied with the task. This pass did not SSH.

launchd runs `~/.local/bin/orca serve --supervise --no-pairing --port 6768`. The supervisor spawns `/Applications/Orca.app/Contents/MacOS/Orca --user-data-dir=… --serve --serve-port 6768`. The log says `[serve] using Electron serve: packaged macOS serve stays on Electron so paired clients can still update it (orcad has no app updater)`.

After start the log has `[claude-model-policy] started`, `[agent-state-rules] download failed: HTTP 404`, `[serve] orca CLI install: installed`, and `Orca server ready`. It has no `[claude-usage] inactive fetch` line.

## Root cause

`d2b4528eded` started the usage switch only from `attachMainWindowCoreServices`. That function runs from `openMainWindow`. Supervised Electron `--serve` never opens a window during launch.

`initializeMainProcessRuntimeLaunch` returns after `launchServeMode` when serve options exist. `launchServeMode` does not call `openMainWindow`. A later desktop promotion can open a window (`requestDesktopActivation` → `focusExistingMainWindow` → `openMainWindow`). The running Studio child is the headless process. orcad's `createClaudeUsagePollingSwitch` does not run here: the log says Electron serve because orcad has no app updater.

`pollInactiveClaude` stays false. `afterBackgroundFetch` returns immediately. `fetchInactiveClaudeAccountsOnOpen` is never entered, so there is no start line and no skip line. The 60s debounce, the visibility gate, `fetchImmediately: false`, an empty account list, and the 15-minute interval do not explain a missing immediate line. `lastInactiveClaudeFetchAt` starts at 0, so the first call would not be debounced. The asar string only proves the function was compiled.

`[claude-model-policy] started` comes from the session-mover ticker. It does not mean usage polling started.

The active row is the same gap. `account list` reads the selected host account from `state.claude`. That field is filled by a live statusline or by the active OAuth cycle. With no session, and with polling never started, the active row is also `weekly — · fable —`.

## Fix

`launchServeMode` calls `armServeClaudeUsagePolling()` after the browser-identity line and before `printServeReady`. The switch starts `{ fetchImmediately: true, pollWithoutWindow: true, pollInactiveClaude: true }` when model policy, auto-switch, session mover, or the pool is on. Empty settings still poll, because session mover defaults to `ask`.

The same function stays on the window-attach path. If serve launch already armed it, a later window does not call `rateLimits.start({ fetchImmediately: false })`, which would clear the two flags. The window `closed` handler unsubscribes only the subscription that call installed. A committed quit calls `stopClaudeUsagePolling` and then `rateLimits.stop()`. A vetoed `before-quit` leaves both running.

Both Electron call sites log, including when the switch is off:

```text
[claude-usage] polling switch: mode=<desktop|serve> pollInactive=<bool> pollWithoutWindow=<bool>
```

A cycle that does not fetch logs:

```text
[claude-usage] inactive fetch skipped reason=<debounce|in-flight|no-accounts|not-attached|live-session|retry-after|already-read>
```

`not-attached` is logged when rate limits or the store are missing at launch, and when neither resolver is set. `no-accounts` is an empty poll list. Omitting the selected account logs `reason=<live-session|retry-after|already-read> account=<id>`. Debounce and in-flight return before the start line. An empty list still logs `start n=0` and `done n=0`.

The selected host account stays out of the inactive resolver. A live statusline for that account must keep landing on `state.claude`. The same poll fetches it when the live reading is stale or absent, when it is not in retry-after, and when this cycle's OAuth has not already covered it (`profile:<id>`, or `system` when the account runs on the system default, within 60s, source other than `live-session`). The result is written with `resolveClaudeFetchApply` onto `state.claude`. It is not stored in the inactive cache. WSL runtime accounts, and WSL selections that are not the host selection, stay out of this poll.

`account list` reads that `state.claude` row for the selected host account, so the active percents appear with no Claude session open.

## Files

- `src/main/startup/serve-claude-usage-polling.ts` — arm the switch once and log the mode
- `src/main/startup/main-process-runtime-launch.ts` — arm from `launchServeMode` before ready
- `src/main/startup/main-window-core-services.ts` — keep the window path, and leave a launch poll in place when a window opens later
- `src/main/startup/main-process-state.ts` — `stopClaudeUsagePolling`
- `src/main/startup/main-process-quit.ts` — stop the switch on a committed quit
- `src/main/provider-account-services.ts` — selected host account resolver, excluding a WSL runtime
- `src/main/rate-limits/service/service-selected-claude-usage.ts` — selected-account fetch onto `state.claude`
- `src/main/rate-limits/service/service-inactive-accounts.ts` — skip-reason logs; the start count includes the selected account
- `src/main/rate-limits/service/service-types.ts`, `service-state.ts`, `service-configuration.ts` — the resolver type and setter

## Tests

Node v24.22.0.

`corepack pnpm exec vitest run --config config/vitest.config.ts` on the ten related files: 10 files, 73 tests, all passed.

- `main-process-runtime-launch-activation.test.ts` — `initializeMainProcessReady` with serve options and `openMainWindow` throwing. No window. The inactive fetch is called once at start and again after `DEFAULT_POLL_MS` (15 minutes). The log line is `mode=serve pollInactive=true pollWithoutWindow=true`.
- `main-window-core-services.test.ts` — serve logs the true switch, desktop logs the false switch, and a window attach leaves a poll that serve launch already armed
- `service-inactive-account-previews.test.ts` — the selected account lands on `state.claude` with percents; a fresh live session and a same-cycle OAuth reading are skipped (`live-session`, `already-read`); a stale live session is replaced; `not-attached` and `no-accounts` are logged
- `service-headless-polling.test.ts`, `service-inactive-claude-cooldown.test.ts`, `claude-account-usage-windows.test.ts`, `account-list-format.test.ts`, `claude-usage-polling-policy.test.ts`, `orcad-account-services.test.ts`, `main-process-quit-update-veto.test.ts` — existing behavior

`corepack pnpm run typecheck:node`, `typecheck:web`, and `typecheck:cli` each exited 0. Pre-commit oxlint, js-plugins, ast-grep, react-doctor, and oxfmt passed on the 14 code files.

## Not covered

Build `.11` is still what the Studio is running. This worktree was not installed and the launch agent was not restarted. Whether that Electron process can read the login keychain is unchanged from the first report. If the keychain denies the read, the row is `weekly ? (keychain denied)`, not a percent. Desktop polling stays focus-gated. WSL selections that are not the host selected account stay out of this poll.

The first report's hand check assumed a serve window ran `attachMainWindowCoreServices`. That window is not created on the supervised Electron path. That is why `.11` contained the string and the log stayed silent.

## Hand check

Install the build that contains `14c86c8e23f` and let that install start `orca serve`. A result from `1.4.244-blowzer.11` is the previous binary. Do not print keychain or token output. On the Studio:

```sh
export PATH=/Applications/Orca.app/Contents/Resources/bin:$PATH
orca account list
grep '\[claude-usage\]' "$HOME/Library/Logs/Orca/com.stablyai.orca.serve.log"
```

Shortly after the new process starts, the log should contain:

```text
[claude-usage] polling switch: mode=serve pollInactive=true pollWithoutWindow=true
[claude-usage] inactive fetch start n=10
```

or, when the active OAuth cycle in the same poll already filled `state.claude`:

```text
[claude-usage] polling switch: mode=serve pollInactive=true pollWithoutWindow=true
[claude-usage] inactive fetch skipped reason=already-read account=<id>
[claude-usage] inactive fetch start n=9
```

Then a done line `inactive fetch done n=<same> ok=<n> failed=<n>`. A later cycle is every 15 minutes. The composition test advances `DEFAULT_POLL_MS` and sees the second call. The first fetch is immediate, so five minutes of silence is still a miss.

Then all ten `orca account list` rows should show a percent or an explicit unavailable reason, including the active account with no Claude session open:

- `ok` matches `weekly N% · fable N%`
- `failure=keychain-unavailable` matches `weekly ? (keychain denied) · fable ? (keychain denied)`
- `failure=stale-token http=401`, or `http=403` / `http=429`, matches `weekly — (401)` (or 403 or 429)
- `failure=missing-credentials` with no `http=` matches `weekly — (sign in again)`

A bare `weekly — · fable —` means that account was not read. The active row comes from `state.claude`. WSL-selected accounts that are not the host selection can still be a dash. That gap is unchanged.
