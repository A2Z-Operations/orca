# Review: session mover Task 7 (`ClaudeSessionMover`)

Range `4b52731e8b..362b5c2710`. One commit, `362b5c2710a18707ec73fd31c09dfececb9d84e5`, 18 files, +1294 / -4. Author and committer are both Nachumi Eliyahu `<nachumi@a2zoperations.com>`. Read at `362b5c2710`. This review re-ran the two mover files and `main-process-quit-update-veto.test.ts`: 15 passed. Typecheck, lint, and the report's Claude-account, orcad, rate-limit, and startup gates were not re-run.

Line numbers are the file at `362b5c2710`.

## Spec compliance

### Steps 1 to 5: joiner, tests, mover

| Requirement | Where | Verdict |
|---|---|---|
| Create `claude-session-mover-sessions.ts` | 117 lines | ✅ |
| Create `claude-session-mover.ts` | 133 lines. Types live in `claude-session-mover-types.ts` and are re-exported at `claude-session-mover.ts:5-9` | ✅ Split. See deviations. |
| Create `claude-session-mover.test.ts` | 187 lines. Shared fixture is `claude-session-mover-test-fixture.ts` | ✅ Split. |
| `ClaudeMoverSessionView` fields `record`, `paneKey`, `paneState`, `providerSession`, `worktreeId` | `claude-session-mover-sessions.ts:16-22` | ✅ |
| `collectClaudeMoverSessions` joins registry rows, hook status, and provider identity | `:28-86` | ✅ |
| Unknown transcript session is recorded pinned, source `transcript` | `:48-68`. Comment at `:63-64` | ✅ |
| `providerSession` is `{ key: 'session_id', id, transcriptPath? }` when no richer row exists | `:77-82` | ✅ Fallback. Adaptation 1 adds the richer row first. |
| `claudeUsageForAccount`: selected account uses the bar when `isClaudeUsageReadingOf` matches, else null; others use `inactiveClaudeAccounts` | `:90-105` | ✅ |
| `claudeMoveCandidates`: other signed-in accounts that share the runtime | `:109-116` | ✅ |
| Step 2 nine cases | `claude-session-mover.test.ts:17`, `:44`, `:57`, `:69`, `:88`, `:101`, `:127`, `:152`, `:165` | ✅ |
| Step 3 red run | Not in the diff. The report cites a missing-module red under `.git/task7/`. Not re-run. | ✅ Process step. |
| Step 5 green. Plan text says `Tests 9 passed (9)` | This review: 9 passed in the plan file, plus 5 lifecycle tests. | ✅ The extra file is the four adaptations and the publication race. |
| Commit subject `feat(claude-accounts): session mover moves running Claude sessions before a usage limit` | Commit subject matches | ✅ |

### Named mover types and the evaluate loop

| Requirement | Where | Verdict |
|---|---|---|
| `ClaudeSessionMoveNotice` kinds `moved`, `ask`, `skipped`, `failed`, with `ptyId`, `from`, `to`, `detail` | `claude-session-mover-types.ts:25-31` | ✅ |
| `ClaudeSessionMoverDeps` settings, rate limits, accounts, hooks, registry, pane resolvers, `accountHomes`, `strategy`, `headless`, `onNotice`, optional `log` | `:33-66` | ✅ Hooks also pick `getStatusSnapshotForPane` (`:51`). Adaptation 1. |
| `ClaudeSessionMover.start` returns the unsubscribe | `claude-session-mover.ts:115-123` | ✅ |
| `evaluate` and `lastDecisions` (newest first) | `:125-131` | ✅ |
| Default setting `ask` | `:24` | ✅ |
| Headless `ask` becomes `move`, logged once | `:25-30`. The re-run printed that line from the headless case. | ✅ |
| `collectClaudeMoverSessions` uses registry, status snapshot, identities, homes, and `recordInferred` | `:36-52` | ✅ |
| Dead PTY ids are dropped from move, failure, ask, and decision maps | `:54-60` | ✅ |
| Target claims older than `CLAUDE_SESSION_MOVE_COOLDOWN_MS` are deleted | `:62-65` | ✅ |
| `decideClaudeSessionMove` from the Task 5 policy, with claim debit `CLAUDE_SESSION_MOVE_CLAIM_DEBIT_PERCENT` | `claude-session-mover-evaluation.ts:53-65` and `:111-114` | ✅ |
| `read-usage` requests one deferred `fetchInactiveClaudeAccountsOnOpen` | Remember at `:66-69`. Fetch at `claude-session-mover.ts:78-90` | ✅ Adaptation 4 also stores the summary. The plan sample did not. |
| `stay` and `wait` do not move | `claude-session-mover-evaluation.ts:71-81` | ✅ |
| No provider session skips with `no-provider-session` | `:88-90`. Test `claude-session-mover.test.ts:160-162` | ✅ |
| Desktop `ask` notices and does not move, at most once per cooldown | `:92-104`. Test `:110-117` | ✅ |
| Missing pane key or worktree skips `no-pane` | `:106-108` | ✅ |
| Move calls `strategy.move` with `ptyId`, `paneKey`, `worktreeId`, `connectionId: null`, `toAccountId`, `providerSession` | `:120-128` | ✅ `connectionId: null` is the plan's call. |
| Moved, skipped, and failed outcomes settle; a throw settles `failed` | `:129-140` | ✅ |
| In-flight set blocks a second move of the same PTY | `:43` and `:116`, cleared at `:141-143` | ✅ |
| `start` subscribes to rate-limit state and hook status | `claude-session-mover.ts:117-118` | ✅ |
| Log once per reason change, default prefix `[claude-session-mover]` | `claude-session-mover-history.ts:22` and `:45-50` | ✅ |

### Plan tests and the eleven design §5 scenarios

Design §5 (`2026-10-19-orca-session-mover-design.md:74`) lists these mover scenarios. The plan's nine tests cover them. Pinned stay and pinned move share one test. `off`, desktop `ask`, and headless `ask` share one test. The idle over-line test is the `move` branch.

| Scenario | Where | Verdict |
|---|---|---|
| Over the line, idle, moves to the account with the most room (`c`), notice `moved` | `claude-session-mover.test.ts:17-40` | ✅ Summary pty id is `pty-new`. Adaptation 2. |
| Mid-turn waits `wait:mid-turn`, then moves once the pane is `done` | `:44-54` | ✅ |
| Pinned at 93 does not move | `:57-63` | ✅ |
| Pinned at 100 moves | `:63-66` | ✅ |
| Two sessions, one target: the second stays, then moves after `CLAUDE_SESSION_MOVE_TARGET_COOLDOWN_MS` | `:69-85` | ✅ Reason is `stay`, not the plan's `stay:no-target`. Adaptation 4. |
| Stale reading fetches once and does not move; a second publish does not fetch again | `:88-98` | ✅ |
| `off` does not move and sends no notice | `:103-108` | ✅ |
| Desktop `ask` sends one `ask` notice and does not move across two publishes | `:110-117` | ✅ |
| Headless `ask` moves | `:119-124` | ✅ |
| Failed move notices `failed`, holds, and retries after `CLAUDE_SESSION_MOVE_FAILURE_HOLD_MS` | `:127-149` | ✅ |
| No provider session skips with detail `no-provider-session` and does not move | `:152-162` | ✅ |
| Transcript the mover did not route is recorded pinned and is not moved at 96 | `:165-186` | ✅ Plan test. Not one of the eleven sentences. |

Policy gate for "never mid-turn": only `done` moves (`claude-session-mover-policy.ts:127-131`). Pinned sessions move only at `isClaudeAtLimit` (`:114-116`). `off` returns before that (`:105-106`).

### Step 6: accounts state

| Requirement | Where | Verdict |
|---|---|---|
| `ClaudeAccountSettings` includes `claudeSessionMover` | `claude-account-selection.ts:37` | ✅ |
| `setSessionMovesProvider` | `:76-78` | ✅ |
| `setSessionMover` saves and returns `list()` | `:80-83` | ✅ |
| `list()` returns `sessionMover` (default `ask`) and `sessionMoves` | `:108-109` | ✅ |
| Imports of `ClaudeSessionMoverSetting` and `ClaudeSessionMoveSummary` | `:1` and `:5` | ✅ |
| `ClaudeAccountService.setSessionMover` and `setSessionMovesProvider` | `service.ts:145-151` | ✅ |

### Step 7: wiring and notices

| Requirement | Where | Verdict |
|---|---|---|
| `sessionMover` absent leaves the mover null | `provider-claude-session-mover.ts:32` and `:65`. Option is optional at `provider-account-services.ts:45` | ✅ |
| Provider builds `createClaudeSessionMover` with the registry, pane maps, registered worktree, and System-default home when covered | `provider-claude-session-mover.ts:33-51` | ✅ |
| Strategy is `createResumeMoveStrategy` with lazy `getController`, settings, and `process.platform` | `:52-56` | ✅ |
| `setSessionMovesProvider(() => sessionMover.lastDecisions())`, then `start()` | `:61-63` | ✅ |
| `ProviderAccountServices.sessionMover` is returned | `provider-account-services.ts:34` and `:211-217`. Built at `:186-190` | ✅ |
| Desktop `headless: false`, lazy `state.runtime?.getPtyController()` | `main-process-account-services.ts:62-64` | ✅ |
| Desktop skips `skipped` and skips when notifications are off | `:66-67` | ✅ |
| Desktop bodies for moved, ask, and failed, title `Claude session mover` | `:69-89` | ✅ Strings are the `translateMain` defaults. The locale keys are Task 8. |
| Desktop stores `stop` on main-process state | `:118`. Slot at `main-process-state.ts:67-69` and `:92` | ✅ |
| Quit calls `stop` and clears it | `main-process-quit.ts:95-96` | ✅ |
| An already-vetoed `before-quit` does not stop it | `main-process-quit.ts:75-77`. Test `main-process-quit-update-veto.test.ts:75` and `:83`. This review passed that test. | ✅ |
| Orcad `attachToRuntime` also picks `getPtyController` and `dispatchMobileNotification` | `orcad-account-services.ts:40-46` | ✅ |
| `attachedRuntime` is set on the first line of `attachToRuntime` | `:133-134` | ✅ |
| Orcad `headless: true`, lazy controller | `:75-76` | ✅ |
| Orcad notice goes through `dispatchMobileNotification` | `:78-84` | ✅ |
| Orcad cleanup calls `stop` before `rateLimits.stop()` | `:88-91` | ✅ |

### Approved adaptations

| Adaptation | Where | Verdict |
|---|---|---|
| Provider session comes from `getStatusSnapshotForPane`, matched by id, so `cwd` and `effort` reach Task 6. Identity-only metadata remains the fallback. Hook wire types are unchanged. | Resolve at `claude-session-mover.ts:40-43`. Join at `claude-session-mover-sessions.ts:77-82`. Snapshot rows already carry `providerSession?: AgentProviderSessionMetadata` (`src/shared/agent-status-ipc-payload.ts:61`). `cwd` and `effort` are on that metadata (`src/shared/agent-session-resume.ts:47` and `:49`). `getStatusSnapshotForPane` already existed (`src/main/agent-hooks/server/server-listeners.ts:224`). Test `claude-session-mover-lifecycle.test.ts:15-48` | ✅ |
| Success cooldown is stored on the old id and the new id. The decision moves to the new id. | `claude-session-mover-history.ts:64-78`. Test `:51-72` | ✅ |
| The pane stays held if the new PTY is published before the move promise settles | `claude-session-mover-evaluation.ts:44` and `:116-118`. Test `claude-session-mover-lifecycle.test.ts:75-91` | ✅ This is the report's extra race, inside adaptation 2. |
| `start` returns the unsubscribe. Orcad cleanup and desktop quit call it. `stopped` drops a queued evaluate and a queued usage read. | Return at `claude-session-mover.ts:119-123`. Guard at `:82-84` and `:95-97`. Orcad at `orcad-account-services.ts:89`. Desktop at `main-process-quit.ts:95`. Test `claude-session-mover-lifecycle.test.ts:93-105` | ✅ |
| One summary per live PTY, latest wins, newest first. `read-usage`, under-line, and `off` are visible. Reason union is `stay`, `read-usage`, `wait:mid-turn`, `wait:no-status`, `moving`, `moved`, `failed`, `pinned`, `off`, `ask`, `skipped`. | Union at `claude-session-mover-types.ts:12-23`. Mapping at `claude-session-mover-evaluation.ts:71-80`. Filter and sort at `claude-session-mover.ts:126-130`. Test `claude-session-mover-lifecycle.test.ts:108-123` | ✅ Failure text stays in the log (`claude-session-mover-history.ts:47-49`). Test `claude-session-mover.test.ts:139-142` |

### Design sections and declared deviations

Design §3.3 is the service above: own-account reading (`claude-session-mover-sessions.ts:90-105`), shared policy (`claude-session-mover-evaluation.ts:53`), `done` only (`claude-session-mover-policy.ts:130`), desktop ask versus headless move (`claude-session-mover.ts:25`, desktop `main-process-account-services.ts:62`, orcad `orcad-account-services.ts:75`), and timed claims (`claude-session-mover.ts:62-65`, debit at `claude-session-mover-evaluation.ts:111-114`).

Design §3.5 polling (`rateLimits.start()` when the mover or auto-switch is on) is Task 9 in the plan (`2026-10-19-orca-session-mover.md:3491` and the map at `:3759`). This commit does the Task 7 half: orcad notices (`orcad-account-services.ts:78-84`). The report's "no Task 9 polling" matches that split.

| Deviation | Check | Verdict |
|---|---|---|
| Module split into evaluation, history, sessions, types, provider wiring, and a test fixture | Production files are 147, 101, 117, 73, 133, and 66 lines. The plan's single service sample is larger than the 200-line guide. | ✅ |
| Fixture import `../persistence/persistence-session-fixtures` | `claude-session-mover-test-fixture.ts:11`. Same existing module Task 6 uses. | ✅ |
| Fixture accounts carry `managedAuthPath` | `:97-99`. Collect reads that field at `claude-session-mover.ts:47-49`. The transcript test needs it. | ✅ |
| Successful fake move replaces the registry row with the new PTY | `claude-session-mover-test-fixture.ts:109-126`. The first test expects `pty-new` (`claude-session-mover.test.ts:33`). | ✅ |
| `stay:*` summaries use `stay`, except pinned under-line uses `pinned` and `off` uses `off` | `claude-session-mover-evaluation.ts:72-79` | ✅ Approved vocabulary. The two-session test still checks that the second session does not move and later does (`claude-session-mover.test.ts:77-85`). |

## Correctness

No Blocker, Important, or Minor.

Checked against the usual traps:

- A pinned session at 93 stays. The policy uses `isClaudeAtLimit` for pinned rows (`claude-session-mover-policy.ts:116`). The test does not move (`claude-session-mover.test.ts:62`).
- A turn that is `working` does not move (`claude-session-mover-policy.ts:130-131`, test `claude-session-mover.test.ts:49-50`).
- Desktop `ask` does not call the strategy (`claude-session-mover-evaluation.ts:92-104`). Orcad is `headless: true` (`orcad-account-services.ts:75`), so its `ask` is rewritten to `move` (`claude-session-mover.ts:25`).
- A claim is deleted once it is `CLAUDE_SESSION_MOVE_COOLDOWN_MS` old (`claude-session-mover.ts:62-65`). The 60 second target hold stays inside the policy (`claude-session-mover-policy.ts:133-136`). The claim is taken only after the skip and ask branches (`claude-session-mover-evaluation.ts:111-114`).
- After a move, the next publish of the new PTY stays on cooldown (`claude-session-mover-lifecycle.test.ts:65-68`). The old id is also stamped (`claude-session-mover-history.ts:65-66`) and then pruned when it is no longer registered (`claude-session-mover.ts:54-60`).
- `stop` drops a queued usage read and later `evaluate` calls (`claude-session-mover.ts:82-84` and `:95-97`). An in-flight move still settles. That move has already been accepted.

## Quality

New production files: `claude-session-mover-evaluation.ts` 147, `claude-session-mover-history.ts` 101, `claude-session-mover-sessions.ts` 117, `claude-session-mover-types.ts` 73, `claude-session-mover.ts` 133, `provider-claude-session-mover.ts` 66. All are under the plan's about-200 guide. The test fixture is 219 physical lines. The tests are 187 and 125. The diff does not touch `runtime/spawn-commit.ts`. The diff adds no `max-lines` disable, no `eslint-disable`, no `oxlint-disable`, no `@ts-ignore`, and no `@ts-expect-error`.

The plan does not ask for a pure service. `decideClaudeSessionMove` stays the pure policy. The service calls it (`claude-session-mover-evaluation.ts:53`) and does not copy the line table, the ten-point rule, or the picker.

Names match the plan: `createClaudeSessionMover`, `collectClaudeMoverSessions`, `claudeUsageForAccount`, `claudeMoveCandidates`, `ClaudeSessionMoveNotice`. The resume path is `createResumeMoveStrategy` (`provider-claude-session-mover.ts:52`), not a second builder.

The nine plan tests assert a call count, a target, a notice, or a reason. The lifecycle tests assert the metadata object (`claude-session-mover-lifecycle.test.ts:48`), the replacement id (`:62-68`), a single move while publication races (`:85`), no fetch after stop (`:100`), and one live summary (`:119-120`). They do not mirror a string the service builds by hand. This review re-ran them: 9 + 5 passed. The quit-veto test passed in the same run.

## Verdict

Yes

0 Blockers, 0 Importants, 0 Minors.
