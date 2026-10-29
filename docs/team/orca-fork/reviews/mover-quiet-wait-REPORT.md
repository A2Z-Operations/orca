# Mover: bounded wait for a quiet moment

Date: 2026-10-29. Branch: `nachumi-a2zoperations/mover-quiet-wait-restart`. Feature commit: `ca35d8b9eb9761de0fdc94ad2311d64542fbca44`.

Not pushed.

## What it does

Commit `5ba4329a13` made mid-turn follow the main agent, so a pane whose main agent is `done` restarted at once even while a shell or monitor was still alive. The restart kills that background work.

The mover now holds that pane while background work is alive, for at most 10 minutes (`CLAUDE_SESSION_MOVE_BACKGROUND_WAIT_MS`), and never past the hard limit. Background work is `workingMode === 'monitoring'` or `claudeRunningNonAgentTask === true`. A live subagent without either signal does not count. If the main agent is not `done`, the decision stays `wait:mid-turn`.

The clock is `backgroundWaitAt`, one stamp per pty, set on the first `wait:background-work` and cleared only when that pane no longer has background work. An under-line stay while the work is still alive keeps the stamp. `startedAt` of 0 still waits. At exactly 10 minutes the decision is a move (`>=`). At `isClaudeAtLimit` the wait is skipped and the move or ask proceeds at once.

There is no timer. The bound is checked on the next evaluation, which is still a rate-limit change or a status change. A quiet pane can sit past 10 minutes until one of those events.

## Reason and notices

`ClaudeSessionMoveReason` includes `wait:background-work`. `orca account list` text prints `  session <ptyId>: <reason>` for each `sessionMoves` entry. JSON already carried the reason string.

Ask notices and successful move notices append ` (wait:background-work)` while the pane still has background work, including a move that happens because the wait expired or because the account is at the hard limit. The cooldown key stays the raw new pty id. Skipped and failed details are unchanged.

## Mixed versions

`backgroundWork` is optional and omitted when false. An older host that never sends it keeps today's immediate move. An older reader ignores the field.

## Files

- `src/main/agent-hooks/server/server-types.ts`, `server-listeners.ts` (`buildStatusChangeNotification`, which `getStatusChangeSnapshot` returns)
- `src/main/claude-accounts/claude-session-mover-policy.ts`, `-sessions.ts`, `-evaluation.ts`, `-history.ts`, `-types.ts`, `claude-session-mover.ts`
- `src/cli/handlers/account-list-format.ts`
- Tests: policy, sessions, lifecycle, fanout, account list, and the mover fixture

## Tests

Targeted vitest (`/opt/homebrew/bin/pnpm exec vitest run --config config/vitest.config.ts`, pnpm 12.14.0; `corepack pnpm` looks for a missing `pnpm.cjs`):

- `claude-session-mover-policy.test.ts`
- `claude-session-mover.test.ts`
- `claude-session-mover-lifecycle.test.ts`
- `claude-session-mover-sessions.test.ts`
- `server-status-listener-fanout.test.ts`
- `account-session-mover.test.ts`

6 files, 53 tests, all passed. Covered: wait under 10 minutes, move at the boundary, move at once at 100%, no wait without background work, mid-turn still wins, the stamp survives an under-line dip, and the stamp restarts after the work ends.

`pnpm tc:node` and `pnpm tc:cli` exited 0. lint-staged (oxlint, ast-grep, oxfmt) passed on the 15 files.

`pnpm check:changed --base=HEAD` also ran the related suite. Two gates failed, neither in these files: `runtime-electron-ratchet` already reports `src/main/updater/updater-disabled.ts`, and 24 related tests fail because the local `commit-msg` hook refuses fixture authors such as `Test <test@example.com>`, plus one 30s timeout in `profile-project-domain-transfer.test.ts`. A check against `origin/main` is the wrong base for this fork (about 32,000 files) and was not used as evidence.
