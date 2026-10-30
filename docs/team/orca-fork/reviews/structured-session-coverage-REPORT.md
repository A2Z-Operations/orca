# Native-chat Claude sessions on the pool, proxy, and mover

Date: 2026-10-30. Branch: `nachumi-a2zoperations/structured-session-claude-coverage`, off `blowzer/session-mover` at `c511409fff0`. Code commit: `696f46a3206`. Not pushed.

## What was true before

Verified by reading the launch path. The old process was not executed as a separate runtime; the tests below lock the fixed behavior.

`basis.launchEnv()` in `structured-agent-launch-composition.ts` is the user per-agent overlay (`resolveAgentLaunchEnv`), not `ClaudeProfileRouter.launchEnv()`. The router runs inside `resolveClaudeStructuredLaunchHome`: `prepareLaunch` → `withAuthProxy` → `applyClaudeEnvPatch`. The child received `ANTHROPIC_BASE_URL` when the proxy was up, `settings.claudeAuthProxy === true`, an account was present, and the child env did not already have that variable. A user-set URL was kept (`noteUserAnthropicBaseUrl`) and the slot just allocated stayed unbound until the 30s prune (`CLAUDE_AUTH_PROXY_UNBOUND_SLOT_GRACE_MS`). Even when the URL was applied, nothing called `recordClaudePaneAccount`, so prune treated the slot as unbound and released it while the child still held the URL. Every acquire called `prepareLaunch`, and each call takes a new slot. Nothing called `forgetClaudePaneAccount` on close. `collectClaudeMoverSessions` only saw registry rows and transcript-inferred PTYs. The pool pick lived only in `resolveRuntimeClaudeAuth` (PTY). `sessions:` counted only those registry rows.

## Design

The registry map key stays `ptyId`, so PTY call sites are unchanged. A native chat stores `ptyId` and `paneKey` as `structuredClaudeSessionKey(sessionId)`, which is `structuredAgentSessionPaneKey(structuredAgentSessionTabId(sessionId), sessionId)` — the same key the hook status row uses. The record also stores `surface: 'chat'`, `worktreeId` (the launch `workspaceId`), `providerSessionId`, `accountId`, `configDir`, `launchedAt`, `source` (`spawn` or `pool`), `assignedAccountId`, `proxySlot`, and `launchSelectionId` (the host selection at that launch). A pool pick changes `accountId` without changing `launchSelectionId`, so the next turn does not re-pool just because headroom moved.

Account order matches a PTY launch. `assignedAccountForResume` wins. Otherwise, while `launchSelectionId` is still the selected account, the recorded account and slot are kept. A selection change follows the new selection or, when `claudeAccountPool` is on, `chooseClaudePoolAccount`. A user `CLAUDE_CONFIG_DIR` skips the pool and is restored after the patch. A user `ANTHROPIC_BASE_URL` (not one of our slots) stays on the child, the unused slot is released immediately, and the record is pinned. A foreign loopback slot URL is dropped before the patch, as on the PTY path. A caller with no session id still only calls `prepareLaunch`: no pool, no registry row, and an unused slot is released.

Each acquire still runs preparation, so setup still happens. When the recorded slot is still live (`slotBaseUrl` is non-null), the fresh slot is released and the child env is set back to the recorded URL. A dead recorded slot keeps the new URL.

The slot is forgotten only in `finalizeClaudePublishedSession`, immediately after `sessions.delete`, which is a proved close. `observeClaudeSessionExit` does not forget. An unexpected exit can respawn the same session and must reuse the record and the slot. If the process dies and nobody re-acquires or proves a close, the slot stays bound until that close. That is the trade the reuse rule requires.

A chat is not relaunched under another account home. `claudeLaunchResumesTranscript` still throws `historyInOtherAccount` when the transcript is in a different home, and `createResumeMoveStrategy` is a TUI `--resume` PTY spawn. Evaluation therefore uses the proxy strategy only. With no slot it skips with detail `structured-needs-proxy` (after the pane and worktree checks, before a target is claimed) and does not write a hand-off note. History records `strategy: 'proxy'` when the chat has a slot, omits `strategy` when it does not (it is not labeled `resume`), and sets `chat: true`. The summary reason stays `skipped`.

`orca account list` prints `sessions: N` and appends ` (1 chat)` or ` (N chats)` only when `chatCount > 0`, so a terminal-only count stays `sessions: 2`. Recent moves (CLI and Settings, both `formatClaudeSessionMoveLine`) append `  chat`. The tab chip is the existing `ClaudePaneAccountBadge` (`Badge` variant `hostContext`). `ClaudePaneAccountMark` takes the tab's `nativeChat` and looks up the structured pane key; a terminal tab still uses the focused PTY. `accounts.listClaudeAccounts` counts registry rows by billing id, so a chat row is included with no plugin change. The phone `chatStatus.claudeAccountId` is stamped at projection time by `claudeAccountIdForPaneKey` (the billing id even when it equals the spawn account). It is not added to `AgentStatusIpcPayload`, which the codec would strip.

No-session and PTY records do not gain `surface`. `chatCount` is omitted when it is 0 so existing `toEqual` session lists stay exact.

## Files

- `src/main/claude/claude-structured-session-key.ts` — pane key for one chat
- `src/main/claude/claude-structured-pane-account.ts` — pool and resume choice, slot reuse, unused-slot release
- `src/main/claude/claude-structured-launch-home.ts` — record the chat, pin a user dir, drop a foreign slot URL
- `src/main/claude/claude-structured-launch-resolution.ts` — pass session id, provider session, workspace
- `src/main/claude/claude-structured-session-close.ts` — forget on a proved close
- `claude-pane-account-registry.ts` — `surface`, `worktreeId`, `launchSelectionId`, `claudeAccountIdForPaneKey`
- `claude-profile-router.ts` — `selectedAccountId()`
- `claude-session-mover-sessions.ts` — synthesize provider session and workspace from the record
- `claude-session-mover-evaluation.ts` — `structured-needs-proxy`
- `claude-session-mover-history.ts` — `chat: true`, no fake `resume` strategy
- `claude-listed-pane-accounts.ts`, `account-list-format.ts`, `claude-session-move-line.ts`, `managed-account-types.ts` — chat count and move label
- `runtime-mobile-structured-tab-status.ts`, `runtime-mobile-session-tab-contracts.ts` — phone `claudeAccountId`
- `ClaudePaneAccountBadge.tsx`, `SortableTab.tsx` — chip on the chat tab

## Tests

Node v24.22.0. `corepack pnpm exec vitest run --config config/vitest.config.ts` on the suites below. All passed (81 tests across these files, plus the idle-stream re-run).

- `claude-structured-pane-account.test.ts` (6) — slot on the child and the record, second launch reuses that slot, user URL releases the unused slot, pool pick sticks across a later turn, a selection change follows the new account, `sessions: 2 (1 chat)`, move line ends `chat`, mover view uses the record's workspace and main-agent state
- `claude-structured-launch-account-routing.test.ts` (4) — selection still wins for a caller that changes it, including the system-default third call; history-in-another-account still refuses
- `claude-launch-routing.test.ts` (3) — a launch with no session id does not record or pool
- `claude-auth-proxy-slot-hygiene.test.ts` (3) — a later preparation reuses the chat slot; a user URL releases the unused slot; forget releases the chat slot
- `claude-session-mover.test.ts` (16) — chat with no slot skips `structured-needs-proxy` and does not resume; a proxy move during a turn keeps the same key
- `claude-session-move-strategy.test.ts` (8) — proxy flip of a chat key returns that key and does not touch a process
- `claude-structured-session-close.test.ts` (6), `claude-pane-account-registry.test.ts` (8), `claude-pane-account-assign.test.ts` (1)
- `runtime-mobile-structured-tab-status.test.ts` (2) — phone status gets the billed account, not the spawn account
- `account-list-format.test.ts` (2), `account-pool.test.ts` (4), `host-env/claude-pane-account.test.ts` (8), `spawn-replacement-addendum.test.ts` (10) — terminal `sessions: N` is unsuffixed

`typecheck:node`, `typecheck:web`, and `typecheck:cli` exited 0. `typecheck:web` was run again after the chip started taking `nativeChat`. `oxfmt --check`, `oxlint`, and anti-slop on the 25 changed files were clean. The pre-commit lint-staged run (oxlint, ast-grep, react-doctor, oxfmt) passed.

`pnpm check:changed --base=blowzer/session-mover --maxWorkers=2` ran 26 checks against `c511409fff0` and failed 3. `oxlint` rejected `SortableTab.tsx` at 411 lines (max 400). The pane-key lookup moved into `ClaudePaneAccountMark`, and a one-line `shellForIcon` local was inlined, so the file is back at the limit. `flaky-test-pattern-ratchet` counted 2 `Date.now()` calls in `claude-auth-proxy-slot-hygiene.test.ts` (baseline 0, because the file had not been in the changed set before). Those calls age a slot against the prune's own clock; both lines now have `ast-grep-ignore: test-no-wall-clock`. Re-ran oxlint, the flaky ratchet, format, and anti-slop on the fixed tree: clean. The unit-test check failed 24 tests. Twenty-three are this machine's global `commit-msg` hook refusing fixture authors (`Orca Test`, `Worktree Removal`, `Test User`, `Test`) in `orca-runtime.test.ts`, `runtime-interrupted-local-worktree-removal.test.ts`, `runtime-git-stage-worktree-scope.test.ts`, and `ephemeral-vm-provisioned-root-ref.test.ts`. The same hook failure is already noted on this branch. The other, `claude-auth-proxy.test.ts` "cuts an idle stream at the configured budget and keeps an active stream", was `Error: aborted` inside that 28-minute related run. Re-run alone, that test passed. The related suite was not repeated after the lint-only fixes.

The tab chip was not opened in Electron. Launching a window would take focus on this desktop. The chip is the existing badge, now keyed by the structured pane key.

## Not covered

WSL and remote structured sessions. `isNativeLocalLocation` already rejects a non-local structured launch, and this path does not add a guest slot. Codex and ACP sessions are not in the Claude registry.

A chat whose transcript lives in another account home is still not moved by relaunching it there. With the proxy off, the mover skips it (`structured-needs-proxy`) instead of the resume strategy.

## Hand check

`orca agent launch --agent claude`, then `orca account list` (the row should include `(1 chat)` once the session is up and the proxy recorded a slot). `orca account session-mover --agent claude --move` should flip that chat when the proxy is on, and skip it with `structured-needs-proxy` when the proxy is off. The native-chat tab should show the same account chip as a terminal pane. Closing the chat should drop the slot from `orca account auth-proxy --agent claude --status`.
