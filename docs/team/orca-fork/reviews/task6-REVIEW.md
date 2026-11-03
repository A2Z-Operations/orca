# Review: session mover Task 6 (`MoveStrategy.resume`)

Range `74ff884c04..4b52731e8b`. One commit, `4b52731e8bb2391190d63f4cb58000c9b46d7c53`, two files, +249 lines. Author and committer are both Nachumi Eliyahu `<nachumi@a2zoperations.com>`. Read with `git show 4b52731e8b:<path>`. This review re-ran `src/main/claude-accounts/claude-session-move-strategy.test.ts`: 5 passed. Typecheck, lint, and the report's 318-test Claude-account run were not re-run. Later uncommitted files in the checkout are outside this range.

Line numbers are the file at `4b52731e8b`.

## Spec compliance

### Steps 1 to 4

| Requirement | Where | Verdict |
|---|---|---|
| Create `src/main/claude-accounts/claude-session-move-strategy.ts` | 103 lines in the commit | ✅ |
| Create `src/main/claude-accounts/claude-session-move-strategy.test.ts` | 146 lines in the commit | ✅ |
| Step 1 sample: resume command and spawn fields | `claude-session-move-strategy.test.ts:37-65` | ✅ |
| Step 1 sample: owner-changed | `claude-session-move-strategy.test.ts:102-115` | ✅ |
| Step 1 sample: other spawn error, no controller, bad pane key | `claude-session-move-strategy.test.ts:118-144` | ✅ |
| Step 2 red run (`Failed to load url ./claude-session-move-strategy`) | Not in the diff. The module exists at this commit, so the red run cannot be repeated here. The report cites `red.log` (`Tests 1 failed / 4 passed`). Not re-run. | ✅ Process step. |
| Step 3 implementation | `claude-session-move-strategy.ts:1-103` | ✅ |
| Step 4 green, commit subject `feat(claude-accounts): resume move strategy spawns the session on the target account in place` | Subject matches. This review: `Tests 5 passed (5)`. The plan's `Tests 3 passed (3)` grew by the two approved regressions. | ✅ |
| Commit trailer `adapted from the plan: launchCwd from the recorded session folder, per #33527` | Present as its own body line | ✅ |

The trailer says "recorded session folder". The code passes the pane's current folder as `launchCwd` (`claude-session-move-strategy.ts:52-57`) and keeps that same folder as the shell cwd (`:71`). The builder then inserts `cd` when `providerSession.cwd` differs (`src/shared/tui-agent-resume-startup.ts:87-93`). The commit's previous sentence says the current PTY cwd is retained as the spawned shell folder. The code matches that sentence and the approved adaptation.

### Named exports, types, and fields

| Requirement | Where | Verdict |
|---|---|---|
| `ClaudeSessionMoveRequest`: `ptyId`, `paneKey`, `worktreeId`, `connectionId`, `toAccountId`, `providerSession` | `claude-session-move-strategy.ts:8-15` | ✅ |
| `ClaudeSessionMoveOutcome`: `moved`; `skipped` `no-controller` \| `no-resume-plan` \| `no-pane`; `failed` `owner-changed` \| `spawn-failed` | `:17-20` | ✅ |
| `ClaudeSessionMoveStrategy.move` | `:23-25` | ✅ |
| `ResumeMoveStrategyDeps`: `getController`, `getSettings`, `platform` | `:27-31` | ✅ |
| `FALLBACK_SIZE` `{ cols: 120, rows: 40 }` | `:33`, used at `:67` | ✅ |
| `createResumeMoveStrategy` | `:40` | ✅ |
| Resume via `buildAgentResumeStartupPlan` with the pane's provider session | `:54-56` | ✅ |
| `agent: 'claude'`, `agentArgs: null`, `agentEnv: null` | `:55`, `:59-60` | ✅ |
| `cmdOverrides` from settings, shell from `resolveStartupShell` | `:58`, `:62` | ✅ |
| Null plan returns `skipped` / `no-resume-plan` | `:64-65` | ✅ Implemented. The plan's sample tests do not cover it. |
| Spawn `command` is `plan.launchCommand` | `:72` | ✅ |
| `launchAgent: 'claude'`, `commandDelivery: 'provider'` | `:73-74` | ✅ |
| Optional `startupCommandDelivery` and `env` | `:75-78` | ✅ A Claude plan omits `startupCommandDelivery` (`tui-agent-resume-startup.ts:102`). `plan.env` is set only from `agentEnv` (`:104`), which this call leaves null. |
| `resumeProviderSession` is the request session | `claude-session-move-strategy.ts:79` | ✅ |
| `connectionId`, `worktreeId`, `tabId`, `leafId` from `parsePaneKey` | `:47-49`, `:80-83` | ✅ |
| `replacesPtyId: request.ptyId` | `:84` | ✅ |
| `claudeAccountId: request.toAccountId` | `:85` | ✅ |
| `isNewSession: true`, `initiallyHidden: true`, `persistHostSessionBinding: true` | `:86`, `:89-90` | ✅ |
| Size from `getSize`, else `FALLBACK_SIZE` | `:67` | ✅ |
| Missing controller or missing `spawn` returns `no-controller` | `:44-45` | ✅ `spawn` is optional (`src/main/runtime/runtime-pty-controller-contract.ts:67`). |
| Bad pane key returns `no-pane` | `claude-session-move-strategy.ts:47-49`. Test `:141-144`. | ✅ |
| Owner change is the exact message `terminal_pane_owner_changed` | `:97`. Test `:103-114`. | ✅ |
| Any other throw is `spawn-failed` with `error.message`, or `String(error)` | `:94-98`. Test `:119-130`. | ✅ |
| Strategy does not call `resume-agent-session-in-workspace` | Absent from both new files. The diff's only `CLAUDE_CONFIG_DIR` hit is the assertion that it is undefined (`claude-session-move-strategy.test.ts:65`). | ✅ |
| Spawn goes through the injected controller, not a new pane | `getController` at `:43`, `controller.spawn` at `:69` | ✅ |
| Direct `getPtyController()` call inside this file | Not in this commit. The plan's Task 6 sample injects `getController` the same way (plan lines 2268-2284). The getter exists for Task 7 at `src/main/runtime/construction/runtime-identity-state.ts:387-388`. | ✅ Wiring is Task 7. |

### Approved adaptation and the two regressions

| Requirement | Where | Verdict |
|---|---|---|
| Resolve the pane cwd before `buildAgentResumeStartupPlan` | `claude-session-move-strategy.ts:52`, then the plan at `:54` | ✅ |
| Pass that value as `launchCwd` | `:57` | ✅ |
| Use the same value as the spawned shell cwd when it is set | `:71` | ✅ |
| Recorded folder different from the pane folder: shell cwd stays the pane folder, command cds to the recorded folder, metadata keeps the recorded path | Test `:68-83`. Builder condition `tui-agent-resume-startup.ts:85-94`. | ✅ |
| Recorded Claude effort stays on the resume argv and on the metadata | Test `:86-99`. Argv is `src/shared/agent-resume-argv.ts:13-20` (`--effort` then `--resume`). | ✅ |

### Declared deviations

| Deviation | Check | Verdict |
|---|---|---|
| Fixture import is `../persistence/persistence-session-fixtures`, not the plan text `../persistence-session-fixtures` | `claude-session-move-strategy.test.ts:5`. `TEST_LEAF_1` is `src/main/persistence/persistence-session-fixtures.ts:16`. | ✅ The plan path does not exist. This one does. |
| `vi.fn<NonNullable<Controller['spawn']>>` | Test `:38`, `:69`, `:87`, `:103`, `:119`. `spawn` is optional (`runtime-pty-controller-contract.ts:67`), so the picked type includes `undefined`. | ✅ |

### Design sentences the plan replaces

Design §3.4 (`2026-10-19-orca-session-mover-design.md:50`) says the strategy applies `ClaudeProfileRouter.launchEnvFor`. The plan replaces that: the strategy never sets `CLAUDE_CONFIG_DIR`, and Task 4's preflight reads `claudeAccountId`. This commit follows the plan (`claude-session-move-strategy.ts:60`, `:78`, `:85`; test `:65`).

Design §3.4's "no provider session" skip is not a branch here. The request type requires `providerSession` (`claude-session-move-strategy.ts:14`). A null builder result is `no-resume-plan` (`:64-65`). Design §5's filename `move-strategy-resume.test.ts` is the earlier sketch. The plan's filename is the one in this commit.

Design §4 (`:66`) says the old process stops only after the new spawn is accepted. This strategy never stops a PTY. A throw returns `failed` (`:93-98`) and does not spawn a replacement. The stop-after-accept path is inside the controller that honors `replacesPtyId` (`runtime-pty-controller-contract.ts:96`). The plan's owner-changed test checks the outcome, which this commit does (`claude-session-move-strategy.test.ts:111-114`).

`agentArgs: null` adds no trailing tokens (`src/shared/tui-agent-launch-command.ts:53-55`). The strategy does not pass `sessionOptions` (`claude-session-move-strategy.ts:54-62`). With no session-option values, catalog defaults and permission args are empty (`src/shared/agent-session-option-launch.ts:82-84` and `:108-109`). A configured permission-bypass default therefore does not appear. The passing resume assertion ends at `'--resume' 'sess-abc'` (`claude-session-move-strategy.test.ts:64`).

## Correctness

**Minor.** A null pane cwd drops a recorded folder. `claude-session-move-strategy.ts:52` turns a null `getCwd` into `undefined` and passes that as `launchCwd` at `:57`. The spawn then omits `cwd` at `:71`. The builder adds `cd` only when `launchCwd` is set (`tui-agent-resume-startup.ts:87`). Production `getCwd` returns null on an empty reading or a throw (`src/main/ipc/pty/runtime/operations.ts:180-185`), and the runtime controller uses that wrapper (`src/main/ipc/pty/runtime/controller.ts:79`). A pane whose folder cannot be read resumes with no `cd` and no spawn cwd, even when `providerSession.cwd` is set. Fix: when the pane cwd is missing and `providerSession.cwd` is set, use that recorded folder as both the spawn cwd and `launchCwd` so the shell starts there.

The common path is tested (`claude-session-move-strategy.test.ts:68-83`). The plan's own sample also omits a missing cwd. This is the unread-cwd edge, not the approved path.

Checked and not filed:

- A throwing `getCwd` would reject `move`, because the await sits outside `try` (`claude-session-move-strategy.ts:52` versus `:68`). The production wrapper catches and returns null (`operations.ts:184-185`). The contract returns `Promise<string | null>` (`runtime-pty-controller-contract.ts:153`).
- `isNewSession: true` (`claude-session-move-strategy.ts:86`) does not remove the resume command. `ownsNewIncarnation` is a daemon-host flag (`src/main/ipc/pty/runtime/spawn-preflight.ts:58-61`). This spawn does not pass `sessionId`.
- `terminal_split_source_not_found` maps to `spawn-failed` (`claude-session-move-strategy.ts:97`). The plan names only `terminal_pane_owner_changed`.

## Quality

`claude-session-move-strategy.ts` is 103 physical lines. The test file is 146. Both are under the plan's about-200 guide. This commit does not touch `spawn-commit.ts`. The diff adds no `max-lines` disable, no `eslint-disable`, no `oxlint-disable`, no `@ts-ignore`, and no `@ts-expect-error`.

The plan does not ask for a pure function. The strategy takes its controller, settings, and platform through `ResumeMoveStrategyDeps` (`claude-session-move-strategy.ts:27-31`) and does the spawn there.

Names match the plan: `createResumeMoveStrategy`, `ClaudeSessionMoveRequest`, `ClaudeSessionMoveOutcome`, `ResumeMoveStrategyDeps`. The resume command is `buildAgentResumeStartupPlan`. The file does not copy that builder.

The tests call the real builder. The resume test checks the spawn fields and the `'--resume' 'sess-abc'` suffix (`claude-session-move-strategy.test.ts:47-65`). The folder test checks that the shell cwd stays `/fixture/local/sub` and that the command starts with `cd '/fixture/recorded run'` (`:80-83`). The effort test checks `'--effort' 'high' '--resume' 'sess-abc'` (`:98-99`). The failure tests check the outcome object (`:111-114`, `:127-143`). None of these mirror a string the strategy itself builds. This review re-ran the file: 5 passed in 9 ms.

`no-resume-plan` (`claude-session-move-strategy.ts:64-65`) and `FALLBACK_SIZE` (`:33`, `:67`) have no test. The plan's samples omit both.

## Verdict

Yes

0 Blockers, 0 Importants, 1 Minor.
