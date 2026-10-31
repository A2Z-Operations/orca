# Inactive Claude token refresh

Date: 2026-10-31. Branch: `nachumi-a2zoperations/inactive-token-refresh`, off `blowzer/session-mover` at `9c88f17a9eb`. Not pushed. No live account was refreshed.

## What the Studio showed

Build `1.4.244-blowzer.12`, Electron `--serve`. Usage polling runs at serve start (`14c86c8e23f`). The log was `[claude-usage] inactive fetch account=<id> failure=stale-token http=401` for every one of the nine inactive accounts, then `done n=9 ok=0 failed=9`. `orca account list` printed `weekly — (401)` for them. The active account was fine. All ten accounts are signed in. An access token is refreshed only when that account's own Claude Code process runs, so on an idle host the other nine go stale within hours. The same pattern showed up on the MacBook. The pool, the mover, and auto-switch cannot rank those accounts, and a proxy move onto one would 401 as well. The proxy token cache does not refresh on its own.

This pass did not SSH, did not dump a keychain item, and did not call the token endpoint with a real refresh token.

## What Claude Code's refresh does

Read from the local Claude Code `2.1.316` binary (`claude --version`, and the Mach-O image at `~/.npm-global/lib/node_modules/@anthropic-ai/claude-code/bin/claude.exe`). `strings` finds `https://platform.claude.com/v1/oauth/token` and the public client id `9d1c250a-e61b-44d9-88ed-5944d1962f5e` (`CLIENT_ID`). A second client id, `59637612-477b-4836-a601-b0589eda7704`, is the design client and is not used here. The Studio's Claude is 2.1.314. The request shape is the same function (`Xae`).

- `POST https://platform.claude.com/v1/oauth/token`
- Header: `Content-Type: application/json` only. Timeout 30s. No `anthropic-beta` header.
- Body: `grant_type=refresh_token`, the stored `refresh_token`, `client_id` (the item's `clientId`, or `CLIENT_ID` when the item has none), and `scope` (the scopes joined with a space). `expires_in` is not sent.
- Scopes: send the scopes already stored when the list is non-empty. When the item has no `clientId` and it either includes `user:inference` or has a `subscriptionType`, send Claude Code's default list plus any stored `user:projects:read` or `user:projects:write`. The default list (`m0t()`, plugins scope registered) is `user:profile`, `user:inference`, `user:sessions:claude_code`, `user:mcp_servers`, `user:file_upload`, `user:plugins`. An empty scope list falls back to that default.
- Success: `access_token` is required. `expires_in` is required and becomes `expiresAt = now + expires_in * 1000`. If `refresh_token` is omitted, keep the refresh token just sent. `refreshTokenExpiresAt` changes only when `refresh_token_expires_in` is a number. `scope` replaces `scopes` when it is a non-empty string, split on spaces. `subscriptionType` and `rateLimitTier` change only when the JSON includes them as strings (`subscriptionType` / `subscription_type`, `rateLimitTier` / `rate_limit_tier`). `clientId` changes only when the JSON includes `client_id`. The parsed object is mutated and `JSON.stringify`'d, so every other field keeps its place.
- `invalid_grant` is HTTP 400 or 401 whose JSON `error` or `code` is `invalid_grant`. Claude Code does not retry that. Other failures are retried later.

Claude Code then makes a second call to load the profile. This refresh does not. Write-back of the rotated token is not blocked on that profile call, so `subscriptionType` stays as it was unless the token JSON itself carries it.

`security find-generic-password -s <service> -w` without an account name returned exit 36 and an empty body in the earlier read. The item shape was taken from the credential reader and from Claude Code, not from printing a live item. Field names Orca already reads: `claudeAiOauth.accessToken`, `refreshToken`, `expiresAt`, `refreshTokenExpiresAt`, `scopes`, `subscriptionType`, `rateLimitTier`, `clientId`.

## Design

`refreshClaudeOAuthAccessToken` reads the same store Claude Code reads, posts the body above, and writes the rotated JSON back before anyone uses the new access token.

Reader, on darwin: the scoped keychain item `Claude Code-credentials` or `Claude Code-credentials-<8 hex sha256(configDir)>`, account name from `claudeKeychainAccount()`. A keychain document that has a refresh token wins. A locked keychain (any error that is not "not found") fails closed with `keychain-unavailable` and does not fall through to a file that might be older. A test double that omits the keychain helpers is a miss, and the file is read. Linux and Windows read the file only. The file is `<configDir>/.credentials.json`, or `~/.claude/.credentials.json` when no config dir is set. The unsuffixed keychain name is tried only when there is no `CLAUDE_CONFIG_DIR`.

Write-back uses the store the read actually used. Keychain: `security add-generic-password -U` with a literal argv (`-s` service, `-a` account, `-w` the JSON). File: `writeCredentialFileAtomic` on that same `.credentials.json` (mode 0600, fsync, rename). The new access token is returned only after that write resolves. A write that fails after the server has rotated the refresh token is kept in memory and retried on the next call before any new POST, including when the setting is off or a live Claude pane has since started. The old refresh token is not posted again.

One refresh per account is in flight. Callers share that promise.

A live Claude Code session is not refreshed. "Live" is `listClaudePaneAccounts()` having a pane whose spawn `accountId` is that account. The proxy's billing id (`assignedAccountId`) is not that check. The proxy refreshes the slot it is billing. If that slot is also the spawn account of a live pane, the refresh is skipped, because that process refreshes itself and a second rotation would invalidate its token. If the pane was spawned as one account and the slot bills a different idle account, the idle account is refreshed.

Failures other than `invalid_grant` back off 5 minutes, then 30. A call inside the window returns without extending it and without a POST. `invalid_grant` is lapsed: the stored credentials stay, there is no backoff, and the sha256 of that refresh token is remembered in memory (never logged). A later read whose refresh token hashes differently clears lapsed, which is what a new sign-in looks like. Success clears the book, sets `lastRefreshAt`, and clears lapsed.

The book is process memory only. It is not a credential file.

Setting `claudeAccountTokenRefresh` defaults to on in the fork (`default-global-settings`, and `!== false` so an older settings file that omits the key stays on). `orca account token-refresh --agent claude --on|--off|--status` writes it or prints the book: `Claude token-refresh: on|off`, then one line per account, `last <ISO or —>  next <ISO or —>  lapsed yes|no`. `--status` uses `accounts.list` with `refreshUsage: false`. `--environment` is allowed, because the book lives on the runtime that holds the accounts. RPC: `accounts.setClaudeAccountTokenRefresh`.

Usage: `fetchActiveClaudeRateLimits` is the shared fetch, so the selected account and the inactive accounts both refresh. On a 401 that still has a usable refresh token (`canClaudeRenewLogin`), the inactive cycle claims the account once (`beginClaudeOAuthRefreshCycle` just after the inactive `start` line) and retries the usage GET with the new access token. The pool, the mover, and auto-switch read those windows from the same rate-limit cache. This does not add a poller. A lapsed refresh token becomes `failureKind: 'lapsed'`. The window label is `lapsed` (before the HTTP 401 check), so `orca account list` prints `weekly — (lapsed)` and the existing sign-in hint. The result policy treats `lapsed` as terminal and does not keep old headroom. The accounts panel turns on the existing Sign in again action when `needsSignIn` or a usage row is `unavailable === 'lapsed'`. The status bar says Sign in again for that kind. A 401 whose refresh was skipped or failed stays `stale-token`, so the old cooldown rows stay `weekly — (401)`.

Proxy: `startClaudeAuthProxy` passes `refreshAccessToken`. On an upstream 401 for the slot account, the cache entry is dropped and the refresh runs under the same rules (in-flight, backoff, lapsed, live spawn). A body at or under the 8 MiB rewrite cap is not forwarded as 401; it is replayed once with the new bearer. A larger body is piped, and a 401 still refreshes so the next request sees the new token, but that request is not replayed. The mid-read overflow puts the already-consumed chunk back with `req.unshift` and then pipes. It does not call `request.write`, because the filesystem census treats a bare `write(` as a persistence primitive.

Log line, and only when a refresh was actually attempted: `[claude-usage] refresh account=<id> ok` or `failed=<reason>`. Reasons are `lapsed`, `network`, `http-<status>`, `malformed`, `write-failed`, `keychain-unavailable`, `unreadable`. Disabled, live-session, backoff, and no-refresh-token are silent. The token, the refresh token, the hash, and the response body are not logged.

## Ratchet

`claude-credential-persistence-ratchet.test.ts` allows exactly three kinds on `main/rate-limits/claude-oauth-refresh.ts`: `token refresh`, `keychain write`, `credentials file write`. That file is the one reviewed writer. Inactive accounts never run Claude Code, so Orca has to rotate the same item Claude Code will read the next time it starts. `KEYCHAIN_DELETE_OWNER` is still only `main/claude-accounts/claude-account-folder.ts`.

The census also flags `credentials file write through a name` when a `const` initializer contains `.credentials.json` and a later `write…(` call's next 300 characters mention that name or anything derived from it. The read path is `claude-oauth-credential-document.ts`. `credentialsFilePath()` holds the `.credentials.json` literal, so no const initializer contains it and that extra kind does not fire. The write stays in `claude-oauth-refresh.ts`, in the same statement as `writeCredentialFileAtomic`, so the allowed `credentials file write` kind still fires. The document reader, the scope helper, and the in-memory book do not contain `grant_type`, a `refresh_token` identifier, `oauth/token`, `add-generic-password`, or a write beside `.credentials.json`. A second, unlisted file that posts a refresh or writes the item fails the census. The test `still rejects a second file that refreshes or writes Claude credentials` locks that. The census was re-run after the split below and still passed, 33 tests.

## Files

Oxlint `max-lines` is 300 for `.ts` and 400 for `.tsx`, and a new `eslint-disable max-lines` is rejected by the ratchet. The token POST, the keychain update, and the credentials-file write stay in `claude-oauth-refresh.ts`. The book, the read, the scope choice, the proxy replay, and the list fields are separate files so none of those strings move onto an unreviewed path.

- `src/main/rate-limits/claude-oauth-refresh.ts` — token POST, apply the response, `invalid_grant`, write-back
- `src/main/rate-limits/claude-oauth-refresh-state.ts` — in-memory book, 5-then-30 backoff, one-in-flight map, usage-cycle claim
- `src/main/rate-limits/claude-oauth-credential-document.ts` — keychain-then-file read, fail closed when the keychain errors
- `src/main/rate-limits/claude-oauth-refresh-scopes.ts` — default scopes and which scope string is sent
- `src/main/rate-limits/claude-oauth-refresh.test.ts` — fake token endpoint, write-back shape, live skip, one-in-flight race, `invalid_grant`, backoff, pending write
- `src/main/rate-limits/claude-active-usage-fetch.ts` — 401, refresh once, retry the usage GET
- `src/main/rate-limits/claude-active-usage-refresh.test.ts` — 401-then-retry, once per cycle, lapsed, live pane
- `src/main/rate-limits/service/service-inactive-accounts.ts` — begin the cycle after the start line
- `src/main/rate-limits/service/service-result-policy.ts`, `src/shared/rate-limit-types.ts`, `src/main/claude-accounts/claude-account-usage-windows.ts` — `lapsed`
- `src/main/claude-accounts/claude-auth-proxy/claude-auth-proxy.ts` and `claude-auth-proxy-host.ts` — 401 refresh and one replay
- `src/main/claude-accounts/claude-auth-proxy/claude-auth-proxy-replay.ts` — buffer, `req.unshift` on overflow, replay once when the body is under the cap
- `src/main/claude-accounts/keychain.ts` — export `claudeKeychainAccount()`
- `src/main/claude-accounts/service.ts` — `setTokenRefresh` delegates to the selection
- `src/main/claude-accounts/claude-account-selection.ts`, `claude-token-refresh-list.ts`, `src/shared/claude-account-switch-settings.ts`, `src/shared/default-global-settings.ts`, `src/shared/managed-account-types.ts` — the setting and the list snapshot
- `src/cli/handlers/account-token-refresh.ts`, account spec, handler group, root help, `account-list-format.ts` — CLI
- `src/main/runtime/rpc/methods/accounts-model-policy.ts` — `accounts.setClaudeAccountTokenRefresh` next to the model-policy method; `accounts.ts` spreads that list
- the account controller, the command surface, `accounts-params.ts`, regenerated `rpc-params-catalog.generated.ts`
- `src/renderer/src/components/settings/accounts-pane-claude-section.tsx`, `usage-error-copy.ts` — Sign in again for `lapsed` (`claudeAccountNeedsSignIn`)
- `src/main/claude-accounts/claude-credential-persistence-ratchet.test.ts` — the one-file allowance and the second-writer rejection

## Tests

Node v24.22.0. After the line-cap split, `corepack pnpm exec vitest run --config config/vitest.config.ts --maxWorkers=2` on the related files: 11 files, 120 tests, all passed.

- `claude-credential-persistence-ratchet.test.ts` — 33, including the census and the second-writer rejection
- `claude-oauth-refresh.test.ts` — 11
- `claude-auth-proxy.test.ts` — 22, including the large streaming pipe and the 401 replay
- `claude-active-usage-refresh.test.ts` — 4
- `claude-profile-usage.test.ts` — 19
- `claude-managed-usage-credential-source.test.ts` — 3
- `service-inactive-claude-cooldown.test.ts` — 13
- `claude-auth-proxy-host.test.ts` — 2
- `claude-auth-proxy-model-rewrite.test.ts` — 3
- `account-list-format.test.ts` — 6
- `usage-error-copy.test.ts` — 4

`corepack pnpm exec oxlint` on the changed TypeScript files reported 0 errors, including `max-lines`. `corepack pnpm run typecheck:node`, `typecheck:web`, and `typecheck:cli` each exited 0 after the split. An earlier node run had failed because `ClaudeAccountService` did not delegate `setTokenRefresh`; `service.ts` does.

## Commits

Implementation: `323e666f907a26224f7501b6c8b0bd9c61495c67` — Refresh idle Claude account access tokens on usage and proxy 401s.

Not pushed.

## Risks

A refresh token is single-use. If a pane's spawn `accountId` is missing from the registry, Orca can rotate the token while that Claude Code process still holds the old one. The loser sees `invalid_grant`. Orca marks the account lapsed and does not delete the item. That account needs a sign-in.

A process crash after the server has rotated the refresh token and before the write lands lapses the account on the next start. The new refresh token existed only in memory. A failed write in the same process is retried from that memory and does not POST again. A crash is not that retry.

If the proxy can replay a 401 and the refresh returns null, the first upstream body was already discarded, so the client can see an empty 401. Over-cap requests are not replayed.

A 401 that fails for a reason other than `invalid_grant` stays `stale-token` for that cycle (`weekly — (401)`) and waits out the backoff. The user string for that row is still "Claude usage updates the next time Claude runs." `lapsed` is the row that asks for a sign-in.

The keychain path is darwin only, guarded at runtime. A locked keychain does not refresh from the file.

## Hand check on the next Studio install

Install this branch. Do not print tokens. After serve start, the nine idle accounts that logged `failure=stale-token http=401` should log `[claude-usage] refresh account=<id> ok` and the inactive fetch should finish `done n=9 ok=9 failed=0`. `orca account list` should show weekly percents for those accounts instead of `weekly — (401)`.

An account whose refresh token is rejected should show `weekly — (lapsed)`, the sign-in hint, and `lapsed yes` from `orca account token-refresh --agent claude --status`. An account with a live Claude pane should not get a refresh line. The account that was already healthy should stay healthy. A locked keychain should log `failed=keychain-unavailable` and should not write `.credentials.json` from a stale file.
