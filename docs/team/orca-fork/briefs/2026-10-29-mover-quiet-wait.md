# Mover: bounded wait for a quiet moment (background work) before restarting

Repo: A2Z-Operations/orca, base branch blowzer/session-mover (you are in a child worktree of it). Commit as Nachumi Eliyahu <nachumi@a2zoperations.com> only, no Co-Authored-By / AI trailers. Do not push. Never print tokens or secrets. Run tests with `corepack pnpm exec vitest run --config config/vitest.config.ts <paths>`; typecheck with the package.json typecheck scripts. Finish with worker_done (outcome, files, --report-path). Adapt and report instead of asking.

## Context

Commit 5ba4329a13 made mid-turn follow the MAIN agent, so a pane that is working/monitoring
(main agent done, a background Bash/Monitor still alive) now restarts at once — and the restart
kills that background work (child processes of claude). We want a middle: hold the move while
background work runs, but only for a bounded time, and never past the real limit.

## Files

- src/main/claude-accounts/claude-session-mover-policy.ts (decideClaudeSessionMove, ~line 125:
  paneState null → wait:no-status, !== 'done' → wait:mid-turn). Tests: claude-session-mover-policy.test.ts
- src/main/claude-accounts/claude-session-mover-sessions.ts (view.paneState from
  AgentHookStatusChangeEntry.mainAgentState ?? state), -types.ts (ClaudeSessionMoveReason),
  -evaluation.ts (reason strings), -history.ts, lifecycle tests, test fixture.
- src/main/agent-hooks/server/server-types.ts AgentHookStatusChangeEntry (state, mainAgentState);
  the hook payload also has workingMode ('monitoring') and claudeRunningNonAgentTask — see
  server-status-update.ts ~269 and server-claude-status-rules.ts.

## Change

1. Carry "background work alive" into the mover view: add optional `backgroundWork: boolean` (or
   expose workingMode) on AgentHookStatusChangeEntry filled in getStatusChangeSnapshot, and
   `paneBackgroundWork` on the view / policy inputs.
2. Policy: when main agent is done AND background work is alive AND the account is NOT yet at the
   hard limit (isClaudeAtLimit false): return { kind: 'wait', reason: 'background-work' } until the
   wait exceeds CLAUDE_SESSION_MOVE_BACKGROUND_WAIT_MS (default 10 min, measured from the first
   such wait per ptyId — history map like lastAskAt). After that, or at the hard limit, move.
3. New reason 'wait:background-work' in ClaudeSessionMoveReason, the account list / decisions
   output (src/cli/handlers/account-list-format.ts prints last decisions? check and extend), and
   the ask/move notice detail.
4. Tests for: waits under 10 min, moves after, moves immediately at the hard limit, no wait when
   no background work, timer resets when the work ends.
   Report → docs/team/orca-fork/reviews/mover-quiet-wait-REPORT.md with the commit hash.
