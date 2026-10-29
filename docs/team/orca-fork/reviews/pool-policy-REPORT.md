# Pool policy: the account with the most headroom at launch

Date: 2026-10-29. Branch: `nachumi-a2zoperations/pool-policy-task1`, off `blowzer/session-mover` at `f050bb3b07`. Not pushed.

## What it does

`claudeAccountPool` is `'off' | 'on'`. Absent means off, and the default settings object sets `'off'`. While it is off, launches behave as they do today. While it is on, an Orca-made Claude launch that would have used the selected account asks `chooseClaudePoolAccount` and launches on that choice.

The selected account stays the status-bar account and the account a non-pooled launch uses. `ClaudeProfileRouter.launchEnv` and `terminalEnv` are unchanged, so a `claude` typed into a shell keeps the folder that shell already has. The shell function still treats a foreign `CLAUDE_CONFIG_DIR` as pinned.

Headroom is `claudeAutoSwitchHeadroom`: the minimum of `line - used` over the live 5-hour (95), weekly (90), and Fable-weekly (90) windows. A window whose `resetsAt` is already past counts as empty. `CLAUDE_POOL_MIN_HEADROOM_PTS` is 10, and a candidate needs at least that many points. That floor is absolute headroom. Auto-switch's private 10-point figure is the gain required to switch, and it stays private.

## Choice

`chooseClaudePoolAccount({ accounts, usage, now, pinnedCounts, assignedCounts })` ranks signed-in accounts with a fresh reading, no failure hold, and no hand-pinned pane. Freshness is `isClaudeUsageFresh` (one poll, `DEFAULT_POLL_MS`), exported from the mover policy so the private `isFresh` still delegates to it. A stale or missing reading is unknown and is skipped. The greatest headroom wins. A tie breaks to the fewest assigned sessions, then to the order of `accounts`.

When nothing ranks, the result is the selected account with `kind: 'fallback'`. That covers every candidate being stale, and also a field that is signed out, held, under the floor, or pinned out, so the launch still has a folder. The result is null only when no account is selected and nothing ranked.

A positive `pinnedCounts[id]` removes that account from new pooled launches. `assignedCounts` still include those panes, and both maps bill `assignedAccountId` when the registry has one. The launch path sorts accounts by id before the pure function, so `list()`'s `updatedAt` order does not flap a tie.

## Launch

The decision sits in `resolveRuntimeClaudeAuth`, which every Orca-made Claude spawn already calls from preflight (new pane, worker terminal, mobile cold restore). Two earlier answers stay in front of the pool:

- An explicit `claudeAccountId`. A mover resume sets this to `toAccountId`, so that launch keeps the account the mover named.
- A remembered `assignedAccountForResume(sessionId)`, so a later resume of a session the proxy already moved stays on the billed account.

The pool replaces the selected-account fallback. A mobile cold restore sets `resumeProviderSession` and does not set `claudeAccountId`, so it asks the pool when nothing is remembered.

A choice whose account differs from the selected account calls `prepareLaunchFor` and is marked `pooled`. The selected account, including a fallback, uses `prepareClaudeAuth` and is also marked `pooled`. `prepareLaunchFor` throws for an unknown folder or a WSL account. That launch warns, uses the selected account, and is not marked pooled, so the registry does not claim a pool assignment the env did not apply. Task 5 owns a per-account WSL launch. A host pane also ignores accounts on another runtime.

`claudeLaunchPinsAccount` is true for an explicit account or any pooled preparation. Preflight then strips the selected account's pointer, injected marker, and `CLAUDE_CONFIG_DIR` before applying the patch, which is what makes `CLAUDE_CONFIG_DIR` follow the pool choice. The slot URL stays inside `prepareLaunchFor` / `withAuthProxy`. It is not added to `chosenAccountLaunchEnv`.

The reader is installed from `createProviderAccountServices`, including when the mover is not started. It returns before listing accounts unless the setting is `'on'`. Usage for the selected account is its own bar when the provenance matches, matching `claudeUsageForAccount`. Other accounts use their inactive rows. Polling also runs when the pool is on, so headroom is not stuck stale while the mover is off.

## Registry and the setting seam

A pooled launch records `source: 'pool'`, `pinned: false`, and `assignedAccountId` equal to the spawn account, even when there is no proxy slot yet. `assignedCounts` are `claudePoolSessionCounts(listClaudePaneAccounts())`.

`ClaudeAccountSelection.setAccountPool` and `ClaudeAccountService.setAccountPool` save the setting and return `list()`, which now includes `accountPool: 'on' | 'off'`. Task 3 owns the settings row, the status-bar badge, the locales, and `orca account pool`. This change does not add those.

## Tests

`vitest run --config config/vitest.config.ts` via pnpm 12.14.0 (`node` on corepack's `bin/pnpm.mjs`; `corepack pnpm` looks for `pnpm.cjs`, and the native shim is ENOEXEC on this Mac):

- `claude-account-pool-policy.test.ts`: greatest headroom across the three windows, a reset window counting as empty, tie-break by assigned count then input order, stale skip, all-stale fallback, a missing reading skipped, pinned exclusion, the 10-point floor, signed-out, a failure hold, and null when nothing is selected.
- `claude-account-pool-launch.test.ts`: counts from `listClaudePaneAccounts()`, a pinned account left out of the choice, a WSL account dropped for a host launch, and the selected account's own reading winning over an inactive row.
- `spawn-claude-auth.test.ts`: `CLAUDE_CONFIG_DIR` is the pooled account's folder and the selected pointer is stripped; an explicit account and a remembered resume stay ahead of the pool; a fallback is marked pooled and uses `prepareClaudeAuth`.
- `claude-pane-account.test.ts`: a pooled launch records `source: 'pool'` and `assignedAccountId`.
- `claude-usage-polling-policy.test.ts`: pool on polls, pool off does not.

5 files, 30 tests, passed. `oxlint` on the touched files reported 0 warnings. `typecheck:node`, `typecheck:web`, and `typecheck:cli` each exited 0.

## Left for the sibling tasks

- No account-level failure-hold store. `failureHoldUntil` is an input on the pure function. The launch binder passes none. The mover's per-pane hold stays in Task 2's files, apart from the `isClaudeUsageFresh` export. Task 2's rebalancer can call `chooseClaudePoolAccount`; this task does not move a live session.
- Nothing in the UI or CLI turns the pool on. Until Task 3, `setAccountPool('on')` is the switch.
- A WSL account is not given a pooled host env. The launch uses the selected account and does not record `source: 'pool'`.
- A full `pnpm check:changed` was not run. The five files above and the three typechecks were.
