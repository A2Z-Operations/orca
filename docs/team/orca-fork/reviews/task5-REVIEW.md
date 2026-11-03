# Review: session mover Task 5

Range `6e60fc18ac..24902c029e`. One commit, seven files, +354 lines. Read at `24902c029e`. This review re-ran `claude-session-mover-policy.test.ts`: 9 passed. The report's other gates (auto-switch 39, combined 48, claude-accounts directory, typecheck, lint) were not re-run.

Line numbers are the file at `24902c029e`.

## Spec compliance

### Step 1: setting vocabulary

| Requirement | Where | Verdict |
|---|---|---|
| `ClaudeSessionMoverSetting` = `'off' \| 'ask' \| 'move'` | `src/shared/claude-account-switch-settings.ts:5` | ✅ |
| `claudeSessionMover?` on `ClaudeAccountSwitchSettings`, comment says absent means `ask` and a headless host treats `ask` as `move` | `claude-account-switch-settings.ts:10-11` | ✅ |
| Existing `ClaudeAccountSwitchRunningSessions` left as `'ask' \| 'restart' \| 'keep'` | `claude-account-switch-settings.ts:2` | ✅ |
| Field is on `GlobalSettings` through the existing intersection | `src/shared/global-settings-base.ts:15` composes `ClaudeAccountSwitchSettings`. That file is unchanged. | ✅ |
| Default `claudeSessionMover: 'ask'` beside `claudeAutoSwitchEnabled` | `src/shared/default-global-settings.ts:187` | ✅ |
| `ClaudeSessionMoveSummary` fields `ptyId`, `paneKey`, `fromAccountId`, `toAccountId`, `window` (`session` \| `weekly` \| `fableWeekly` \| null), `percent`, `line`, `reason`, `at` | `src/shared/managed-account-types.ts:140-150` | ✅ |
| `sessionMover?` and `sessionMoves?` on `ClaudeRateLimitAccountsState` after `autoSwitchEnabled` | `managed-account-types.ts:134-136` | ✅ |
| Import of `ClaudeSessionMoverSetting` | `managed-account-types.ts:1` | ✅ |
| Type-only. No mover service, RPC, CLI, or Settings row in this range | Those files are absent from the diff. They are Tasks 7 and 8. | ✅ |

The summary type is declared just after the state type that names it (`managed-account-types.ts:140`). TypeScript allows that forward reference.

### Step 2: re-exports, no copied logic

| Requirement | Where | Verdict |
|---|---|---|
| `ClaudeAutoSwitchWindowName` and `ClaudeAutoSwitchWindow` alias the existing window types | `claude-account-auto-switch-policy.ts:100-101` | ✅ |
| `claudeAutoSwitchWindows` is `liveWindows`; `isClaudeAtLimit` is `isAtLimit` | `claude-account-auto-switch-policy.ts:103`. Bodies stay `liveWindows` at `:22` and `isAtLimit` at `:64`. | ✅ |
| `isClaudeUsageReadingOf` is `isReadingOf`; `claudeAccountsShareRuntime` is `sharesRuntime` | `claude-account-auto-switch.ts:211`. Bodies stay `isReadingOf` at `:182` and `sharesRuntime` at `:197`. | ✅ |
| Mover uses those pieces and `pickClaudeAutoSwitchTarget` / `claudeAutoSwitchHeadroom` | Imports at `claude-session-mover-policy.ts:9-15`. Calls at `:109-116` and `:156`. | ✅ |

`isAtLimit` is `used >= 100` on a live window (`claude-account-auto-switch-policy.ts:64-66`). Lines stay `CLAUDE_AUTO_SWITCH_LINES` (session 95, weekly 90, Fable weekly 90) at `:8`. The ten-point gain and the at-limit "any room" exception stay inside `pickClaudeAutoSwitchTarget` (`:93-97`). The mover does not restate them.

### Step 3 and Step 5: policy and the decision table

| Requirement | Where | Verdict |
|---|---|---|
| `CLAUDE_SESSION_MOVE_COOLDOWN_MS` = 5 min | `claude-session-mover-policy.ts:18` | ✅ Design §3.3 item 6. |
| `CLAUDE_SESSION_MOVE_TARGET_COOLDOWN_MS` = 60 s | `:20` | ✅ |
| `CLAUDE_SESSION_MOVE_FAILURE_HOLD_MS` = 60 s | `:22` | ✅ |
| `CLAUDE_SESSION_MOVE_CLAIM_DEBIT_PERCENT` = 5 | `:24` | ✅ The helper debits `claim.debit`. The constant is the amount a later caller records. The plan's function does the same. |
| `ClaudeTargetClaim` `{ at, debit }` | `:26` | ✅ |
| `ClaudeSessionMoveWindow` | `:27-31` | ✅ |
| `ClaudeSessionMoveDecision` stay / read-usage / wait / move, with the plan's reason unions | `:33-40` | ✅ |
| `ClaudeSessionMoveInputs` fields, including `candidateCount` and `targetClaims` | `:42-56` | ✅ |
| `worstClaudeWindow` | `:64-74` | ✅ |
| `debitClaimedUsage` | `:77-98` | ✅ |
| `decideClaudeSessionMove` | `:101-162` | ✅ |
| Time is the `now` argument. Freshness is `DEFAULT_POLL_MS` | `isFresh` at `:59-61`. `DEFAULT_POLL_MS` is 15 min at `service-types.ts:96`. | ✅ |
| Pinned sessions move only at `isClaudeAtLimit` | `:116` | ✅ |
| A claim younger than 60 s removes that target | `:132-135` | ✅ |
| An older claim debits the reading for the 5 min session cooldown | `:82` and `:137-140` | ✅ |
| Retry-After accounts are not waited on | `:143-146` | ✅ |
| `off` stays `off` | `:105-106`. Test `:83-84`. | ✅ |
| Under the line stays `under-line` (usage 80) | `:116-118`. Test `:79-80`. | ✅ |
| Idle session at 96 moves to `c` (most room), window session / 96 / 95 | Test `:47-53`. Picker is the shared one. | ✅ |
| `working` and `blocked` wait `mid-turn`; `null` waits `no-status` | `:127-131`. Test `:55-67`. | ✅ |
| Pinned at 96 stays `under-line`; pinned at 100 moves | Test `:70-75`. | ✅ |
| Stale reading (16 min) asks `read-usage`; a read 1 s ago stays `no-usage`; `usage: null` asks `read-usage` | Test `:89-95`. Gate is `:109-112`. | ✅ |
| One fresh candidate of two asks `read-usage` | Test `:98-100`. Count check `:148-153`. | ✅ |
| A stale candidate inside Retry-After does not block a move to `b` | Test `:101-108`. | ✅ |
| Move 1 ms inside the 5 min cooldown stays `cooldown`; the same moment at 100% moves | Test `:111-119`. Bypass is `:123` (`!atLimit`). | ✅ |
| Failure 1 ms inside the 60 s hold stays `failed-recently`; exactly 60 s moves | Test `:120-128`. Hold is `:120-121`. The hold is not waived at the limit. The plan's code and the test are the same. | ✅ |
| A claim 1 s old skips `c` and moves to `b` | Test `:131-136`. | ✅ |
| A claim exactly 60 s old with debit 40 ranks `c` as 60, so `b` at 50 wins | Test `:137-141`. | ✅ |
| Debit 20 + 5 = 25, and 98 + 5 caps at 100 | Test `:142-150`. | ✅ |
| Candidates at 90 and 88 stay `no-target` | Test `:153-156`. Pick returns null under the ten-point rule. | ✅ |
| Nine tests, names unchanged from the plan | `claude-session-mover-policy.test.ts:47`, `:55`, `:70`, `:78`, `:89`, `:98`, `:111`, `:131`, `:153` | ✅ |

`AgentStatusState` is `'working' | 'blocked' | 'waiting' | 'done'` (`agent-status-types.ts:50`). Only `done` moves (`claude-session-mover-policy.ts:130`). Design §3.3 item 4 says the hook status must be `done`.

Setting `ask` and setting `move` take the same decision path. Only `off` returns early (`:105`). The decision type has no `ask` kind. Design §3.3 item 5 (desktop notice versus headless act) is the mover service in Task 7. This function answers whether a move is warranted.

### Steps 4 and 6, and declared deviations

| Requirement | Where | Verdict |
|---|---|---|
| Red run before the module exists | Report only: `policy-red.log`, exit 1, `Cannot find module`. Not re-run here. The module exists at this commit, so a red run cannot be repeated on this tree. | ✅ The wording differs from the plan's `Failed to load url`. The report says so. The red result is the same. |
| Green policy suite | Re-ran here: `Test Files 1 passed`, `Tests 9 passed`. | ✅ |
| Sample commit subject in the plan | Actual subject is `feat(claude-accounts): session mover policy and the claudeSessionMover setting vocabulary`. | ✅ Declared. The body names the exports and the decision table. Behavior does not depend on the subject. |
| oxfmt wrapping | The nine cases and the policy match the plan's branches and expected values. Symbols are unchanged. | ✅ |
| Anchors instead of the plan's old line numbers | Default sits after `claudeAutoSwitchEnabled` (`default-global-settings.ts:186-187`). State fields sit after `autoSwitchEnabled` (`managed-account-types.ts:132-136`). Exports are at the ends of the two auto-switch files. | ✅ |

## Correctness

No defect found.

Pinned at 96 is over the 95 line and under `isAtLimit` (`used >= 100`, `claude-account-auto-switch-policy.ts:64-66`). The policy stays (`claude-session-mover-policy.ts:116-118`). Pinned at 100 moves. The test covers both (`claude-session-mover-policy.test.ts:71-75`).

A reading older than 15 min never reaches the move branch (`:109-112`). A read inside the poll interval stays `no-usage` instead of asking again.

A target claimed less than 60 s ago is left out (`:135`). After that, the one-turn debit still applies until the 5 min session cooldown (`:82`). Two decisions therefore cannot both pick the same fresh target. The policy does not store claims. Releasing a claim is the service's job in a later task.

The failure hold still applies at 100% (`:120-121` runs before the cooldown bypass at `:123`). The plan's test expects that (`:120-128`). Design §3.3 item 6 gives a failed move 60 s with no at-limit waiver.

`ask` is not turned into an immediate desktop move inside this function. There is no host check here. Task 7 owns the notice.

One path matches the plan and is worth stating. When the fresh-candidate count is short, nothing is fetching, and `lastUsageReadAt` is inside the poll interval, the function does not return (`:148-154` has no else). It ranks the candidates it already has. The plan's source has that same shape. The decision-table test asks for a read when `lastUsageReadAt` is `0` (`:99-100`), which this code does.

## Quality

`claude-session-mover-policy.ts` is 162 physical lines. The test file is 158. Both are under the plan's about-200 guide. No `max-lines` disable, no `eslint-disable`, no `oxlint-disable`, no `@ts-ignore`, and no `@ts-expect-error` in the diff.

The four shared pieces are `export { existing as publicName }` aliases. `decideClaudeSessionMove` calls `claudeAutoSwitchHeadroom`, `isClaudeAtLimit`, `claudeAutoSwitchWindows`, and `pickClaudeAutoSwitchTarget`. It does not copy `liveWindows`, the line table, or the ten-point rule.

The functions take `now` and return a value. The file has no `Date.now`, timer, filesystem call, or `console` call. `DEFAULT_POLL_MS` is a constant import, as the plan wrote it.

Each of the nine tests asserts a concrete `kind`, and where the plan names them, the target, the window, or the debited percent. This review re-ran the file: 9 passed in 5 ms.

`CLAUDE_SESSION_MOVE_CLAIM_DEBIT_PERCENT` is not read inside `decideClaudeSessionMove`. Callers pass `claim.debit`. That is the plan's split. Task 7 is the caller.

## Verdict

Yes

0 Blockers, 0 Important, 0 Minors.
