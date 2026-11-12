# Restore: live agent PTYs stopped by an account-switch restart (Fixes #26)

Branch `fix/restore-reattach-agent-ptys` off `blowzer/fork-only` (cff89c35c5f). The trace below is
what the patch builds on; review round 1 corrected its counts (8 kills, not nine) and where the
Z8 Features shell came from.

Logs: `daemon.log` and `main.trace.ndjson` under the app's `logs/` folder. Times are UTC,
2026-11-12 unless noted.

## Who stopped the PTYs

- The daemon client that issued every stop is `553ba6ef`. It connected at 2026-11-11T19:43:32.421Z
  (`daemon.log:13522`, `client-hello-accepted`), so it is the **pre-restart** app.
- The new main process started at 00:39:49.512Z (`main.trace` `main_process_lifecycle_started`); its
  clients connected at 00:39:52. The old app reported `provider-exit quit:true` at 00:39:45.
- So the stops came about 85 s before the quit, from the old app, not from the new runtime's
  restore. The daemon reattached everything still alive across the restart.

## Why those PTYs

- All 8 stopped PTYs were last billed to the account that had answered 429 since 00:23:57Z; their
  replacements land on the next account.
- No mover `moving` decision precedes them, which fits the switch path:
  `handleRunningClaudeSessionsAfterSwitch` → `queuePaneAccountRestarts` for every pane on the old
  account (reached by the auto-switch or by a switch by hand; the logs do not tell which).

## The 8 kills (`daemon.log:13922–13953`, 00:38:22.599–00:38:23.705Z)

Each is `session-exited cause=operator_close` + `session-killed immediate` from client `553ba6ef`.

| #   | PTY                                    | Path                                                          | Afterwards                                                                                                                  |
| --- | -------------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 1   | `z8-features@@6480602d`                | worktree, unmounted: detached restart (`replacesPtyId` spawn) | back at once as `@@6ba2e86c` (00:38:23.006), command of the same length (343)                                               |
| 2   | `pr35-fixes@@41943be…`                 | worktree, unmounted                                           | back at once as `@@eee1d688` (00:38:23.015)                                                                                 |
| 3   | `review-pr39@@87ff8849`                | worktree, unmounted                                           | back at once as `@@bab2a331` (00:38:23.021)                                                                                 |
| 4   | `review-pr40@@1474f6e8`                | worktree, unmounted                                           | back at once as `@@dd4416ee` (00:38:23.540)                                                                                 |
| 5   | `folder:a5fce7ec…@@05e59320`           | folder tab, mounted: `handleRestartPane`                      | **agent lost**                                                                                                              |
| 6   | `folder:5f8d1715…@@59fd7193` (Z8 Buzz) | folder tab, mounted                                           | **agent lost**; back at 00:40:17 as `@@cd9aefad`, `startup-command-delivery written=false hasCommand=false` (a plain shell) |
| 7   | `folder:e6085268…@@761b3803`           | folder tab, mounted                                           | back 0.28 s later as `@@1240fd87` (00:38:23.985, 330-char command, `user-resume`)                                           |
| 8   | `folder:a22f3477…@@fd9b1f2c`           | folder tab, mounted                                           | **agent lost**                                                                                                              |

- Rows 5–8 were stopped in one 15 ms batch (00:38:23.595–.610) by `pane-pty-binding.ts`
  `dispose()`: `claimPendingReplacedPtyId()` was non-null (the restart had cleared the pane's
  binding and was holding the old PTY for the deferred connect's spawn), and the tab was parked
  or remounted before that spawn went out. The old code stopped the PTY because "no spawn will
  carry this stop now". Three of the four (rows 5, 6, 8) lost their agent; row 7 happened to
  remount and send its spawn in time.
- `folder:4bfa00c3…@@8abe89f3` (00:38:46.932) is a restart that waited for its pane to mount; it
  had no kill.
- Nothing wrote the pane's resume record, so the next mount (including the one after the app
  restart) opened a shell.

## The Z8 Features shell is not from this event

- Its PTY in this event (row 1) was replaced at once with a command of the same length.
- The "Resume this session with: claude --resume bdd6f6d7…" screen is `z8-features@@aae6694e`:
  claude exited there on 2026-11-10 and its shell stayed alive. It sits beside `@@7fc5c2c7`, which
  still runs `bdd6f6d7`. That is the pre-existing double resume of one session id.
- Only the main-side guard addresses it (no second process resumes a session a live agent runs);
  the `dispose()` fix does not.

## The orphans

The four `orphaned: true` PTYs in the issue predate this restart (created 10-28, 11-10,
11-11 20:04Z and 11-11 23:01Z). The double resume they enabled is the general hazard: the
renderer's duplicate check sees only panes in the store, not a live PTY no pane holds.
`folder:cc29353d…@@7ad01bd3` got a mover decision at 07:51Z after the restart, so main still has
the in-memory session row of an orphan the restart reattached, and the guard sees it.

## Fix shape

1. An unsent restart hands its live PTY back to its tab and leaf (`unsent-restart-replacement.ts`)
   while that leaf is still in the tab's layout; a closed tab, a closed split pane, or a pane
   another PTY took still stops it.
2. The handed-back pane keeps its resume record and its account restart is queued again for the
   atomic main-side replace.
3. Both spawn entry points refuse, before anything is stopped, a spawn that resumes a session a
   live agent in another PTY still runs (`agent_session_held_by_live_terminal`). A row whose PTY
   is back at a bare shell (as `@@aae6694e`) does not count. A mounted restart asks main first
   (`pty:findAgentSessionHolder`), so a refused restart never unbinds its pane.

## Not covered (follow-up: #28)

A restart still pending when the app quits leaves its old PTY unbound on window-owned builds:
`handleRestartPane` clears the binding before the spawn, and main's startup placement re-binds such
terminals only when main owns the layout. It shows as `orphaned` in `orca terminal list --json`.
