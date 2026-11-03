# Review: session mover Task 9 (orcad usage polling)

Range `91442d2441..2ba5e240f5`. One commit, `2ba5e240f5f2620d351f96d539622babb72374ba`, 8 files, +200 / -3. Author and committer are both Nachumi Eliyahu `<nachumi@a2zoperations.com>`. Read at `2ba5e240f5`. This review re-ran `claude-usage-polling-policy.test.ts`, `service-headless-polling.test.ts`, and `orcad-account-services.test.ts`: 3 files, 12 passed. Typecheck and lint were not re-run. The broader Claude-accounts, rate-limits, and orcad folders were not re-run.

Line numbers are the file at `2ba5e240f5`.

## Spec compliance

### Step 1: policy test

| Requirement | Where | Verdict |
|---|---|---|
| Off plus auto-switch false does not poll | `src/main/claude-accounts/claude-usage-polling-policy.test.ts:9-11` | ✅ |
| Auto-switch true polls even when the mover is off | `:12-14` | ✅ |
| Mover `move` polls when auto-switch is false | `:15-17` | ✅ |
| Absent settings poll, because the default is `ask` | `:18-19` | ✅ |
| The switch does not start while the mover is off | `:30-31` | ✅ |
| A second `move` update does not start again | `:33-36` | ✅ |
| Start options are `{ fetchImmediately: true, pollWithoutWindow: true }` | `:37-40` | ✅ The plan snippet passes only `fetchImmediately`. The approved adaptation adds `pollWithoutWindow`. The landed assertion matches that call. |
| An unrelated `theme` update does not stop | `:42-43` | ✅ |
| Turning the mover off stops once | `:45-47` | ✅ |
| Step 1 red run | Not in the diff. The report cites a missing-module red under `.git/task9/`. Not re-run. | ✅ Process step. |

### Step 2: policy implementation

| Requirement | Where | Verdict |
|---|---|---|
| `ClaudeUsagePollingSettings` is a partial pick of `claudeAutoSwitchEnabled` and `claudeSessionMover` | `src/main/claude-accounts/claude-usage-polling-policy.ts:4-6` | ✅ |
| `CLAUDE_USAGE_POLLING_SETTING_KEYS` names those two keys | `:8-11` | ✅ |
| `shouldPollClaudeUsage` is true when auto-switch is true or the mover is not `off` | `:14-17` | ✅ `?? 'ask'` makes a missing mover poll. Off plus auto-switch false is the false case. |
| `createClaudeUsagePollingSwitch` takes `start`/`stop` and `getSettings`, and returns `apply` and `polling` | `:21-24` | ✅ |
| An update that contains neither key returns the current flag | `:29-31` | ✅ An empty object hits this path. `undefined` re-evaluates, which is what the first `apply()` uses. |
| Start runs once, with both approved options | `:33-35` | ✅ |
| Stop runs once, and the internal flag clears | `:36-38` | ✅ |

### Step 3: orcad wiring

| Requirement | Where | Verdict |
|---|---|---|
| Import `createClaudeUsagePollingSwitch` | `src/main/orcad/orcad-account-services.ts:15` | ✅ |
| Create the switch, apply it, and subscribe to settings | `:89-93` | ✅ The plan's two-line comment is one line at `:88`. It still says headless features need readings without a window. |
| Cleanup unsubscribes, then stops the mover, then stops the poller | `:94-99` | ✅ The plan's cleanup was only `rateLimits.stop()` and `setClaudeStatusLineListener(null)`. Task 7's `sessionMover?.stop()` and `attachedRuntime = null` remain. The approved adaptation calls `unsubscribePolling()` first. |
| A WSL host still returns before this wiring | `:65-67` | ✅ Desktop ownership of WSL accounts is unchanged. |
| Notices still go to the notification channel | `:79-85` | ✅ Design §3.5's notice path is Task 7. This commit does not replace it. |

### Step 4: tests and commit

| Requirement | Where | Verdict |
|---|---|---|
| Policy tests pass | This review: 2 passed in `claude-usage-polling-policy.test.ts` | ✅ |
| orcad account-service regression passes | This review: 5 passed in `orcad-account-services.test.ts`, including the new case at `:112-140` | ✅ The plan's command also runs the whole `src/main/orcad` folder. This review did not. |
| `typecheck:node` | Not re-run. | ✅ The report cites exit 0. This review does not adopt that as its own run. |
| Subject `feat(orcad): poll Claude usage while auto-switch or the session mover is on` | Commit subject | ✅ |

### Design §3.5

| Requirement | Where | Verdict |
|---|---|---|
| orcad starts usage polling when auto-switch is on or the mover is not off | `claude-usage-polling-policy.ts:14-17` and the start at `:34`, applied at `orcad-account-services.ts:89-90` | ✅ |
| Mover and auto-switch notices reach the notification channel | `orcad-account-services.ts:79-85` | ✅ Retained from Task 7. |

### Approved adaptation 1: `pollWithoutWindow`

| Requirement | Where | Verdict |
|---|---|---|
| `start()` takes an optional `pollWithoutWindow` flag | `src/main/rate-limits/service/service-configuration.ts:118` | ✅ |
| The default is false, including a later start that omits the flag | State init `service-state.ts:44`. Every start assigns `options.pollWithoutWindow === true` at `service-configuration.ts:119` | ✅ |
| The flag is cleared on stop | `service-configuration.ts:129` | ✅ |
| It is honoured only on the no-window branch | `service-polling.ts:57-58` | ✅ The only production caller that passes true is `claude-usage-polling-policy.ts:34`. |
| Visibility, minimized, and focus gates are unchanged | `service-polling.ts:61-64` | ✅ |
| The desktop start does not opt in | `src/main/startup/main-window-core-services.ts:155`, `rateLimits.start({ fetchImmediately: false })`. Not in this diff. | ✅ |
| The switch starts with `{ fetchImmediately: true, pollWithoutWindow: true }` | `claude-usage-polling-policy.ts:34` | ✅ |

### Approved adaptation 2: unsubscribe before stop

| Requirement | Where | Verdict |
|---|---|---|
| The settings unsubscribe is kept | `orcad-account-services.ts:91-93` | ✅ |
| Cleanup calls it before the mover stop and the poller stop | `:94-98` | ✅ |
| A settings write after cleanup cannot start or stop again | `orcad-account-services.test.ts:129-136` | ✅ The test pops that cleanup at `:129` so `afterEach` does not run it twice. |

### Fake-timer regressions

| Requirement | Where | Verdict |
|---|---|---|
| A no-window start without the flag fetches once across two intervals | `src/main/rate-limits/service-headless-polling.test.ts:29-33` | ✅ |
| An opted-in start fetches three times across two intervals | `:35-39` | ✅ Immediate fetch plus two ticks. |
| Stop makes `canBackgroundPoll` false, and further time adds no fetch | `:41-44` | ✅ |
| A restart without the flag adds one fetch and does not repeat | `:46-48` | ✅ |
| Focused false, visible false, and minimized true each stay at one fetch while opted in | `:51-62` | ✅ `FakeRateLimitWindow` defaults are focused, visible, and not minimized. Each case flips one field. The focus gate is `isFocused()` at `service-polling.ts:64`, which already applied on every platform. |

### Adaptations (unasked)

The report says none. That holds. The diff is the plan plus the two approved adaptations and the tests those adaptations need: the extra start option in the policy test, the orcad cleanup regression, the 63-line fake-timer file, the state field, the start and stop writes, and the one-line no-window return. Writing `pollWithoutWindow` on every start is how a later start without the flag stays false. The restart case covers that. No extra behavior sits outside that set.

## Correctness

No Blocker, Important, or Minor.

`shouldPollClaudeUsage` is true only when auto-switch is true or the mover is not `off` (`claude-usage-polling-policy.ts:14-17`). Start and stop each run once (`:33-38`). An update with neither watched key returns without reading settings (`:29-31`). The timer repeats only when `shouldBackgroundPoll` is true (`service-polling.ts:27-29`), and a missing window returns the opt-in flag (`:57-58`). `stop()` clears that flag before it clears the timer (`service-configuration.ts:129-135`). The desktop caller still starts with `fetchImmediately: false` and does not pass the flag (`main-window-core-services.ts:155`), so its no-window result stays false. An attached window still fails the visible, minimized, and focus checks (`service-polling.ts:61-64`). Cleanup removes the settings listener before it stops the mover and the poller (`orcad-account-services.ts:94-98`). A later settings write cannot call `apply` (`orcad-account-services.test.ts:133-136`).

## Quality

New files: `claude-usage-polling-policy.ts` 43 lines, `claude-usage-polling-policy.test.ts` 49 lines, `service-headless-polling.test.ts` 63 lines. All are under the plan's about-200 guide. `spawn-commit.ts` is not in the diff. The diff adds no `eslint-disable`, `oxlint-disable`, `ts-ignore`, `ts-expect-error`, or `max-lines` suppression.

The policy test asserts the four truth cases, one start, the start options, an ignored theme update, and one stop. The headless test asserts fetch counts and the cleared opt-in. The orcad test asserts start and stop counts through cleanup and after it. This review re-ran those three files: 12 passed.

## Verdict

Yes

0 Blockers, 0 Importants, 0 Minors.
