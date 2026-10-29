# Proxy-swap experiment: can a running Claude Code session change API account without a restart?

Date: 2026-10-29. Claude Code **2.1.312**. Host: this MacBook. Branch: `nachumi-a2zoperations/proxy-auth-swap-experiment` (child of `blowzer/session-mover`).

No token, refresh token, or keychain password is in this report. Scratch copies under `/tmp/proxy-exp` were mode 600 and were deleted at the end. The proxy log recorded header names, the Authorization scheme, and a 12-hex SHA-256 prefix of the incoming bearer. It did not record the token.

## Verdict

**Feasible.** A loopback proxy that strips the incoming `Authorization` and sets another managed account's OAuth bearer changes which Anthropic account serves the turn. The Claude process does not restart, does not error, and does not notice that its own keychain token was not the one billed.

It is not, by itself, a session mover. `/status`, `.claude.json`, the transcript directory, and `claude-pane-account-registry.ts` stay on the account whose `CLAUDE_CONFIG_DIR` the process was spawned with. The screen still says account A while the API bills account B.

## Setup

Accounts, left as they were. `hello@getblowzer.com` and profile `9c633061-4a24-40ad-ab31-7cebe5ab8e58` were not used.

|     | Email                | Id                                     | Keychain service                     |
| --- | -------------------- | -------------------------------------- | ------------------------------------ |
| A   | blowzer1@sabrent.com | `fe40c723-9950-4265-a582-1ddaad34fbf6` | `Claude Code-credentials-2e13683e`   |
| B   | blowzer2@sabrent.com | `11acf92d-2350-4479-835f-57e5793f8baf` | `Claude Code-credentials-f87459d6`   |

Neither profile home had `.credentials.json`. Tokens were read once with `security find-generic-password -w` into mode-600 files. The proxy re-read `/tmp/proxy-exp/active` (`A` or `B`) on every request and set `Authorization: Bearer <that account>`. It forwarded method, path, query, and body to `https://api.anthropic.com`, dropped the incoming `Host`, and streamed the response. Listener: `127.0.0.1:18765`.

A direct `GET /api/oauth/usage` before any Claude prompt, and the same call through the proxy, agreed:

| Account | 5h utilization | 5h reset (UTC)   | Weekly | Weekly reset (UTC) |
| ------- | -------------- | ---------------- | ------ | ------------------ |
| A       | 0              | 2026-10-29 13:20 | 13     | 2026-11-02 01:00   |
| B       | 2              | 2026-10-29 09:40 | 76     | 2026-11-01 15:00   |

The usage endpoint's `resets_at` jitters by under a second between calls. The messages response uses the same windows as unix seconds: A `1793280000` / `1793581200`, B `1793266800` / `1793545200`. Those match the resets recorded in `token-swap-EXPERIMENT.md`.

Interactive `claude` in Orca terminal `term_57b98f75-238a-4ae2-83fc-28dad5b10f2c`, cwd `/tmp/proxy-exp`, then `exec claude`. The child (pid **43210**) had `ANTHROPIC_BASE_URL=http://127.0.0.1:18765` and `CLAUDE_CONFIG_DIR` set to A's home. No other `claude` was already on A or B. The folder trust prompt was accepted. The process was still pid 43210 at the end, session id `35bc62e9-1c25-4df1-8f28-3eec714b4bf4` throughout.

## What the API did

Every Claude messages call arrived with `Authorization: Bearer` whose token prefix was A's access token (`b9089d050a31`). There was no `x-api-key`. Other request headers: `user-agent: claude-cli/2.1.312 (external, cli)`, `anthropic-version: 2023-06-01`, `anthropic-beta` (including `claude-code-20250219` and `oauth-2025-04-20`), `anthropic-dangerous-direct-browser-access: true`, `x-app: cli`, `x-claude-code-session-id` (the session id above), and the `x-stainless-*` client headers. The response, not the request, carries `anthropic-organization-id`.

A's org is `5d615ba8-ac32-4f93-934b-03662881be2e`. B's org is `aa1c1b07-180f-4c41-b504-217a14f90e31`.

| Step | Active file | HTTP | Incoming token was the active account? | Response org | 7d header | Notes |
| ---- | ----------- | ---- | -------------------------------------- | ------------ | --------- | ----- |
| Startup probe | A | POST `/v1/messages` **429**, 313 bytes, 300ms | yes | A | none | `x-should-retry: true`. No retry followed. Body was not logged. The prompt still appeared. |
| `ping` | A | 200, 2686ms, SSE | yes | A | 0.13 | Answer: "pong — I'm here." |
| `pong` | B | 200, 2583ms, SSE | **no** | **B** | **0.76** | Answer: "Ready when you are." Retry count 0. |
| `ping` | A | 200, 2182ms, SSE | yes | A | 0.13 | Answer: "pong". |
| Tool turn, first hops | A | 200, ~1.2s, SSE | yes | A | 0.13 | See below. |
| Tool turn, after the flip | B | 200, 1230ms, SSE | **no** | **B** | **0.76** | Same pid, same session. |
| Count 1–40, then sleep-finished | B | 200, SSE | no | B | 0.76 | Lines 1 through 40 arrived. |
| `/compact` | B | POST messages 200 (1495ms, 268719 bytes, SSE) and POST `/v1/messages/count_tokens` 200 (197ms, 14408 bytes) | no | B | 0.76 | Then a local hook stall, below. |
| `ping` after compact | B | 200, 2659ms, SSE | no | B | 0.76 | Answer: "pong". |

The 7d header is a fraction: `0.13` is A's 13%, `0.76` is B's 76%. On the `pong` request B's 5h header was `0.01` while `GET /api/oauth/usage` still reported utilization 2. The org id and the weekly fraction are the identity proof. Stainless retry count stayed 0 on every 200. Messages responses were `text/event-stream`. Usage calls through the proxy took 149ms and 221ms. Message turns took 1.2–2.7s, of which the first success reported `server-timing` origin 249ms. The proxy is not the slow part.

`HEAD /api/hello` during startup had no incoming Authorization (user-agent `Bun/1.4.4`). The proxy still attached A's bearer. Status 200.

One extra short POST (4261 bytes, 200, account A) landed between the third `ping` and the tool turn. It was not an error. I did not identify its purpose.

## What the session showed

**`/status` at startup, and again after the swaps and after compact.** Version 2.1.312. Login method Claude Max. Email `blowzer1@sabrent.com`. Organization `blowzer1@sabrent.com's Organization`. Session `35bc62e9-1c25-4df1-8f28-3eec714b4bf4`. Anthropic base URL `http://127.0.0.1:18765`. Model opus (`claude-opus-5-5`). Managed settings: "not fetched — not available with a custom ANTHROPIC_BASE_URL". Organization policy: "not fetched with a custom ANTHROPIC_BASE_URL".

`.claude.json` `oauthAccount.emailAddress` was still `blowzer1@sabrent.com` after the run. The profile statusline is `ccstatusline`. It showed context percent, not an account email, and it did not change with the active file.

The Usage tab, opened once while the active file was A, showed session 0% resetting 6:19am Pacific and week 13% resetting Nov 1, 4:59pm Pacific. That is A's window. Claude did not `GET /api/oauth/usage` through the proxy for that tab. The numbers match the ratelimit headers on the preceding messages response. The tab was not opened again after a B turn, so this run does not show whether that screen follows a later swap.

## Utilization did not tick

`GET /api/oauth/usage` with each token, before the prompts and after the third `ping`:

- A stayed 5h 0 / weekly 13.
- B stayed 5h 2 / weekly 76.

Several billed turns were not enough to move a whole percent. B's five-hour window then reached its reset (`2026-10-29T09:40:00Z`) while later turns were still running. A read after that returned B at 5h utilization 0 with `resets_at` null, weekly still 76. Both tokens still returned HTTP 200, so neither login was invalidated. The "B's session window must move only for pong" check cannot be read off these integers. The messages response org and weekly fraction moved with the active file, and only with it.

## Strip, tool, sleep, compact

The proxy always discarded the incoming bearer. The `pong` turn is the case the procedure asks for: the process's own keychain token was not forwarded, B's bearer was, and Claude accepted the stream with no retry. The same was true of every later B turn, including the one after compact.

Tool turn, active file A, then flipped to B as soon as the next messages response headers arrived: Bash `echo tool-ok` and a background `sleep 60`. The screen showed `tool-ok` and task id `bwuj5gvvt`. `sleep 60` was pid 76931, parented by pid 43210. The following messages hop was account B (org B, incoming token still A's). The sleep process was still alive after that response. It later exited 0, and the same session printed that completion. Nothing restarted.

`/compact` sent the summary and `count_tokens` through the proxy (both 200, account B, bodies 268KB and 14KB, no timeout). The UI then sat on "Running SessionStart hooks… 2/3" for over three minutes with no further proxy traffic. The live child was `explanatory-output-style` `session-start.sh`, a local plugin hook that only prints a JSON blob. I killed that stuck hook. Claude then showed "Compacted", context 0.0%, a successful PostCompact hook, and a non-blocking "SessionStart:compact hook error" with no stderr. That error is the killed hook, not an API failure. The same pid answered `ping` afterwards. Context read 13.1% again after that ping, the same neighborhood as before compact (12.9–13.1%), which is consistent with the system prompt rather than the summarized turns.

## Keychain

B's item was unchanged across two reads: 9843 bytes, blob prefix `3885db0d7ec6`, access-token prefix `c56f5193165b`, `expiresAt` `1793291462484`.

A's item grew during the session from 2551 bytes (blob prefix `4e33c6cf3639`) to 6574 bytes (blob prefix `5a86fab540e7`). The access-token prefix stayed `b9089d050a31` and `expiresAt` stayed `1793287548761`. A second read overwrote the mode-600 backup, so the 2551-byte pre-image cannot be restored and the refresh-token bytes were not compared. The proxy never wrote the keychain. The growth happened on the profile whose MCP servers this launch started (59 connected). The item already contained `mcpOAuth` before the launch and had 16 `mcpOAuth` entries after. This is not the refresh-token rotation seen in `token-swap-EXPERIMENT.md`.

## Design sketch

Put the proxy in **orcad**, on the execution host, bound to loopback the way `ORCAD_LOOPBACK_BIND_HOST` already is (`src/main/orcad/orcad-bind-address.ts`). The PTY and `CLAUDE_CONFIG_DIR` live on that host. A proxy inside the desktop process would miss SSH and WSL sessions and would die with the window. One listener, with a per-pane slot (pty id to account id). A single global "active account" file would cross panes.

`ClaudeProfileRouter.launchEnv()` and `launchEnvFor()` (`src/main/claude-accounts/claude-profile-router.ts`) already set `CLAUDE_CONFIG_DIR` for a launch Orca makes. That is the place to add `ANTHROPIC_BASE_URL` pointing at the orcad listener. Do not put the bearer in the environment. The process keeps reading its own keychain item. The proxy replaces the header.

`claude-pane-account-registry.ts` records the account from `CLAUDE_CONFIG_DIR` at spawn and treats it as fixed for the life of the PTY. A flip has to update that record, or quota, auto-switch, and the session mover keep treating the pane as A. `inferClaudeAccountIdFromTranscript` will also keep reporting A, because the jsonl stays under the spawn directory. `/status` will keep showing A's email. Those are product bugs if the pane is presented as moved. The resume move remains the path that actually changes the spawn account. The proxy is how a live process spends a different account without that restart.

Token reads should go through `readClaudeOAuthCredentials` (`src/main/rate-limits/claude-oauth-credentials.ts`), the same scoped-keychain read `fetchActiveClaudeRateLimits` uses. Re-read on each request, or on a TTL shorter than the access token. Do not refresh inside the proxy. `claude-active-usage-fetch.ts` already says only a user-started Claude process may refresh the login. A proxy refresh would rotate the refresh token and write it back into whichever keychain slot Claude believes is its config dir, which is the failure in the earlier experiment. After a flip, Orca's usage poll for that pane must use the account the proxy is spending. Polling the spawn account would keep showing A's windows while B is billed.

## Left as it was

The experiment terminal was closed. Pid 43210 is gone. The listener is stopped. Token files and keychain backups were deleted. Both usage endpoints still returned 200 at the last check (A 0/13, B 0/76 after B's five-hour reset). No keychain write was issued by this experiment. The report is the only file added.
