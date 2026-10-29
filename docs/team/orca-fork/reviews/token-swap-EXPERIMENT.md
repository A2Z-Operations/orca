# Token-swap experiment: can a running Claude Code session change accounts without a restart?

Date: 2026-10-29. Claude Code **2.1.312**. Host: this MacBook. Branch: `blowzer/session-mover`.

No token, refresh token, or keychain password is in this report. Scratch copies under `/tmp/token-swap-exp` were mode 600 and were deleted after restore.

## Store that was swapped

With `CLAUDE_CONFIG_DIR` set to a managed profile home, Claude Code 2.1.312 reads OAuth from the macOS login keychain, not from `<home>/.credentials.json`. Neither profile home had a `.credentials.json`. Orca's own reader reports `credentialSource: scoped-keychain` for both accounts, and it tries that item before the file (`readClaudeOAuthCredentials`).

The item is a generic password:

- Service: `Claude Code-credentials-` plus the first 8 hex characters of SHA-256 over the config dir (NFC). This is `claudeKeychainService` in `src/main/claude-accounts/keychain.ts`.
- Account attribute: the macOS username when it matches `^[a-zA-Z0-9._-]+$` (here, the login user). Otherwise Claude uses `claude-code-user`.
- Password: JSON. Both accounts had `claudeAiOauth` (`accessToken`, `refreshToken`, `expiresAt`, `refreshTokenExpiresAt`, scopes, subscription fields). B's item also had `mcpOAuth`.

The swapped item was A's service, `Claude Code-credentials-2e13683e`, for:

`/Users/nachumieliyahu/Library/Application Support/orca/claude-profiles/fe40c723-9950-4265-a582-1ddaad34fbf6/home`

B's service, left in place until the refresh below, was `Claude Code-credentials-f87459d6`.

There is no `~/Library/Application Support/orca/claude-accounts/<id>/auth` directory for these two accounts. The profile home plus this keychain item is the store.

Claude's own binary caches a successful keychain read for 30 seconds (`R4t=30000`) and, on a later 401, can re-read the keychain (`tengu_oauth_401_recovered_from_keychain`). The run below is what actually happened.

## Accounts

|     | Email                | Id                                     | Not used                       |
| --- | -------------------- | -------------------------------------- | ------------------------------ |
| A   | blowzer1@sabrent.com | `fe40c723-9950-4265-a582-1ddaad34fbf6` | active account, leader profile |
| B   | blowzer2@sabrent.com | `11acf92d-2350-4479-835f-57e5793f8baf` | active account, leader profile |

Active account `hello@getblowzer.com` and leader profile `9c633061-4a24-40ad-ab31-7cebe5ab8e58` were not modified. No other `claude` process had `CLAUDE_CONFIG_DIR` pointed at A or B.

Pre-experiment `orca account list` (cached poll, `scoped-keychain`, status ok): A session 5% / weekly 13%; B session 1% / weekly 76%. That cache did not refresh during the run (`updatedAt` unchanged), so it never showed the swap. Live identity after the refresh was checked with `GET https://api.anthropic.com/api/oauth/usage` and compared to those windows.

## What the session did

Interactive `claude` in an Orca terminal (`term_6852074c-e376-45b9-9129-2f99d1806522`), cwd `/tmp/token-swap-exp`, `CLAUDE_CONFIG_DIR` set to A's home. `ps` confirmed the child had that directory. The profile's statusline command is `ccstatusline`, not Orca's hook, so this session did not post an Orca usage line.

**Startup `/status`.** Version 2.1.312. Login method Claude Max. Email `blowzer1@sabrent.com`. Organization `blowzer1@sabrent.com's Organization`. Session `5f6e8593-f907-4de6-8ed7-8af3c0277437`.

**3a. B's keychain password copied into A's service. Prompt: `ping`.** Answered normally (`Pong`). The keychain item was not rewritten. `/status` still showed `blowzer1@sabrent.com`. `.claude.json` `oauthAccount.emailAddress` stayed `blowzer1@sabrent.com`. No file under A's home mentioned B's org id `aa1c1b07-180f-4c41-b504-217a14f90e31`. About 46 seconds had passed since process start, longer than the 30-second keychain cache, and the store still did not change, so this prompt did not refresh.

`last-status.json` has an entry for this pane. Its transcript path is under A's profile home (`fe40c723-…`). There is no account-id field on that entry that flipped to B. Attribution follows the config directory the process was spawned with.

`/status` is the login saved in `.claude.json` at startup. It stayed on A even after the refresh in 3b, so it is not proof of which access token served `ping`.

**3b. Stored `expiresAt` set to `1`, then 35 seconds, then prompt: `pong`.** Answered normally. A's keychain item was rewritten in place. It kept B's shape (`mcpOAuth` still present, same byte size as B's original item) and received a new `expiresAt`. The usage endpoint on that new access token matched B, not A: five-hour utilization 2 with B's session reset (~`1793266800456`), seven-day utilization 76 with B's weekly reset (~`1793545200456`). B's previous access token then returned 401. A's original access token, still in the backup file, returned 200 with weekly utilization 13 and A's weekly reset (~`1793581199907`).

So the process re-read the keychain and refreshed with the refresh token stored there (B's). It did not refresh the access token it had loaded for A at startup. `/status` after `pong` still showed `blowzer1@sabrent.com`. `.claude.json` email did not change.

**3c.** A 401 on the in-memory token was not required. Putting the stored `expiresAt` in the past was enough for the next prompt to take the refresh path. The binary's 401 keychain recovery was not exercised.

## Restore

The experiment process was killed before it could refresh again. The rotated blob was written onto B's own keychain item, because B's pre-experiment access token was already 401. A's item was then replaced with the exact backup (same SHA-256 as the mode-600 backup; byte length 559, `mcpOAuth` absent again).

After that:

- Usage endpoint: A returned 200, weekly utilization 13. B returned 200, weekly utilization 76 (session utilization 2, up from the pre-experiment 1).
- Fresh `CLAUDE_CONFIG_DIR=<A home> claude -p 'ok'` completed and answered.
- A new interactive session's `/status` showed `blowzer1@sabrent.com`, organization `blowzer1@sabrent.com's Organization`, session `1fef1c1f-1781-44c7-bf13-1e4d44785ac2`.
- The experiment terminal was closed. No `claude` process was left on A's config dir.

B's keychain item is the rotated document, not the original bytes. It is the working credential. A's item matches the backup exactly.

Launching Claude also trusted `/private/tmp/token-swap-exp` and wrote session files under A's profile home. `oauthAccount.emailAddress` there is still `blowzer1@sabrent.com`.

## Verdict

**Not feasible** as a restart-free session-mover strategy.

Overwriting the keychain does not switch the running process on the next prompt while its in-memory access token is still valid. `/status`, `.claude.json`, and the transcript path Orca records all stay on A. The process does adopt the refresh token currently in the keychain, but only on a refresh. A stored `expiresAt` in the past was enough to force that on the following prompt, and the API identity became B while the UI still said A.

That refresh is also the wrong tool for a mover. It rotates the refresh token and writes the new blob back into the config dir's keychain item (A's slot), which logged B's previous token out until the rotated blob was copied back. A mover that did this would have to catch that write or it destroys the account it was trying to spend.

`claude-pane-account-registry.ts` would not follow the switch even if the API calls did. It records the account from `CLAUDE_CONFIG_DIR` at spawn and treats that as fixed for the life of the PTY. `last-status.json` attributes the pane by the transcript path under that same directory. Quota, auto-switch, and the session mover would keep treating the pane as A. Those would have to be updated as well, and `/status` would still show the original email, which is a wrong identity on screen. That is not a second strategy next to the resume move. The resume move remains the one that actually changes which account a pane is on.
