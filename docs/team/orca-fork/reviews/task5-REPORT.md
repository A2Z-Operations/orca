# Task 5 — session mover policy and setting vocabulary

Status: DONE. One commit on `blowzer/session-mover`, pushed to private `origin`; working tree clean. Task 6 was not started, and `blowzer/auto-switch` remains `a880c7b912c0f867843367cef06803ccfcc5f96d`.

## Commit evidence

Commit: `24902c029e0ee607583488a205dbd83bf6d4da04`  
Parent: `6e60fc18ac4eb9934f007acc6b0651b2b3b2a215`

`git log -1 --format='%an <%ae> | %cn <%ce>%n%B'`:

```
Nachumi Eliyahu <nachumi@a2zoperations.com> | Nachumi Eliyahu <nachumi@a2zoperations.com>
feat(claude-accounts): session mover policy and the claudeSessionMover setting vocabulary

Exports: claudeAutoSwitchWindows, isClaudeAtLimit, ClaudeAutoSwitchWindowName, ClaudeAutoSwitchWindow, isClaudeUsageReadingOf, and claudeAccountsShareRuntime; add the shared mover setting and decision summary vocabulary.
Decision table: off/under-line/recent-failure/cooldown/no-target stay; stale or missing usage requests a read; unknown status or active turn waits; idle over-line sessions move to the best eligible target with claim cooldowns and debits, while pinned sessions move only at the limit.
```

`git diff --stat 6e60fc18ac4eb9934f007acc6b0651b2b3b2a215..24902c029e0ee607583488a205dbd83bf6d4da04`:

```
.../claude-account-auto-switch-policy.ts           |   5 +
 .../claude-accounts/claude-account-auto-switch.ts  |   3 +
 .../claude-session-mover-policy.test.ts            | 158 ++++++++++++++++++++
 .../claude-accounts/claude-session-mover-policy.ts | 162 +++++++++++++++++++++
 src/shared/claude-account-switch-settings.ts       |   6 +
 src/shared/default-global-settings.ts              |   1 +
 src/shared/managed-account-types.ts                |  19 +++
 7 files changed, 354 insertions(+)
```

## Scope and behavior

- Added the shared `'off' | 'ask' | 'move'` setting type, optional `claudeSessionMover` field, and default `'ask'` next to `claudeAutoSwitchEnabled`.
- Added `ClaudeSessionMoveSummary` and optional `sessionMover` / `sessionMoves` fields for backward-compatible account state.
- Exported the existing windows, window types, at-limit predicate, usage attribution and runtime comparison under the exact names in Task 5.
- Added the supplied pure policy and decision table tests: off/under-line/cooldown/failure hold/no target stay; missing or stale readings request usage at the poll interval; unknown or active turn status waits; idle over-line sessions select the eligible target with most room; pinned sessions require the hard limit; recent target claims exclude accounts and older claims debit usage for one session cooldown.
- Shared thresholds remain 95% session, 90% weekly and Fable weekly; normal candidate headroom minimum is ten points, with the existing at-limit exception allowing any positive room. No I/O or timers were added; the policy takes `now` as input.
- New files are 162 physical lines (policy) and 158 (tests), under the requested approximately 200-line size. Existing files retain their prior organization; no lint rule was disabled.

## Test-first evidence and gates

Environment: `N_PREFIX=$HOME/.n-orca`, `PATH=$HOME/.n-orca/bin:$PATH`, `ORCA_BACKGROUND_LAUNCH=1`; every pnpm invocation used Corepack. Logs are in `/Users/nachumieliyahu/Documents/claude/orca-fork/.git/task5/`.

| Gate | Exact Vitest summary / result | Log |
| --- | --- | --- |
| Existing auto-switch suites after export-only change | `Test Files 2 passed (2)`; `Tests 39 passed (39)` | `exports-tests.log` |
| New test before implementation | Exit 1; `Cannot find module './claude-session-mover-policy'`; `Test Files 1 failed (1)`; no tests collected | `policy-red.log` |
| New policy suite after implementation | `Test Files 1 passed (1)`; `Tests 9 passed (9)` | `policy-only.log` |
| New policy plus both auto-switch suites | `Test Files 3 passed (3)`; `Tests 48 passed (48)` | `policy-green.log` |
| Entire Claude-account directory | `Test Files 29 passed \| 1 skipped (30)`; `Tests 311 passed \| 3 skipped (314)` | `claude-accounts.log` |
| Node typecheck | Exit 0 | `typecheck-node.log` |
| Oxlint, plugin lint, ast-grep, React Doctor, formatter check | All five exit 0 across seven changed files | `lint.log` |
| Commit hook | All five lint/format stages passed and applied cleanly | `commit.log` |

Test commands:

```sh
corepack pnpm exec vitest run --config config/vitest.config.ts src/main/claude-accounts/claude-account-auto-switch.test.ts src/main/claude-accounts/claude-account-auto-switch-policy.test.ts
corepack pnpm exec vitest run --config config/vitest.config.ts src/main/claude-accounts/claude-session-mover-policy.test.ts
corepack pnpm exec vitest run --config config/vitest.config.ts src/main/claude-accounts/claude-session-mover-policy.test.ts src/main/claude-accounts/claude-account-auto-switch-policy.test.ts src/main/claude-accounts/claude-account-auto-switch.test.ts
corepack pnpm exec vitest run --config config/vitest.config.ts src/main/claude-accounts --maxWorkers=4
corepack pnpm run typecheck:node
```

Changed-file lint commands used `corepack pnpm exec` with `oxlint`, `oxlint --config config/oxlint-js-plugins.json`, `ast-grep scan --config config/sgconfig.yml --min-severity warning`, `oxlint --config config/oxlint-react-doctor.json`, and `oxfmt --check`; exact path arguments and exit codes are recorded in `lint.log`.

## Deviations from the plan text

1. The dispatch-required commit subject was used instead of the shorter subject in the plan's sample command; the body lists the exported pieces and decision table on one line each, as requested.
2. Repository `oxfmt` expanded long lines and adjusted wrapping. The supplied policy and nine test cases retain their content and intent without symbol renames or behavioral changes.
3. Insertions were located by `ClaudeAccountSwitchSettings`, `claudeAutoSwitchEnabled`, `ClaudeRateLimitAccountsState`, and the named policy functions, not the plan's historical line numbers. No upstream adaptation or coordinator clarification was needed.
4. The full Claude-account gate uses four workers to bound resource use. Existing three skipped tests in one file remain unchanged; none were added or weakened. Vitest's missing-module wording is `Cannot find module` rather than the plan's historical `Failed to load url`, with the same expected red outcome.

The direct Vitest commands emitted an existing Vite warning about future native config-loader support for ESM syntax in CommonJS config files; all required green gates exited 0. No unrelated config change was made.

## Push

Command: `git push origin blowzer/session-mover`, exit 0, with identity hooks enabled.

```
To https://github.com/A2Z-Operations/orca.git
   6e60fc18ac..24902c029e  blowzer/session-mover -> blowzer/session-mover
```

Local HEAD and `origin/blowzer/session-mover` both equal `24902c029e0ee607583488a205dbd83bf6d4da04`. No force push or amendment was used; no remaining Task 5 work or unresolved questions.
