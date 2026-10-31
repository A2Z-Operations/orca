# Inactive Claude windows on Electron serve

Date: 2026-10-30. Branch: `nachumi-a2zoperations/fix-inactive-claude-usage`, off `blowzer/session-mover` at `173c7aa24a0`. Code commit: `d2b4528eded`. Not pushed.

`077c2e2dc30` armed inactive Claude usage only on the orcad switch. The Studio process is Electron `orca serve`, so that flag never turned on. `d2b4528eded` starts the same switch from the Electron serve window attach, keeps the timer running while that window is unfocused, and prints the reason a window is blank.

The running Studio service was left on `1.4.244-blowzer.10`. It was not restarted and its settings were not changed.

## What the Studio showed

Read-only, `ssh macstudio`, `PATH=/Applications/Orca.app/Contents/Resources/bin`. No tokens printed.

`orca --version` was `1.4.244-blowzer.10`. The serve process was Electron `Orca --serve --serve-port 6768` with `--user-data-dir=/Users/blowzer1/Library/Application Support/orca` (pid 59475), under the launchd agent `com.stablyai.orca.serve`. The plist sets `ORCA_USER_DATA_PATH` and `PATH` only. It does not set `ORCA_BACKGROUND_LAUNCH`.

`~/Library/Logs/Orca/com.stablyai.orca.serve.log` has `[claude-model-policy] started`, proxy slot flips, and a live pane on account `99e5fb1e-2170-4991-9244-8a4013b266c2` with weekly 64 and fable 63. It has no `[claude-usage]` line, no `[secrets]` withhold line, and no `window-shown` / `ready-to-show` line. The earlier hand check on this host printed ten Claude accounts: the active row `weekly 64% · fable 63%`, the other nine `weekly — · fable —`. An `orca account list --json` from this SSH session returned an empty account list (top keys `_meta, id, ok, result`). That CLI did not attach to the serve on port 6768. The ten profile homes under `claude-profiles/*/home` are the host's accounts.

All ten homes have no `.credentials.json` (`cred_bytes=0`). From this SSH session, `security find-generic-password -s "Claude Code-credentials-<hash>" -w` exited 36 for every home, including the active account. Exit 36 here is `User interaction is not allowed` on the login keychain. The same command through `launchctl asuser` exited 1, which is not exit 36 and not "item not found". Stderr was discarded, so exit 1 is not a verdict. SSH is not the GUI session the launch agent runs in.

## Root cause

Hypothesis 1 is the reason the rows stay dashes on build `.10`.

`createClaudeUsagePollingSwitch` passes `pollInactiveClaude: true` and `pollWithoutWindow: true`. The only caller before this commit was `createOrcadAccountServices`. Electron `--serve` never enters that function. It builds account services in `initializeMainProcessAccountServices` with `sessionMover.headless: false`, then `attachMainWindowCoreServices` calls `rateLimits.attach(window)` and `rateLimits.start({ fetchImmediately: false })`. `start()` sets `pollInactiveClaude` only when the option is `=== true`, so the flag stays false. `afterBackgroundFetch` returns immediately, and `fetchInactiveClaudeAccountsOnOpen` never runs. There was no log line for that fetch, so a quiet log was expected.

`shouldBackgroundPoll` also returned false for an attached window that was hidden, minimized, or unfocused, even when `pollWithoutWindow` was set. Serve mode still creates and attaches a `BrowserWindow`. The active percents do not come from this poll. They come from the live session statusline (`ingestLiveClaudeRateLimits`). The model-policy ticker starts from the session-mover factory and logs `[claude-model-policy] started` on its own. That is why the ticker could flip while nine rows stayed dashes.

Hypothesis 2 is a follow-on, not why the fetch failed to start. `readClaudeOAuthCredentials` already reads the scoped keychain item and, when that yields no token, `<configDir>/.credentials.json`. The auth-proxy token cache calls that same reader. It is not a second copy of the secret. On this host the file is absent in all ten homes. If the Electron agent can read the keychain, polling fills the percents. If the keychain denies the read, the old code cached an error and the list still printed a dash, because `claudeAccountUsageWindows` copied percents only when `status === 'ok'`.

Hypothesis 3 is the same display gap. `fetchActiveClaudeRateLimits` turns HTTP 401 and 429 into `status: 'error'` results. A throw in the inactive loop was caught and, when the account was still current, wrote nothing. Both looked like "not read yet".

## Fix

In serve mode, after `rateLimits.attach(window)`, `attachMainWindowCoreServices` uses `createClaudeUsagePollingSwitch` and subscribes to `store.onSettingsChanged`. It does not call `start({ fetchImmediately: false })`, which would clear the two flags. The desktop app still uses that deferred start, so a focused window is still required there.

`shouldBackgroundPoll` returns true when `pollWithoutWindow` is set, including when a window is attached and unfocused. Desktop `start()` does not set that flag, so the focus and visibility gate is unchanged.

Each inactive cycle that passes the debounce and in-flight guards logs:

```text
[claude-usage] inactive fetch start n=<count>
[claude-usage] inactive fetch done n=<count> ok=<n> failed=<n>
```

A non-ok account also logs `account=<id> failure=<kind>` and `http=<status>` when the usage endpoint returned one. The log does not include the error text, the token, the email, or the credential path. A thrown failure is stored on the cache with `failureKind` `keychain-unavailable` (exit 36 or "interaction is not allowed" or "keychain") or `unknown`. An abort still leaves no row.

The list row gains `unavailable`. The formatter prints:

- `weekly ? (keychain denied) · fable ? (keychain denied)`
- `weekly — (401) · fable — (401)` for HTTP 401, 403, or 429, and for a stale token
- `weekly — (sign in again)` when the login is missing and there is no HTTP status
- `weekly — · fable —` when the account has not been read

`httpStatus` is stored on `UsageRateLimitMetadata` from `OAuthUsageError.status`. The credentials-file fallback was already in `readClaudeOAuthCredentials`. A test now locks that a keychain throw still uses the file token, and that a throw with no file is `keychain-unavailable` on darwin.

## Files

- `src/main/startup/main-window-core-services.ts` — Electron serve uses the usage-polling switch
- `src/main/rate-limits/service/service-polling.ts` — `pollWithoutWindow` wins over an attached unfocused window
- `src/main/rate-limits/service/service-inactive-accounts.ts` — start/done log, and a cached failure instead of a swallowed throw
- `src/main/rate-limits/claude-active-usage-fetch.ts` — `httpStatus` on OAuth failures
- `src/main/claude-accounts/claude-account-usage-windows.ts` — `unavailable` on a non-ok reading
- `src/cli/handlers/account-list-format.ts` — `? (keychain denied)` and `— (401)`
- `src/shared/rate-limit-types.ts`, `src/shared/managed-account-types.ts`, `src/main/claude-accounts/claude-account-selection.ts` — the new fields

## Tests

Node v24.22.0.

`corepack pnpm exec vitest run --config config/vitest.config.ts` on the eight related files: 8 files, 66 tests, all passed.

- `service-headless-polling.test.ts` — an attached hidden, unfocused, or minimized window stays on the desktop gate unless `pollWithoutWindow` is set; with the headless flags it polls and reads inactive accounts
- `main-window-core-services.test.ts` — Electron serve starts `{ fetchImmediately: true, pollWithoutWindow: true, pollInactiveClaude: true }` when a usage feature is on, does not start when all of them are off, and the desktop path still uses `{ fetchImmediately: false }`
- `service-inactive-account-previews.test.ts` — start/done counts, `failure=keychain-unavailable`, `failure=stale-token http=401`, and the error text is not logged. The abort test still ends with no row
- `claude-profile-usage.test.ts` — keychain throw plus `.credentials.json` uses the file token; keychain throw with no file is `keychain-unavailable` on darwin and `missing-credentials` elsewhere. 401 and 429 results carry `httpStatus`
- `claude-account-usage-windows.test.ts` and `account-list-format.test.ts` — keychain denial, `401`, and an unread dash
- `claude-usage-polling-policy.test.ts` and `orcad-account-services.test.ts` — the orcad switch is unchanged

`corepack pnpm run typecheck:node`, `typecheck:web`, and `typecheck:cli` each exited 0.

## Not covered

Build `.10` is still what the Studio is running. This worktree was not installed. The nine dashes stay until a build that contains this commit replaces that process. Whether that Electron process can read the login keychain was not proven: SSH exit 36 and `launchctl asuser` exit 1 are different sessions from the launch agent, and the agent was not restarted. There is no `.credentials.json` to fall back to on this host today. If the agent is denied, the new row is `weekly ? (keychain denied)`, not a percent. Desktop polling is still focus-gated. WSL guest `orcad` still starts only the auth proxy.

## Hand check

Install the build that contains `d2b4528eded` and let that install start `orca serve`. Do not treat a result from `1.4.244-blowzer.10` as this fix. Do not print keychain or token output. On the Studio:

```sh
export PATH=/Applications/Orca.app/Contents/Resources/bin:$PATH
orca account list
grep '\[claude-usage\] inactive fetch' "$HOME/Library/Logs/Orca/com.stablyai.orca.serve.log"
```

Shortly after the new process starts, the log should contain:

```text
[claude-usage] inactive fetch start n=<inactive count>
[claude-usage] inactive fetch done n=<inactive count> ok=<n> failed=<n>
```

On this host the inactive count is 9 while one account is the active selection. `ok` plus `failed` counts the accounts that finished. An aborted account is in `n` and in neither total.

Then `orca account list` should no longer print a bare `weekly — · fable —` for an account the fetch finished:

- `ok` matches a row `weekly N% · fable N%`
- `failure=keychain-unavailable` matches `weekly ? (keychain denied) · fable ? (keychain denied)`
- `failure=stale-token http=401`, or `http=403` / `http=429`, matches `weekly — (401)` (or 403 or 429)
- `failure=missing-credentials` with no `http=` matches `weekly — (sign in again)`

The active row can still show the statusline percents. A later cycle is every 15 minutes. A plain SSH `security find-generic-password -w` exits 36 on this host even for the active account. That exit code is not the serve process's result. The `[claude-usage]` line is.
