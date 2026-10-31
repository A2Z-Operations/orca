# Refresh 429

Date: 2026-10-31. Branch: `nachumi-a2zoperations/oauth-refresh-429-fix`, parent `ce77644bfcb` (merge of refresh-pacing, which includes `546d9c51bee` and `323e666f907`). Not pushed. The Studio serve was not restarted and was not reinstalled. Experiment notes are in `refresh-429-EXPERIMENT.md`. No token, refresh token, or keychain blob is in either file.

## What the Studio showed

Build `1.4.244-blowzer.13` posted nine and then ten token refreshes in a few seconds. Every one logged `failed=http-429`. Build `.14` paces one POST at a time, waits 3 seconds, and honours `Retry-After`. A single hand refresh, `orca account token-refresh --agent claude --now hello@getblowzer.com`, still logged `failed=http-429`. The selected account `99e5fb1e` is `weekly — (401)` and its refresh 429s the same way.

Claude Code 2.1.314 on that same host refreshed `hello@getblowzer.com` during this investigation and answered `pong`. `expiresAt` moved from 1793376938594 to 1793468507743. The host is not in a penalty window. The request shape is.

## Root cause

Orca posted `https://platform.claude.com/v1/oauth/token` through Electron `net.fetch` on `session.defaultSession`. That client sends a Chromium user-agent. Cloudflare answers that user-agent with HTTP 429 and `{"error":{"type":"rate_limit_error","message":"Rate limited. Please try again later."}}`, with no `Retry-After`, no `request-id`, and no `x-ratelimit-*`. cf-ray `a531c00e480da0bf-LAX`.

Claude Code 2.1.314 function `Pae` posts the same URL with axios 1.15.2’s Node http adapter: `User-Agent: axios/1.15.2`, `Accept: application/json, text/plain, */*`, `Content-Type: application/json`, `Accept-Encoding: gzip, compress, deflate, br`, timeout 30 seconds, `maxRedirects: 0`. Body fields are `grant_type`, `refresh_token`, `client_id`, `scope`. Orca’s body and scopes already matched. A dummy token with the axios user-agent reached the API (HTTP 400, request-id `req_011Cga75nykEBqfbvwpnTUjR`). A python user-agent is Cloudflare 403 (cf-ray `a531bfaa89782b73-LAX`).

The existing pacer stays. There is no new host-wide 15-minute / 1-hour stop, and the account list does not grow a `(429, retry at <time>)` label. A real 429 still uses the shared strike and `Retry-After` cap from `546d9c51bee`.

## Fix

When the installed HTTP client owns a session (`proxySession()` set, which the Electron client does via `session.defaultSession`), the token POST uses `node:https` (or `node:http` for an `http:` URL). Headers are the axios set above. Cookies are dropped. Redirects are not followed. Timeout is 30 seconds. `gzip`, `x-gzip`, `deflate`, and `br` are decompressed. A client with no session, including the headless client and every unit-test mock, keeps `client.fetch`, and the POST init still sends the axios headers and `redirect: 'manual'`.

A 429 log line is now `failed=http-429 retry-after=<s> error=<code>`. The numeric header is logged as sent (`100000` stays `100000`) while the gate still caps the wait at 30 minutes. An HTTP-date is whole seconds from the pacer clock. A missing header is `-`. The code is `error.type`, then `code`, then a string `error`, one object deeper, and only if it matches `^[A-Za-z0-9._:-]{1,64}$`. The message and any token field are not logged. A body that is not JSON logs `error=-` and still opens the gate.

## hello@

A diagnostic Node POST of the stored hello@ refresh token succeeded (cf-ray `a531b8f5a895f3e5-LAX`, request-id `req_011Cga6jYBwv6g3zQkmiTu37`) and the server rotated the refresh token. The probe read `status` instead of `statusCode` and discarded the new token. The follow-up is HTTP 400 `invalid_grant`, `Refresh token not found or invalid` (cf-ray `a531bb27b8e6ed79-LAX`, request-id `req_011Cga6rAg5tTurcgRk8Gdtu`). Sign in again for `hello@getblowzer.com` (`2c8e770b`). The access token from Claude Code’s refresh remains valid until `expiresAt` 1793468507743 (2026-10-31T17:41:47.743Z). Do not refresh this account. `invalid_grant` already surfaces as lapsed.

Before the session check landed, one vitest run posted synthetic refresh strings (`must-not-be-used`, `old-refresh`, `unused`) at the live token URL. Those strings are not account tokens. Later runs use the injected client and do not connect.

## Files

- `src/main/rate-limits/claude-oauth-node-fetch.ts` — axios headers, Node http/https token POST, session check
- `src/main/rate-limits/claude-oauth-node-fetch.test.ts` — gzip 429, header set, cookie dropped, redirect not followed, abort, session vs injected client
- `src/main/rate-limits/claude-oauth-refresh.ts` — POST uses those headers, `redirect: 'manual'`, and `claudeOAuthTokenFetch`. Still the only keychain and credentials writer
- `src/main/rate-limits/claude-oauth-refresh-pacing.ts` — 429 result carries `retryAfter` and `error`
- `src/main/rate-limits/claude-oauth-refresh-state.ts` — log line
- `src/main/rate-limits/claude-oauth-refresh.test.ts` — header expectation and the redacted 429 line
- `docs/team/orca-fork/reviews/refresh-429-EXPERIMENT.md`, `refresh-429-REPORT.md`

## Tests

Node 24.22.0 (`$HOME/.n-orca`). `corepack pnpm exec vitest run --config config/vitest.config.ts` :

- `claude-oauth-node-fetch.test.ts` — 6, re-run after the typecheck fixes
- `claude-oauth-refresh.test.ts` — 18, including `failed=http-429 retry-after=10 error=rate_limit_error` and the nested `error.type`, with the planted secret and the message absent from the log
- `claude-active-usage-refresh.test.ts` — 5
- `src/cli/handlers/account-token-refresh.test.ts` — 3
- `src/main/claude-accounts/claude-credential-persistence-ratchet.test.ts` — 33, including the credential-writer census
- `claude-profile-usage.test.ts` — 19
- `service-inactive-claude-cooldown.test.ts` — 13
- `service-inactive-account-previews.test.ts` — 18

115 tests, 0 failures. `./node_modules/.bin/oxlint --config .oxlintrc.json` on the touched TypeScript files reported 0 errors. `corepack pnpm run typecheck:node`, `typecheck:web`, and `typecheck:cli` each exited 0 after the fetch body was passed as `Uint8Array` and the test header capture stopped narrowing to `null`.

## Commits

One commit on `nachumi-a2zoperations/oauth-refresh-429-fix`, parent `ce77644bfcb`: `Post Claude token refresh with axios’s node http client so Electron’s user-agent is not answered 429`. Both review docs are in that commit (`git add -f`; `docs/**` is gitignored). Not pushed.

## Hand check on the next Studio install

Do not install this branch onto the running Studio serve. After the next install, with `PATH=/Applications/Orca.app/Contents/Resources/bin:$PATH`:

1. Sign in again for `hello@getblowzer.com` before any refresh of that account. Its refresh token is `invalid_grant`. Leave it out of the check below.
2. `orca account token-refresh --agent claude --now <one idle email that is not hello@>` prints `refresh <email> ok`. Do not print the token. Do not use `--force` on an account that has a live Claude pane.
3. Confirm that account’s keychain `expiresAt` moved, by printing that one number. The serve log for a later 429, if one still happens, includes `retry-after=` and `error=`.
