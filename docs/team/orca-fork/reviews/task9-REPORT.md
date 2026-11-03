# Task 9 report — orcad usage polling

Done: `2ba5e240f5f2620d351f96d539622babb72374ba` on `blowzer/session-mover`, directly after Task 8 `91442d2441`, pushed to origin.

## Commit identity and message

```text
Nachumi Eliyahu <nachumi@a2zoperations.com> | Nachumi Eliyahu <nachumi@a2zoperations.com>
feat(orcad): poll Claude usage while auto-switch or the session mover is on

Adaptation (approved): opt headless callers into pollWithoutWindow, default it off and clear it on stop, retaining desktop visibility and focus gates.
Adaptation (approved): unsubscribe the orcad settings listener before stopping the mover and poller so late settings changes cannot restart polling.
Cover repeated headless polls, default no-window behavior, stop/reset, desktop gates and cleanup with regression tests.
```

## Implementation

- `claude-usage-polling-policy.ts`: `shouldPollClaudeUsage` enables polling for auto-switch or mover ask/move (including the default ask); `createClaudeUsagePollingSwitch` applies relevant settings changes idempotently and fetches immediately when enabled.
- `orcad-account-services.ts`: creates/applies the switch at service setup, subscribes to settings changes, then unsubscribes before stopping the mover and poller during cleanup. Existing WSL desktop ownership and Task 7 cleanup are retained.
- Rate-limit state/configuration/polling: `pollWithoutWindow` is explicitly opted in by the headless switch; defaults to false on every start and is cleared on stop. Desktop visibility, minimized and focus guards are unchanged.
- No settings vocabulary, CLI flag, RPC name or wire contract changed. No desktop call site changed; no removed polling-interval IPC was revived.

## Approved adaptations

1. The upstream timer refused every no-window tick, so merely calling start fetched once: add the approved optional `pollWithoutWindow` start flag, keep it in service state, clear it on stop, and pass it from the switch; fake-timer tests cover repeated headless ticks, default single fetch, stop/reset and all three desktop guards.
2. Retain the settings subscription's unsubscribe and invoke it before mover/poller cleanup; the integration regression verifies setting-driven start/stop and that late settings changes cannot restart polling after cleanup.

Both were explicitly approved in Task 9b's ruling on msg_416033b4408f and are recorded separately in the commit body. The plan's expected start options now include the approved flag. Existing Task 7 mover cleanup remains in place.

## Adaptations (unasked)

None. The new headless regression suite is a 63-line sibling test file, keeping production changes small. The two existing policy files were continued, not rewritten. No test or assertion was deleted or weakened, and no lint rule was disabled.

## Gate evidence

All commands used the Node installation under `~/.n-orca`, `corepack pnpm`, and `ORCA_BACKGROUND_LAUNCH=1`. Vitest used `--config config/vitest.config.ts --maxWorkers=2`. Canonical TMPDIR was used for the known macOS /var versus /private/var fixture issue; no fixture assertion was changed.

| Run | Vitest summary | Log under .git/task9b |
| --- | --- | --- |
| Approved adaptations, red | Test Files  3 failed (3); Tests  3 failed  /  9 passed (12) | `adaptation-red.log` |
| Approved adaptations, green | Test Files  3 passed (3); Tests  12 passed (12) | `adaptation-green.log` |
| Final policy suite | Test Files  1 passed (1); Tests  2 passed (2) | `policy-final.log` |
| Final Claude accounts | Test Files  34 passed  /  1 skipped (35); Tests  334 passed  /  3 skipped (337) | `claude-accounts-final.log` |
| Final rate limits | Test Files  63 passed  /  1 skipped (64); Tests  888 passed  /  1 skipped (889) | `rate-limits-final.log` |
| Final orcad | Test Files  84 passed  /  10 skipped (94); Tests  735 passed  /  33 skipped (768) | `orcad-final.log` |

Final commands:

```sh
corepack pnpm exec vitest run --config config/vitest.config.ts src/main/claude-accounts/claude-usage-polling-policy.test.ts --maxWorkers=2
corepack pnpm exec vitest run --config config/vitest.config.ts src/main/claude-accounts --maxWorkers=2
corepack pnpm exec vitest run --config config/vitest.config.ts src/main/rate-limits --maxWorkers=2
corepack pnpm exec vitest run --config config/vitest.config.ts src/main/orcad --maxWorkers=2
corepack pnpm run typecheck:node
```

Targeted red/green commands ran the policy suite, `src/main/rate-limits/service-headless-polling.test.ts` and `src/main/orcad/orcad-account-services.test.ts` together. Red failures were the missing opt-in argument, no orcad response to settings, and one fetch instead of three; all pass after implementation.

Node typecheck: exit 0 (`typecheck-node.log`). All five changed-file checks exit 0: oxlint, JS plugins, ast-grep, React Doctor, and oxfmt (`lint-0.log` through `lint-4.log`). Formatter write exited 0. Husky commit checks passed. `git diff --check` clean.

Historical Task 9 dispatch evidence retained under `.git/task9/`: initial policy red was one failed file/no tests due to missing module; exact-plan helper then passed 1 file/2 tests; unchanged orcad plus window baseline passed 85 files with 10 skipped, 754 tests with 33 skipped. That dispatch made no commit while waiting for the adaptation ruling; Task 9b resolves that blocker.

## Push

```text
To https://github.com/A2Z-Operations/orca.git
   91442d2441..2ba5e240f5  blowzer/session-mover -> blowzer/session-mover
```

## Diff stat

```text
.../claude-usage-polling-policy.test.ts            | 49 +++++++++++++++++
 .../claude-accounts/claude-usage-polling-policy.ts | 43 +++++++++++++++
 src/main/orcad/orcad-account-services.test.ts      | 32 +++++++++++
 src/main/orcad/orcad-account-services.ts           |  9 +++-
 .../rate-limits/service-headless-polling.test.ts   | 63 ++++++++++++++++++++++
 .../rate-limits/service/service-configuration.ts   |  4 +-
 src/main/rate-limits/service/service-polling.ts    |  2 +-
 src/main/rate-limits/service/service-state.ts      |  1 +
 8 files changed, 200 insertions(+), 3 deletions(-)
```

New files: policy 43 lines, policy test 49 lines, headless polling test 63 lines. Existing spawn-commit.ts is untouched. `blowzer/auto-switch` remains a880c7b912c0f867843367cef06803ccfcc5f96d. No functional scope remains pending or uncertain for Task 9; real-host rollout/build validation belongs to later tasks. Task 10 was not started.
