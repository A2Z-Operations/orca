# Refresh pacing

Date: 2026-10-31. Branch: `nachumi-a2zoperations/fix-oauth-refresh-pacing`, parent `ecbd9899a96` (merge of inactive-token-refresh, which includes `323e666f907`). Not pushed. The Studio serve was not restarted and was not reinstalled. No live account was refreshed, and no token or response body was printed.

## What the second poll showed

Build `1.4.244-blowzer.13` on the Studio, read-only over `ssh macstudio`. Log `~/Library/Logs/Orca/com.stablyai.orca.serve.log`. The usage lines are not timestamped. Times below come from the book's `nextRetryAt` minus the backoff that build applies, from the log file mtime, and from the Studio clock (PDT, UTC-7).

The first burst is lines 1983–2002. `inactive fetch start n=9`, then nine `refresh account=<id> failed=http-429`, each followed by `inactive fetch account=<id> failure=stale-token http=401`, then `inactive fetch done n=9 ok=0 failed=9`. The nine ids, in order:

- `93198762-768d-402b-9982-ce2654ff9b7b`
- `ce765e52-86df-4e60-a6b8-71368c9fc3ca`
- `146a3bed-1f9f-4fa9-ab24-c189187d22a4`
- `1af0d3e7-0700-47bf-b9cf-68ad229ba1ea`
- `2f17b5ed-7ea7-4426-bbd9-9e36e5896407`
- `eb07f8bc-f8c7-4f65-8c47-cdd0d6ae82b1`
- `5652180b-7abc-44bf-8cfa-109e53b8bb29`
- `1a8d17e0-85c5-4bfa-8aca-41d2591c47b9`
- `2c8e770b-f5af-41b3-bb2e-288cf0c9e20d`

The book's earliest `nextRetryAt` was `1793435493974`, which is 2026-10-31T08:31:33.974Z. That build's first failure waits 5 minutes, so the burst was 2026-10-31T08:26:33.974Z (01:26:33 PDT). The selected account `99e5fb1e-2170-4991-9244-8a4013b266c2` was `inactive fetch skipped reason=already-read` and was not in those nine POSTs. Its book had `lastRefreshAt` null and `nextRetryAt` null.

The next poll was observed. The log grew from 124456 bytes / 2006 lines to 126428 bytes / 2028 lines. File mtime was 2026-10-31 01:41:35 PDT, which matches the 15-minute poll at about 08:41:33Z. Lines 2007–2028 are a second burst, and it also 429'd. It was ten POSTs, not nine. The first line is `refresh account=99e5fb1e-2170-4991-9244-8a4013b266c2 failed=http-429`, then `inactive fetch skipped reason=already-read` for that id, then `inactive fetch start n=9`, then the same nine idle accounts, same order, each `failed=http-429` and still `failure=stale-token http=401`, then `inactive fetch done n=9 ok=0 failed=9`.

`orca account token-refresh --agent claude --status --json` after that poll (no token fields): token refresh on, 10 accounts. The selected account's next retry is 2026-10-31T08:46:33.285Z (5 minutes, its first failure). The nine idle accounts' next retries run from 2026-10-31T09:11:33.833Z through 09:11:35.082Z (30 minutes). The per-account counter persisted across the two polls and stepped 5 minutes to 30 minutes. It did not reset. They still fire together because they share an expiry and nothing spaces the POSTs. This build does not log `Retry-After`, response headers, or 429 bodies. A search of the serve log found no `Retry-After`. The body was not read.

The following 15-minute poll on that process (about 08:56Z) falls before the nine accounts' 09:11Z gate, so those nine should skip. The selected account's 5-minute gate ends at 08:46Z, so that poll can refresh it alone. That third poll was not waited on.

## Design

One token POST is in flight for the whole process. A promise tail runs the next POST only after the previous one settles, and a rejection does not break the tail. The first POST of the process does not wait. Every later POST waits `CLAUDE_OAUTH_REFRESH_MIN_GAP_MS` (3000) plus jitter of 0 through `CLAUDE_OAUTH_REFRESH_JITTER_MS` (1000) milliseconds, measured from when the previous POST finished. A call that leaves before the POST, because the shared gate is already active, does not consume that gap.

HTTP 429 does not use the old per-account 5-minute / 30-minute book. A process-wide strike is kept in memory. The first 429 of a burst sets it to 1 and opens a gate. Further 429s while that gate is active do not raise the strike and do not reset it. After the gate expires, the next 429 raises it. The ladder is 60 seconds, then 5 minutes, then 30 minutes, and it stays at 30 minutes. `Retry-After` is the wait instead of the ladder when the header is delta-seconds or an HTTP-date. A past date waits 0. A missing or unparseable header uses the ladder. The parsed wait is capped at 30 minutes. `Retry-After: 0` does not block, and the 3-second gap still spaces the next POST. The 429 body is not parsed. A successful refresh clears the strike. Starting a usage cycle does not. A non-429 HTTP failure still uses the old per-account schedule of 5 minutes and then 30.

`--force` skips the per-account `nextRetryAt` and the shared gate. It does not skip a live session, a disabled setting, a missing refresh token, the mutex, or the gap. A forced 429 while the gate is still active refreshes the gate at the same strike.

Each usage cycle plans at most `CLAUDE_OAUTH_REFRESHES_PER_CYCLE` (3) refreshes. Rank is `lastAuthenticatedAt`, most recent first, with the input order as the tie-break. The cursor is the last id that cycle took. The next cycle starts after it and wraps. Accounts the plan did not reserve still get their usage GET. The claim returns false, no POST runs, and the row stays `stale-token`. The poll does not drain the rest in the background. A live pane, a lapsed book, a per-account backoff, and an active shared gate are not reserved. While the shared gate is active the plan is empty and the cursor does not move. A slot that is free at plan time is not held open for an account that becomes eligible later in the same cycle. An account with no refresh token can still take a slot, because that is only known after the credential read.

The pool and the mover still rank by headroom. This change does not touch that ranking. Refresh priority is the most recently used account, which is the order the task asked for.

The auth proxy's 401 path still calls `refreshClaudeOAuthAccessToken`. It shares the serializer and the gate. It is not counted against the usage-cycle cap.

`orca account token-refresh --status` prints `queued #n` or `queued —`, and `backoff <level>`. JSON adds optional `queuePosition` and `backoffLevel`, so an older host still parses. A fresh success and a lapsed account have no queue position. Waiting accounts are numbered after the cursor, most recently used, wrapping. The printed next-retry for a waiting row is at least the shared gate. The read does not write the book.

`orca account token-refresh --agent claude --now <email|id>` refreshes one account on the runtime that holds the book (`accounts.refreshClaudeAccountTokenNow`, permission `accounts-admin`). It is not under the usage-cycle cap. It uses the same serializer, live-session skip, and backoff, unless `--force`. The result is `ok`, `skipped`, `failed`, or `lapsed`, plus a reason. The access token is not returned. Text is `refresh <email|id> ok`. `--now` without a value, `--force` without `--now`, and any mix of `--on` / `--off` / `--status` / `--now` is an error. An unknown id or email, or two accounts with the same email, is an invalid argument. A missing credential preparation returns `failed=unreadable` and does not POST.

## Files

Oxlint `max-lines` is 300 for these `.ts` files. The token POST, the keychain update, and the credentials-file write stay in `claude-oauth-refresh.ts` (298 code lines). The pacer does not contain `oauth/token`, `grant_type`, `refresh_token`, `add-generic-password`, or a write beside `.credentials.json`.

- `src/main/rate-limits/claude-oauth-refresh-pacing.ts` — mutex, gap, jitter, `Retry-After`, the shared strike, the per-cycle plan, the queue numbers
- `src/main/rate-limits/claude-oauth-refresh.ts` — the only poster and writer; calls the pacer
- `src/main/rate-limits/claude-oauth-refresh-state.ts` — book, including `backoffLevel`; cycle claim consults the plan; status rows
- `src/main/rate-limits/service/service-inactive-accounts.ts` — plan the slice, then fetch inactive accounts most-recently-used first
- `src/main/rate-limits/claude-managed-account-usage.ts` — optional `recentAt` on an inactive account
- `src/main/provider-account-services.ts` — `recentAt` is `lastAuthenticatedAt` for the inactive list and the selected account
- `src/main/claude-accounts/claude-token-refresh-now.ts` — resolve one account and refresh it
- `src/main/claude-accounts/claude-token-refresh-list.ts` — status rows for every account, not only the book
- `src/main/runtime/runtime-service-command-surface.ts` — `--now` uses `accounts.getSnapshot().claude.accounts`. The account controller was not given another method
- `src/main/runtime/rpc/methods/accounts-model-policy.ts`, `src/shared/rpc-contract/accounts-params.ts`, regenerated `rpc-params-catalog.generated.ts`
- `src/shared/managed-account-types.ts` — `queuePosition`, `backoffLevel`, and `ClaudeTokenRefreshNowResult` (no access token)
- `src/cli/handlers/account-token-refresh.ts`, `src/cli/specs/account.ts`, `src/cli/root-help-text-secondary.ts`
- tests: `claude-oauth-refresh.test.ts`, `claude-active-usage-refresh.test.ts`, `src/cli/handlers/account-token-refresh.test.ts`

## Tests

Node 24 (`$HOME/.n-orca`). `corepack pnpm exec vitest run --config config/vitest.config.ts --maxWorkers=2` on the related files: 7 files, 108 tests, all passed after the credentials path was put back inline (a `const` holding `.credentials.json` is the ratchet kind `credentials file write through a name`, which this file is not allowed).

- `claude-oauth-refresh.test.ts` — 17, including two POSTs in order with a 3000 ms gap, `Retry-After` seconds and HTTP-date and the 30-minute cap, the shared strike rising 60s → 5 min → 30 min across cycles without resetting on a burst, `--force` during the gate, a live session still skipped, three-per-cycle round-robin, queue numbers after the cursor
- `claude-active-usage-refresh.test.ts` — 5, including a 401 that stays `stale-token` when the cycle did not reserve the account
- `account-token-refresh.test.ts` — 3: `--now` calls `accounts.refreshClaudeAccountTokenNow` and prints `refresh <email> ok` without a planted access token, status prints `queued #2` and `backoff 1`, and the flag errors
- `claude-credential-persistence-ratchet.test.ts` — 33
- `claude-profile-usage.test.ts` — 19
- `service-inactive-claude-cooldown.test.ts` — 13
- `service-inactive-account-previews.test.ts` — 18

`corepack pnpm exec oxlint` on the touched TypeScript files reported 0 errors. `corepack pnpm run typecheck:node`, `typecheck:web`, and `typecheck:cli` each exited 0. `pnpm run check:runtime-electron-ratchet` exited 0 (`nothing reachable imports electron`). The CLI result type lives in `shared/managed-account-types.ts`, so the CLI graph does not import the token poster. Node was v24.22.0.

## Commits

One commit on `nachumi-a2zoperations/fix-oauth-refresh-pacing`, parent `ecbd9899a96`: `Pace Claude OAuth token refreshes so a usage poll cannot burst the token endpoint`. This report is in that commit. Not pushed.

## Hand check on the next Studio install

Do not install this branch onto the running Studio serve. `1.4.244-blowzer.13` has neither `--now` nor the pacer. After the next install, with `PATH=/Applications/Orca.app/Contents/Resources/bin:$PATH`:

1. `orca account token-refresh --agent claude --now <one idle email>` prints `refresh <email> ok`. A new process starts with an empty book, so the 30-minute gate from today's serve does not carry over. Do not print the token. Do not use `--force` on an account that has a live Claude pane. `--force` does not skip that pane.
2. Leave serve running. Each 15-minute inactive poll refreshes at most three accounts, most recently used first, at least 3 seconds apart, then retries those usage GETs. The others stay `stale-token` until a later cycle. Over a few cycles the log should reach `inactive fetch done n=9 ok=9`.
3. If the token endpoint still returns 429, expect one `failed=http-429` and the rest of that poll to skip. `orca account token-refresh --agent claude --status` shows `queued #n` and `backoff 1`, then `backoff 2`, then `backoff 3` across later polls. It should not show nine refreshes in the same second.
