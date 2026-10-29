# Proxy robustness

Date: 2026-10-29. Branch: `nachumi-a2zoperations/proxy-robustness-hardening` off `blowzer/session-mover` (`f050bb3b07`). Not pushed.

## What changed

The loopback Claude auth proxy still forwards each request once. Upstream 429 and 5xx, including `retry-after`, are written back as they arrived. There is no retry loop.

One `http.Agent({ keepAlive: true })` and one `https.Agent({ keepAlive: true })` are created per listener and destroyed on stop. The incoming `Connection` header is dropped so the agent sets its own. The request body is `req.pipe(upstreamReq)` after the token read, so a 300 KB `/compact` body is not buffered in the proxy. The response is `upstreamRes.pipe(res)`, which pauses the upstream when the client stops reading. The account id and bearer are captured before that pipe, so `assignSlot` during an SSE applies on the next request.

Node 26's default `requestTimeout` is 300000 and did not abort an in-handler request, a partial body, or an active SSE. `server.timeout` did. This listener sets `requestTimeout = 0`, `headersTimeout = 60_000`, and `server.timeout` plus the outgoing socket timer to `CLAUDE_AUTH_PROXY_IDLE_TIMEOUT_MS` (10 minutes). Tests inject 200 ms: an idle upstream ends inside that budget, and an SSE that writes every 40 ms runs to completion.

`stop()` calls `closeIdleConnections()` and then `server.close()`. It does not call `closeAllConnections()`. Idle keep-alives drop. An in-flight SSE finishes, and a request that arrives after `close()` is refused. `orcad-account-services.ts` already `await`s `stopClaudeAuthProxy()`. That file belongs to the account-services work; this change does not edit it.

## Token cache

A macOS `security` lookup of `Claude Code-credentials` on this machine, 7 runs, median 317.32 ms, minimum 315.35 ms. That is past the 5 ms re-read budget, so every platform uses a per-account cache with a 20 s TTL (`CLAUDE_AUTH_PROXY_TOKEN_TTL_MS`). `tokenTtlMs: 0` disables it. A null, empty, or thrown read is not stored. `readClaudeAuthProxyAccessToken` stays the uncached keychain and file read.

`RateLimitServiceFetchPolicy.rememberClaudeAuthSnapshot` calls `noteClaudeAuthSnapshot` before it replaces `lastClaudeAuthSnapshot`. The same `configDir` and provenance keep the cache. A different identity drops one account when provenance is `profile:<id>` or `profile:<id>:wsl:<distro>`, and drops every account for `system`, `wsl:<distro>:system`, `profile:unavailable`, or any other unnamed provenance. `service-account-refresh.ts` already sets `lastClaudeAuthSnapshot = null` when the account or target changes, so the next remembered snapshot invalidates. A token rotation that does not change `configDir` or provenance waits out the 20 s TTL. Loading `RateLimitService` from `src/main/rate-limits/service.ts` succeeded, so the host import does not cycle.

## Status

`orca account auth-proxy --agent claude --status` calls `accounts.claudeAuthProxyStatus` (`accounts-admin`, empty strict params). Text output is the endpoint (`host:port`, IPv6 bracketed, or `not listening`), each `slot → account`, `requests last hour: <accountId> <count>` sorted by account id, `unknown slots: N`, and `last error: <status> <method> <path> <accountId|->`. `--json` prints the same object. `--status` is exclusive with `--on` and `--off`.

`--status` is not in `CLI_BOOLEAN_FLAGS`. Orchestration `task-update` and `task-list` pass `--status <value>`. A bare `--status`, or `--status` followed by another flag, already parses as boolean `true`. The help line lives on `account auth-proxy` only, so other commands keep their own `--status` text.

The host log line stays `[claude-auth-proxy] <method> <path> <status> <accountId>`. The path has no query string. Slot ids are not logged. Known-account requests in the last hour include 4xx, 5xx, and 502. The unknown-slot counter is monotonic for the life of the process and is not an account row. `lastError` updates when status is 400 or higher and stays until a later error.

## Security

`createClaudeAuthProxy` throws `claude auth proxy only binds to loopback` when `bindHostIsNetworkExposed` is true. That helper allows `127.*` and `::1` and refuses `0.0.0.0`, `::`, other addresses, and hostnames such as `localhost`. The default bind remains `127.0.0.1`.

Slot ids are `randomBytes(16).toString('hex')`, with five collision retries. A request whose slot is not in the map is forwarded with its incoming `Authorization`, is not given a cached token, and increments `unknownSlotRequests`. Headers and bodies are not logged.

## Seams

Desktop shutdown in `src/main/startup/main-process-account-services.ts` is still `void stopClaudeAuthProxy()`. An in-flight stream is not awaited there. Orcad does await it.

The line-count lint split header copying, the token cache, and the hour window into `claude-auth-proxy-headers.ts`, `claude-auth-proxy-token-cache.ts`, and `claude-auth-proxy-request-log.ts`. The public proxy API is unchanged.

A client that never reads, and never closes, holds `server.close()` until the response ends or the 10 minute idle timer fires. `stop()` waits for that. The back-pressure test aborts its own client so the suite can finish.

## Verification

`corepack pnpm` fails on this Mac: `Cannot find module .../corepack/pnpm/12.14.0/bin/pnpm.cjs`. The runs used `/opt/homebrew/bin/pnpm` 12.14.0. That install added `@pnpm/exe` to `pnpm-lock.yaml`; the lockfile change is not part of this commit.

- `vitest run --config config/vitest.config.ts` on `claude-auth-proxy.test.ts`, `account-auth-proxy.test.ts`, and `accounts.test.ts`: 42 passed.
- `pnpm run typecheck:node` and `pnpm run typecheck:cli`: exit 0. Web was not run; the new status type is not imported by the renderer.
- `oxlint` and `oxlint --config config/oxlint-js-plugins.json` on the touched TypeScript, plus `ast-grep scan --config config/sgconfig.yml --min-severity warning` on the proxy directory: clean.

## Left

Not pushed. Desktop stop still does not await the proxy. A bearer that rotates without a snapshot identity change can be served for up to 20 seconds.
