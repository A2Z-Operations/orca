# Task 7 done — ClaudeSessionMover service, wiring and notices

Status: DONE. One Task 7 commit on top of `4b52731e8b`, pushed to `origin/blowzer/session-mover`; clean working tree. This supersedes the previous dispatch's blocked report and unanswered-question state. All four adaptations were expressly approved in Task 7b.

## Commit and push

Commit: `362b5c2710a18707ec73fd31c09dfececb9d84e5`

`git log -1 --format='%an <%ae> | %cn <%ce>%n%B'`:

```text
Nachumi Eliyahu <nachumi@a2zoperations.com> | Nachumi Eliyahu <nachumi@a2zoperations.com>
feat(claude-accounts): session mover moves running Claude sessions before a usage limit

Preserve recorded cwd and effort through identity-matched hook snapshots without changing hook wire types.
Track successful move cooldowns on both PTY ids, carry the decision to the new live PTY, and hold its pane through publication.
Retain the start unsubscribe for orcad and desktop teardown, and drop queued work after stop.
Keep one latest summary per live session with stable reasons, including read-usage, stay, pinned and off; retain failure detail in logs.
```

No attribution trailers. The initial unpublished draft was amended for the pane-handoff regression; no pushed commit was amended and the resulting range contains exactly one commit.

`git diff --stat 4b52731e8b..HEAD`:

```text
.../claude-accounts/claude-account-selection.ts    |  16 ++
 .../claude-session-mover-evaluation.ts             | 147 ++++++++++++++
 .../claude-session-mover-history.ts                | 101 ++++++++++
 .../claude-session-mover-lifecycle.test.ts         | 125 ++++++++++++
 .../claude-session-mover-sessions.ts               | 117 +++++++++++
 .../claude-session-mover-test-fixture.ts           | 219 +++++++++++++++++++++
 .../claude-accounts/claude-session-mover-types.ts  |  73 +++++++
 .../claude-accounts/claude-session-mover.test.ts   | 187 ++++++++++++++++++
 src/main/claude-accounts/claude-session-mover.ts   | 133 +++++++++++++
 src/main/claude-accounts/service.ts                |  10 +
 src/main/orcad/orcad-account-services.test.ts      |  10 +
 src/main/orcad/orcad-account-services.ts           |  26 ++-
 src/main/provider-account-services.ts              |  21 +-
 src/main/provider-claude-session-mover.ts          |  66 +++++++
 src/main/startup/main-process-account-services.ts  |  33 ++++
 .../startup/main-process-quit-update-veto.test.ts  |   7 +-
 src/main/startup/main-process-quit.ts              |   2 +
 src/main/startup/main-process-state.ts             |   5 +
 18 files changed, 1294 insertions(+), 4 deletions(-)
```

`git push origin blowzer/session-mover` exited 0:

```text
To https://github.com/A2Z-Operations/orca.git
   4b52731e8b..362b5c2710  blowzer/session-mover -> blowzer/session-mover
```

## Approved adaptations and implementation map

1. **Recorded resume metadata:** `claude-session-mover.ts:createClaudeSessionMover` resolves the existing `getStatusSnapshotForPane` row by matching provider session ID; `claude-session-mover-sessions.ts:collectClaudeMoverSessions` passes the full metadata to Task 6, preserving cwd and effort. Hook wire types are unchanged; the identity-only fallback still works when the richer row is absent.
2. **Replacement continuity:** `claude-session-mover-history.ts:createClaudeMoverHistory` records success cooldown on both old and new PTY IDs, removes the old summary, and writes the moved summary under the new live ID. `claude-session-mover-evaluation.ts:evaluateClaudeMoverSessions` additionally holds the pane while replacement publication precedes promise settlement, preventing a second move through the new ID.
3. **Lifetime cleanup:** `start()` returns the unsubscribe and guards queued evaluation/usage reads after stop. `provider-claude-session-mover.ts` retains that callback as `stop`; existing orcad cleanup invokes it before stopping rate limits. Desktop stores it in `main-process-state.ts` and invokes it alongside poller shutdown in `main-process-quit.ts`; an already-vetoed before-quit event leaves it active.
4. **Bounded summaries:** one map entry per PTY; the latest decision replaces the previous entry, dead PTYs are filtered/pruned, and results sort newest first. Read-usage, under-line and off decisions are visible. Reason vocabulary is a fixed union: `stay`, `read-usage`, `wait:mid-turn`, `wait:no-status`, `moving`, `moved`, `failed`, `pinned`, `off`, `ask`, `skipped`. Failure details remain in logs and notices rather than creating unbounded reason strings.

`ClaudeAccountSelection.list` and `ClaudeAccountService` expose the setting and decision provider for Task 8. Provider composition uses the Task 5 policy and Task 6 resume strategy, lazy runtime controller access, and the existing hook/status subscriptions. Desktop notices use the existing notification surface and settings gate; headless notices use `dispatchMobileNotification`; decisions are logged independently of notification delivery. Desktop ask waits, headless ask acts as move and logs that choice once. No Task 9 polling changes.

## Module split and line counts

New files (physical lines):

| Module | Lines |
| --- | ---: |
| `src/main/claude-accounts/claude-session-mover-evaluation.ts` | 147 |
| `src/main/claude-accounts/claude-session-mover-history.ts` | 101 |
| `src/main/claude-accounts/claude-session-mover-lifecycle.test.ts` | 125 |
| `src/main/claude-accounts/claude-session-mover-sessions.ts` | 117 |
| `src/main/claude-accounts/claude-session-mover-test-fixture.ts` | 219 |
| `src/main/claude-accounts/claude-session-mover-types.ts` | 73 |
| `src/main/claude-accounts/claude-session-mover.test.ts` | 187 |
| `src/main/claude-accounts/claude-session-mover.ts` | 133 |
| `src/main/provider-claude-session-mover.ts` | 66 |

The production service is split into evaluation, decision history, session/usage joining, type contracts, and provider wiring; tests share a fixture. All new production modules are below 200 physical lines. The test fixture is approximately 200 lines; all files pass existing max-lines rules. `runtime/spawn-commit.ts` remains unchanged at 98 physical lines, below its 300-line ceiling. No lint rule was disabled.

## Final gates

Node from `~/.n-orca`; Corepack pnpm only; `ORCA_BACKGROUND_LAUNCH=1`. Canonical TMPDIR is used for macOS path-sensitive tests. Existing platform/real-login skips are unchanged; no test assertion or timeout was weakened.

**Task 7: nine plan cases plus five regressions** (`.git/task7b/mover-final2.log`)

```text
Test Files  2 passed (2)
Tests  14 passed (14)
```

**Claude accounts** (`.git/task7b/claude-accounts-final.log`)

```text
Test Files  33 passed | 1 skipped (34)
Tests  332 passed | 3 skipped (335)
```

**Orcad** (`.git/task7b/orcad-serial.log`)

```text
Test Files  84 passed | 10 skipped (94)
Tests  734 passed | 33 skipped (767)
```

**Rate limits** (`.git/task7b/rate-limits-final.log`)

```text
Test Files  62 passed | 1 skipped (63)
Tests  883 passed | 1 skipped (884)
```

**Startup, including desktop teardown/veto** (`.git/task7b/startup-serial.log`)

```text
Test Files  81 passed | 2 skipped (83)
Tests  742 passed | 8 skipped (750)
```

Node typecheck (`corepack pnpm run typecheck:node`) exited 0 (`node-final.log`). Changed-file oxlint, JS plugin lint, ast-grep, React Doctor lint, and oxfmt check all exited 0 (`lint-final2.log`, `lint-final2.json`). Both the initial commit and final amend ran and passed all Husky lint-staged checks (`commit.log`, `amend.log`). `git diff --check` passed.

Final commands:

```sh
export N_PREFIX=$HOME/.n-orca PATH=$HOME/.n-orca/bin:$PATH ORCA_BACKGROUND_LAUNCH=1
export TMPDIR="$(python3 -c 'import os,tempfile; print(os.path.realpath(tempfile.gettempdir()))')"
corepack pnpm exec vitest run --config config/vitest.config.ts src/main/claude-accounts/claude-session-mover.test.ts src/main/claude-accounts/claude-session-mover-lifecycle.test.ts
corepack pnpm exec vitest run --config config/vitest.config.ts src/main/claude-accounts --maxWorkers=4
corepack pnpm exec vitest run --config config/vitest.config.ts src/main/orcad --maxWorkers=2
corepack pnpm exec vitest run --config config/vitest.config.ts src/main/rate-limits --maxWorkers=4
corepack pnpm exec vitest run --config config/vitest.config.ts src/main/startup --maxWorkers=2
corepack pnpm run typecheck:node
```

The final orcad/startup commands ran sequentially to avoid transform/import contention; no timeout limits were changed. The prior concurrent maxWorkers=4 attempts timed out in `orcad-push-startup.test.ts:229`, `orcad-stop-terminal-admission.test.ts:13` (beforeEach), and `main-process-quit-update-veto.test.ts:48`. Their complete suites passed on the final rerun.

## Regression and environment evidence

All nine original plan cases remain. Four approved adaptation cases cover matching metadata, replacement cooldown and new summary ID, stop/unsubscribe/queued-read cancellation, and bounded under-line/read-usage/off summaries (including PTY exit). One additional regression proves publication of a new PTY cannot start another move while the first promise is pending. Desktop quit-veto coverage and failure-log detail assertions were strengthened without adding skips.

The four `orcad-forked-child-paths.test.ts` failures also reproduce on pristine tracked HEAD `4b52731e8b` (tracked diff asserted empty during the diagnostic, all working bytes restored in finally):

- `forks the watcher child shipped beside orcad.js`
- `forks the session scanner child shipped beside orcad.js`
- `ignores a decoy child under the working directory`
- `reports the install root and the Node binary, not the data directory`

Those assertions compare `/var/...` fixture paths against `/private/var/...` canonical paths. That test file was not modified; using realpath(TMPDIR) makes the gate pass.

The earlier dispatch's orcad teardown error also reproduced with baseline orcad wiring. Login-shell/agent-view reconciliation outlived the test HOME stubs, and the real-agent-home guard rejected the attempted real-home write. The fixture now mocks only login-shell environment capture, supplies temporary CLAUDE_CONFIG_DIR, and awaits the real agent-view service before undoing its environment/removing directories. Normal console interception passes; the diagnostic `--disableConsoleIntercept` flag was not used in final gates, and no real-home write was allowed.

## Deviations from the recipe

- The four coordinator-approved adaptations above, including stable summary reasons. Assertions expecting the old PTY ID now expect the replacement ID; verbose `stay:*` assertions use the approved `stay` vocabulary while retaining movement/no-movement and cooldown assertions.
- The fake successful strategy now updates the fake registry like the real spawn path, so tests exercise live-ID summary retention.
- The pane-level in-flight guard closes the demonstrated publication race within the approved replacement-continuity behavior (red: two moves instead of one; green after guard). The additional test does not expand the feature scope.
- Relocated persistence fixture import and populated managed account homes for the original transcript inference test, as approved.
- Module splits shown above, as approved; original service recipe exceeded the intended file size.
- Orcad test environment/lifetime isolation and canonical TMPDIR handling, with no assertion weakening or change to the pristine-HEAD path tests.

No known unresolved Task 7 issue, skipped implementation item or new test exclusion remains. Task 8, Task 9, app installation and live CLI rehearsal were not started; live rehearsal belongs to the later plan tasks. `blowzer/auto-switch` remains `a880c7b912c0f867843367cef06803ccfcc5f96d`.

## Earlier run summaries (audit trail)

Task 7b logs under `.git/task7b/`:

| Run | Exact summary | Log |
| --- | --- | --- |
| Task 7b red: new-id summary, four adaptations, desktop teardown | Test Files  3 failed (3); Tests  6 failed \| 8 passed (14) | `red.log` |
| Initial adaptation implementation, remaining old reason assertion | Test Files  1 failed \| 2 passed (3); Tests  1 failed \| 13 passed (14) | `green.log` |
| Initial complete mover gate | Test Files  2 passed (2); Tests  13 passed (13) | `mover.log` |
| Stable failure reason must retain error detail in log, focused red | Test Files  1 failed (1); Tests  1 failed \| 8 skipped (9) | `failure-log-red.log` |
| Mover gate after log detail and brace fix | Test Files  2 passed (2); Tests  13 passed (13) | `mover-final.log` |
| Pane handoff race, red | Test Files  1 failed (1); Tests  1 failed \| 4 passed (5) | `pane-handoff-red.log` |
| Initial Claude account gate | Test Files  33 passed \| 1 skipped (34); Tests  331 passed \| 3 skipped (334) | `claude-accounts.log` |
| Initial orcad gate | Test Files  84 passed \| 10 skipped (94); Tests  734 passed \| 33 skipped (767) | `orcad.log` |
| Initial rate-limit gate | Test Files  62 passed \| 1 skipped (63); Tests  883 passed \| 1 skipped (884) | `rate-limits.log` |
| Initial startup gate | Test Files  81 passed \| 2 skipped (83); Tests  742 passed \| 8 skipped (750) | `startup.log` |
| Final parallel orcad attempt, concurrency timeouts | Test Files  2 failed \| 82 passed \| 10 skipped (94); Tests  2 failed \| 732 passed \| 33 skipped (767) | `orcad-final.log` |
| Final parallel startup attempt, concurrency timeout | Test Files  1 failed \| 80 passed \| 2 skipped (83); Tests  1 failed \| 741 passed \| 8 skipped (750) | `startup-final.log` |
| Pristine tracked HEAD path test | Test Files  1 failed (1); Tests  4 failed \| 1 passed (5) | `pristine-head-paths.log` |

Earlier Task 7 dispatch logs under `.git/task7/`: missing-module red (1 failed file/no tests); recipe green (1 file/9 tests); four adaptation reds (1 failed file/4 failed tests); initial broad gate (1 failed/196 passed/13 skipped files, 4 failed/1799 passed/44 skipped tests, 3 teardown errors); canonical TMPDIR diagnostic (2 passed files/9 passed tests, 3 teardown errors); baseline wiring diagnostic (1 passed file/4 passed tests, 1 teardown error); console diagnostic (1 passed file/4 passed tests); isolated orcad fixture (1 passed file/4 passed tests); pending combined regressions (1 failed/1 passed files, 4 failed/9 passed tests). These were superseded by the final green gates above.
