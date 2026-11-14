# Pane process ownership (issue #44)

Status: proposed. This change is the decision only. No product code yet.

Refs #5 and #44. PR #43 is the heartbeat half and stays as it is: a rejected heartbeat is withheld only for a released or stopped dispatch. This note is the process-ownership half. #5 stays open until both halves have landed. The session reap reviewed in `fable-arch-43` is not part of this design, and `agent-pane-session-reap.ts` is not on `blowzer/fork-only`.

Line numbers are `origin/blowzer/fork-only` at `453edb37dad58b78f52f5b7f27bbce7158d34481`.

## Decision

While a `launchAgent` pane is alive, remember every process whose parent chain still reaches that pane's root. On close, run today's descendant sweep and root signal unchanged. After that sweep returns, signal the remembered processes that are still the same pid, start time, and uid. A failed process-table read adds nothing and kills nothing beyond what today already kills.

The feature applies only to panes with `session.launchAgent` set. A plain user terminal is unchanged. `ORCA_PANE_DESCENDANT_OWNERSHIP=0` turns the sampler and the extra kill off. Any other value, including unset, leaves it on.

## 1. Where a pane's root and descendants are already tracked

The daemon already knows the pane root and can list the processes still linked under it. It learns that list at close, from one `ps`, and then forgets it. Nothing keeps the list while the agent is alive, so a tool shell that called `setsid` and whose parent then exited is already gone from the walk.

| Fact                                  | Where                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pane root pid                         | `Session.pid` reads `subprocess.pid` (`src/main/daemon/sessions/session.ts:133`).                                                                                                                                                                                                                                                                                                                                                       |
| Agent vs plain terminal               | `Session.launchAgent` is set from spawn options (`session.ts:29`, `session.ts:52`). Null means a plain terminal.                                                                                                                                                                                                                                                                                                                        |
| One shared process table              | `readFreshProcessTable` runs `ps -axo pid=,ppid=,pgid=,tpgid=,lstart=` with a 1s budget (`pty-descendant-fresh-table.ts:9`, `pty-descendant-fresh-table.ts:25`, `pty-descendant-fresh-table.ts:31`). `createProcessTableSnapshotReader` shares a scan that has not started yet (`pty-descendant-termination.ts:34`). Shutdown shares an in-flight scan for 25ms (`terminal-descendant-shutdown.ts:14`).                                 |
| Descendant walk                       | `collectDescendantRows` (`pty-descendant-termination.ts:99`) builds the ppid tree. A missing root row, or two rows for the root pid, yields no descendants (`pty-descendant-termination.ts:122`).                                                                                                                                                                                                                                       |
| Snapshot before the root is signalled | `captureDescendantSnapshot` (`pty-descendant-termination.ts:155`) and `killWithDescendantSweep` (`pty-descendant-termination.ts:187`) take the table, then call `killRoot` in `finally` (`pty-descendant-termination.ts:242`).                                                                                                                                                                                                          |
| Ownership of the live root            | Callers pass `ownsRoot`. Teardown uses `sessions.get(sessionId) === session && session.isAlive` (`terminal-session-teardown.ts:124`, `terminal-session-teardown.ts:173`). The sweep skips descendant signals when that returns false (`pty-descendant-termination.ts:224`, `pty-descendant-termination.ts:237`).                                                                                                                        |
| Start-time identity                   | Each row carries verbatim `lstart` (`pty-process-table-parser.ts:1`). `hasUnambiguousStartTime` refuses a start time in the same second as the capture (`pty-descendant-termination.ts:264`). Shutdown re-reads and requires the same `startedAt` and `pgid` before SIGKILL (`pty-descendant-exit-verification.ts:52`, `pty-descendant-termination.ts:303`).                                                                            |
| Close order today                     | `killSession` sends `launchAgent` panes, and any non-immediate close, through `killAfterDescendantSnapshot` (`terminal-session-teardown.ts:81`). That calls `killWithDescendantSweep` (`terminal-session-teardown.ts:157`), then `signalTerminationRoot` for a graceful close (`terminal-session-teardown.ts:168`, `session-termination-controller.ts:54`).                                                                             |
| Signals and the 5s timeout            | Graceful POSIX close sends the root SIGTERM (`local-pty-termination.ts:66`). `scheduleForceDisposeFallback` arms SIGKILL at `KILL_TIMEOUT_MS` = 5s (`session-termination-controller.ts:8`, `session-termination-controller.ts:68`). The local PTY uses the same 5s (`LOCAL_PTY_GRACEFUL_FORCE_TIMEOUT_MS`, `local-pty-termination.ts:32`). node-pty can also SIGHUP when the pty socket closes (`local-pty-session-activation.ts:169`). |
| Windows                               | An owned job already contains descendants that have been reparented (`pty-descendant-termination.ts:196`). If the job is unavailable, a PID walk runs only after `verifyWindowsTreeKillTarget` returns `own`, and that check refuses the daemon pid and Orca's Chromium pids (`windows-pty-root-identity.ts:22`).                                                                                                                       |

`ProcessTableRow` has pid, ppid, pgid, optional tpgid, and `startedAt`. It has no uid (`pty-process-table-parser.ts:1`).

## 2. Keeping an owned set while the agent is alive

`setsid` does not change ppid. The parent link disappears when that parent exits, which may be a short-lived wrapper while the pane root is still alive. A walk at close time cannot see the shell after that. The #5 orphan is that shape: a bash started from a Claude tool snapshot, reparented to pid 1, with a `sleep` child.

Record the set from the terminal host, in a new `pane-descendant-ownership` module beside `pty-descendant-termination.ts`. Key it by session id. Reuse `readProcessTable` and `collectDescendantRows`. Do not add a second `ps` per pane, and do not revive a session or process-group reap.

Sampling, not hooks, is the source of the set:

- Run one shared read on a 200ms timer, and only while at least one `launchAgent` session is alive. The timer is unref'd. If a read is already in flight, skip the tick.
- The ownership read is the existing column list plus `uid=`. The close-time sweep keeps its current columns and its pgid check.
- For each live `launchAgent` session, walk from `session.pid`. When the root row's `startedAt` matches the start time recorded for that session, add every descendant as `{ pid, startedAt, uid, capturedAtMs }`.
- A descendant stays in the set after it leaves the tree. A later successful read removes it only when that pid is present with a different start time or uid. Absence does not remove it. A short-lived command leaves a small record; kill time re-checks identity, so an exited pid is not signalled.
- The first sample runs when the `launchAgent` root pid is known. Pty output from such a pane may request one extra shared read, coalesced so two requests inside 50ms produce one read. Output is only a hint to sample sooner. It is not an identity.

Bound. A process is missed when its parent chain to the pane root both appears and breaks between two samples, so no sample ever sees the link. A 200ms poll does not close that gap. A silent `sleep` whose parent is the pane itself, which is the #5 shell while the pane lives, is seen on the next tick. A wrapper that exits in a few milliseconds can still be missed. That miss is reported by the tests below and is not papered over.

On Windows the sampler does not run. The owned job is the recorded set.

## 3. Identity at capture and at kill

At capture, store pid, `lstart`, and uid for the pane root and for each descendant.

At kill, read the table again. Signal a recorded descendant only when all of these hold:

- The kill-time table contains exactly one row for that pid.
- `startedAt` and uid equal the recorded values.
- `hasUnambiguousStartTime` is true for the recorded start time against the kill-time capture. `lstart` cannot tell two processes apart inside one second (`pty-descendant-termination.ts:269`).
- The pid is greater than 1 and is not the terminal host (`process.pid`).
- The pid is not any pane root, and it is not in another pane's recorded set. A pid that sits in two panes' sets is signalled by neither.
- The pid is not in the Orca Chromium set used by `windows-pty-root-identity.ts:22`.

Do not require pgid. `setsid` changes the process group, so the pgid match in `matchingSnapshotRows` (`pty-descendant-exit-verification.ts:52`) would spare the shell this design exists to reach. The close-time sweep keeps that pgid match for the processes it found itself.

`ownsRoot` stays the gate for the live sweep. It is not a gate for the recorded set. The recorded set is what remains after the root has died, and the start-time check is what makes that safe. A recycled root pid clears that session's set and stops sampling it: the root row's `startedAt` no longer matches the session.

## 4. Close order

For a `launchAgent` pane with the switch on, `killAfterDescendantSnapshot` (`terminal-session-teardown.ts:132`) keeps today's body and then appends one step. `killWithDescendantSweep` is not edited.

1. Today's sweep, unchanged and first. It snapshots the live tree, signals those descendants, and in `finally` signals the root: SIGTERM on a graceful close (`local-pty-termination.ts:66`), or the immediate force-kill path when `entry.immediate` is set (`terminal-session-teardown.ts:165`).
2. After that sweep promise settles, SIGTERM each recorded descendant that still matches section 3.
3. SIGKILL the ones that still match when the existing 5s deadline fires (`KILL_TIMEOUT_MS`, `LOCAL_PTY_GRACEFUL_FORCE_TIMEOUT_MS`). If the sweep outlived that deadline, SIGKILL follows the recorded SIGTERM by `DESCENDANT_KILL_GRACE_MS` (2s, `pty-descendant-termination.ts:15`), not in the same turn. No new timeout constant.

The root is not a member of the recorded kill. Plain terminals, and a `launchAgent` pane with the switch off, never reach step 2. Their background-job exclusion (`terminal-session-teardown.ts:176`) stays as it is.

## 5. Failure behaviour

A sampler tick whose read throws, times out, or returns null changes nothing. `collectDescendantRows` returning no descendants because the root row is missing or duplicated is the same kind of failure for that pane: do not add, and do not clear.

A kill-time read that fails signals nothing in the recorded set. The sweep has already run. A failed re-read before SIGKILL skips SIGKILL. An empty or unreadable table is not evidence that the recorded processes exited.

## 6. Tests that would have caught `fable-arch-43`

These are unit tests with a fake process table and a fake `sendSignal`. They do not compile a helper or call `getsid`.

| Finding                                                                                                           | Test                                                                                                                                                                                                                                                            |
| ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HIGH 1. Daemon session id 1 made the reap return before it signalled anything.                                    | The host pid's session id is 1. A child with another session id is recorded from ppid and signalled on close by start time. The implementation has no `getsid` and no `process.kill(-pgid)`.                                                                    |
| HIGH 2. A `setsid` tool shell is a different session from the pane, so a session filter skipped it.               | Sample 1: root 10, shell 20 with ppid 10 and its own pgid. Sample 2: shell 20 has ppid 1, the same `lstart` and uid. `collectDescendantRows(10)` on sample 2 does not contain 20. The recorded set does, and close signals 20.                                  |
| HIGH 3. Killing the session, including the root, before `killWithDescendantSweep` made the sweep see no children. | Call order is sweep terminate, then root SIGTERM, then recorded-set SIGTERM. A test that moves the recorded kill ahead of `killWithDescendantSweep` fails. The root pid is absent from the recorded signals.                                                    |
| MEDIUM 4. No start-time recheck, so a reused pid could be signalled seconds later.                                | Record pid 20 at start T1, uid 501. The kill-time row is pid 20 at start T2. `sendSignal` is not called. The same for a matching start time with a different uid, for a second row with the same pid, and for a start time inside the kill-time capture second. |
| Protected pids, which the reap's exclusion list did not cover across panes.                                       | pid 1, `process.pid`, another pane's root, a pid in another pane's recorded set, and an Orca Chromium pid are not signalled even when this pane recorded them.                                                                                                  |
| Read failure must not widen the kill.                                                                             | The kill-time reader returns null. The sweep still runs. The extra `sendSignal` count is 0. A sampler read that throws leaves the previous set in place.                                                                                                        |
| The stated miss.                                                                                                  | The process exists only between two samples, and the later sample shows ppid 1. It is not recorded and not signalled.                                                                                                                                           |
| Scope.                                                                                                            | `launchAgent == null` never fills a set. `ORCA_PANE_DESCENDANT_OWNERSHIP=0` runs the sweep and does not call the extra kill. The Windows path with `terminateOwnedTree() === 'terminated'` does not start the sampler.                                          |

## 7. Alternatives considered

Session reap at close. This is the design `fable-arch-43` rejected. On the macOS terminal host `getsid()` is 1, so the guard signalled nothing. A `setsid` shell is not in the pane's session. Killing the session first, including the root's group, runs before the sweep and turns a graceful close into SIGKILL.

Walk ppid only at close. This is today's sweep. It is necessary and stays first. It cannot see a shell whose parent link broke while the agent was still alive.

Agent hook events as the identity. Claude `PreToolUse` does not carry the tool shell's pid, and it does not run before `setsid`. A hook can request the same shared sample. It cannot replace the sample.

Pty bytes as the identity. Output says a child might have started. It does not name the pid. The design uses output only to coalesce an extra shared read.

Endpoint Security, `cn_proc`, or a pidfd monitor. Any of these could shrink the miss in section 2. Each is a privileged or per-OS subscription, and the daemon is not the parent of the tool shell, so it cannot take `NOTE_FORK` on that shell. One `ps` sampler covers macOS and Linux. A later design can replace the timer without changing the recorded identity or the close order.

Require pgid at kill time. The existing SIGKILL check does this for processes the close-time walk just saw. Copying it onto the recorded set would skip a shell that had already called `setsid`.

Put the extra kill inside `killWithDescendantSweep`, or gate it on `ownsRoot`. That couples the new set to a function whose contract is "the root is still alive, so the walk is valid." The recorded set is valid after the root is gone. Appending it after the sweep keeps the sweep reviewable on its own.

Sample with one `ps` per pane. Cost grows with the number of agent panes and races the shared reader the sweep already uses. One read per tick is enough, because every pane is a walk over that same table.

Run the sampler on Windows. The job object already owns reparented descendants and survives pid reuse (`pty-descendant-termination.ts:196`). A second kill list would race `taskkill`.

Drop a recorded pid when a later table omits it. A truncated or partial `ps` would forget a live shell just before it reparented. Kill time already ignores a pid that is gone. The set is allowed to remember exited commands.

## Out of scope

Heartbeat delivery, CLI exit 76, and the `dispatch_released` receipt. Those belong to PR #43. No change to `send-point-to-point.ts`.
