# Experiment: can a running Claude Code session move to another account WITHOUT a restart?

Worktree: this checkout (`A2Z-Operations/orca`, branch `blowzer/session-mover`). This is a
READ-MOSTLY experiment on the MacBook; the only writes are to a throwaway credential store
that you back up first and restore at the end. Commit only the report, as
`Nachumi Eliyahu <nachumi@a2zoperations.com>` (no Co-Authored-By / AI trailers). Do not push.

## Background

The owner observed that `/login` inside a running Claude Code session switches the account
in-process (no restart). Orca already holds every managed account's credentials. The question:
if Orca writes account B's credentials into the credential store that a session running on
account A reads, does the running process start using B — and when (next request, on token
expiry, on 401, never)? If yes, the session mover gets a second, restart-free strategy.

## How the fork stores credentials (read first, do not guess)

- `src/main/claude-accounts/claude-profile-router.ts`, `claude-profile-provisioning.ts`
  (`.credentials.json`), `claude-account-folder.ts` + `keychain.ts` + `src/main/macos-keychain/`
  (macOS keychain item per config dir: see `claudeKeychainService` / `claudeConfigDirSpellings`).
- Managed account folders: `~/Library/Application Support/orca/claude-accounts/<id>/auth`;
  per-account profile homes `~/Library/Application Support/orca/claude-profiles/<id>/home`
  (launched with `CLAUDE_CONFIG_DIR` pointing there, see `ps -E` on a running `claude`).
- Work out whether a session launched with `CLAUDE_CONFIG_DIR=<profile home>` reads its OAuth
  token from `<home>/.credentials.json` or from a keychain generic-password item, and how that
  item is keyed. Report the exact store you ended up swapping.

## Accounts

Use two managed accounts that are NOT the active one (`hello@getblowzer.com`) and NOT the
leader's profile `9c633061-4a24-40ad-ab31-7cebe5ab8e58`. Pick two whose tokens work, e.g.
`blowzer1@sabrent.com` and `blowzer2@sabrent.com` (`orca account list`; ids in the settings
store). Call them A and B. Keep usage tiny: one-word prompts.

## Procedure (in a plain scratch folder, e.g. /tmp/token-swap-exp)

1. Back up A's credential store (file copy, or `security find-generic-password … -w` captured to a
   file with mode 600 in the scratch folder). NEVER print a token or a secret into the terminal,
   the report, or a log — redact to the first 6 characters if you must show structure.
2. Launch Claude the way Orca does for A: `CLAUDE_CONFIG_DIR=<A profile home> claude` in the
   scratch folder (non-interactive is fine: `claude -p 'say ok'` is NOT enough because the
   process must stay alive — use an interactive session in an Orca terminal you create with
   `orca terminal create`, and drive it with `orca terminal send` / `orca terminal read`).
   Confirm the account: `/status` (shows the login email) and/or the statusline usage line that
   Orca receives (`orca account list` shows per-account usage).
3. Without restarting, overwrite A's store with B's credentials (same format). Then:
   a. Send a one-word prompt. Which account answered? (`/status`, usage movement in
   `orca account list`, and the fork's statusline hook: the pane's account id in
   `~/Library/Application Support/orca/agent-hooks/last-status.json`.)
   b. If still A: force expiry — edit the stored `expiresAt` (or equivalent) to the past and
   prompt again; note whether the process re-reads the store or refreshes with the old
   refresh token.
   c. If still A: note whether a 401 would be needed (do not revoke real tokens).
4. Restore A's store exactly. Verify a fresh `CLAUDE_CONFIG_DIR=<A> claude -p 'ok'` works and
   that `/status` in a new session shows A. Close the experiment terminal.

## Report → `docs/team/orca-fork/reviews/token-swap-EXPERIMENT.md`

- Which store Claude Code reads with `CLAUDE_CONFIG_DIR` set (file vs keychain, key).
- Per step: what `/status` and usage showed; exact moment the process switched (or never).
- Claude Code version (`claude --version`).
- Verdict: feasible / not feasible for a mover strategy, plus what Orca must also update
  (pane→account registry, `claude-pane-account-registry.ts`) if it is.
- Confirmation that A's credentials were restored and that no secret appears in the report.
  `worker_done` with `--report-path`.
