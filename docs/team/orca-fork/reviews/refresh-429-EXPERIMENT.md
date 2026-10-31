# Refresh 429 experiments

Date: 2026-10-31. Studio build `1.4.244-blowzer.14`. Read-only over `ssh macstudio`. Serve was not restarted and was not reinstalled. Claude Code on the Studio is 2.1.314 (`/Users/blowzer1/.local/bin/claude`, bun Mach-O). No token, refresh token, keychain blob, or response body that carries one is recorded here.

## A. Claude Code’s own refresh

Profile home for `hello@getblowzer.com` (account `2c8e770b`, keychain service `Claude Code-credentials-f3a32e46`) came from `orca account list --json`. Command, with that home as `CLAUDE_CONFIG_DIR` and no `--bare`:

`claude -p "Reply with the single word pong." --max-turns 1 --output-format json`

Exit 0. The session text is the user line and the assistant word `pong`.

`expiresAt` on that keychain item, printed as that one number:

|        | expiresAt     | UTC                      | expiresInMin | mdat            |
| ------ | ------------- | ------------------------ | ------------ | --------------- |
| before | 1793376938594 | 2026-10-30T16:15:38.594Z | -1046        |                 |
| after  | 1793468507743 | 2026-10-31T17:41:47.743Z | 480          | 20261031094147Z |

The run took about 4 seconds. Claude Code refreshed this account on the Studio and the API accepted it.

The selected account `99e5fb1e` (`blowzer1@sabrent.com`, service hash `bc74aea6`) was not modified by this run. Its `expiresInMin` stayed 469 and its mdat stayed `20261031093042Z`.

`--debug` printed debug lines ahead of the JSON, and the capture did not keep a token-endpoint line. The debug file was deleted. The live proof is the moved `expiresAt`, the mdat, and `pong`.

Hypothesis (a), a host or IP penalty that blocks every refresh, is false. The same machine refreshed through Claude Code while Orca’s single hand refresh was still `failed=http-429`.

## B. Claude Code’s request shape

Taken from strings in the Studio 2.1.314 binary. The refresh function is `Pae`. It posts with axios 1.15.2 (`Mt.post`) through the Node http adapter.

- Method `POST`, URL `https://platform.claude.com/v1/oauth/token`
- Timeout 30000 ms, `maxRedirects: 0`, adapter `http`, `validateStatus` accepts 2xx
- Header names and the safe values: `Accept: application/json, text/plain, */*`, `Content-Type: application/json`, `User-Agent: axios/1.15.2`, `Accept-Encoding: gzip, compress, deflate, br`
- No `Authorization` on this call. No cookie. No `anthropic-*` or `x-*` header on the token POST
- Body field names: `grant_type`, `refresh_token`, `client_id`, `scope`. The normal caller does not send `expires_in`
- Client id and scopes already match `claude-oauth-refresh.ts` / `claude-oauth-refresh-scopes.ts`. Those were left as they are

Orca on `.14` posted the same URL and the same four body fields, with `Content-Type` only, through Electron `net.fetch` (`session.defaultSession`). That client sends a Chromium user-agent, can send cookies, and follows redirects.

Dummy refresh string, public client id, same Studio IP. No live token.

| User-Agent                                                                  | Status | API reached                        | request-id                   | cf-ray                                          |
| --------------------------------------------------------------------------- | ------ | ---------------------------------- | ---------------------------- | ----------------------------------------------- |
| python / curl default                                                       | 403    | no (Cloudflare text/plain)         | none                         | a531bfaa89782b73-LAX                            |
| axios/1.15.2 plus Accept and Accept-Encoding                                | 400    | yes (invalid dummy grant)          | req_011Cga75nykEBqfbvwpnTUjR | a531bfaaf9e35041-LAX                            |
| Electron-like `Mozilla/5.0 … Orca/1.4.244 Chrome/130.0.0.0 Electron/32.2.0` | 429    | Cloudflare JSON, no API request-id | none                         | a531bfac3aec4d90-LAX, then a531c00e480da0bf-LAX |

The 429 body is `{"error":{"type":"rate_limit_error","message":"Rate limited. Please try again later."}}`. A earlier Node https POST that sent only `Content-Type` and a real refresh token was accepted, so the extra axios headers are not what the API requires. The browser user-agent is what this edge answers with 429.

## C. The 429 our client gets

Reproduced with the Electron-like user-agent and a dummy token. This is not a line from the running serve, which does not log response headers.

- No `Retry-After`
- No `x-ratelimit-*`
- No `request-id`
- `cf-ray: a531c00e480da0bf-LAX`
- `content-type: application/json`, `server: cloudflare`, a `set-cookie` is present
- Error field: `error.type` = `rate_limit_error`. The message is `Rate limited. Please try again later.`

The log line this build should print for that response is `failed=http-429 retry-after=- error=rate_limit_error`.

## Collateral on hello@

A diagnostic Node https POST of the stored hello@ refresh token succeeded. cf-ray `a531b8f5a895f3e5-LAX`, request-id `req_011Cga6jYBwv6g3zQkmiTu37`. The script read `IncomingMessage.status` instead of `statusCode`, treated the success as a failure, and did not write the new refresh token back. The server had already rotated it.

The follow-up POST of the old refresh token is HTTP 400 `invalid_grant`, description `Refresh token not found or invalid`. cf-ray `a531bb27b8e6ed79-LAX`, request-id `req_011Cga6rAg5tTurcgRk8Gdtu`. No `Retry-After`, no `x-ratelimit-*`.

`hello@getblowzer.com` (`2c8e770b`) needs a sign-in again. The access token from Claude Code’s own refresh is still valid until `expiresAt` 1793468507743 (2026-10-31T17:41:47.743Z). Do not refresh this account. `invalid_grant` already becomes `lapsed` in the book. Hypothesis (c) is this one account, from the discarded write, and not the reason every Orca refresh returned 429.
