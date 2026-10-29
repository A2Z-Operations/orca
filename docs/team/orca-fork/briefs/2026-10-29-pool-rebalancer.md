# Task 2 — pool-rebalancer
Repo: A2Z-Operations/orca, fresh worktree off blowzer/session-mover (head a9d2f353274). Commit as Nachumi Eliyahu <nachumi@a2zoperations.com> only, no Co-Authored-By / AI trailers. Do not push. Never print tokens. Tests: `corepack pnpm exec vitest run --config config/vitest.config.ts <paths>`; typecheck: `corepack pnpm run typecheck:node|web|cli`. Read first: docs/team/orca-fork/reviews/proxy-strategy-REPORT.md, mover-quiet-wait-REPORT.md, mover-handoff-note-REPORT.md, durable-background-jobs-REPORT.md + -FOLLOWUP.md, and the phase-2 plan section pasted below (the whole plan is at ~/Documents/claude/BLOWzer/docs/superpowers/plans/2026-10-29-orca-account-pool-and-upstream.md). Adapt and report instead of asking; if a sibling task (named in the plan) owns a file you need, keep your change minimal and note the seam in the report. Finish with a report at docs/team/orca-fork/reviews/<task>-REPORT.md (git add -f) and worker_done --outcome --report-path.

### Task 2: Pool rebalancer — early proxy moves to even out the pool

**Files:** `claude-session-mover-policy.ts` (`decideClaudeSessionMove`), `-evaluation.ts`, `-history.ts`,
`claude-session-move-strategy.ts` (`proxy` strategy), `claude-auth-proxy/*`.

- [ ] Add a second decision input `pool: { enabled, spreadLine }`: when the pool is on and the session
      runs through the proxy (registry has a slot), move it **before** the 95/90 lines when
      `ownHeadroom < bestCandidateHeadroom - CLAUDE_POOL_REBALANCE_GAP_PTS (default 25)` and
      `bestCandidateHeadroom >= 30`. Resume-strategy sessions keep the old lines (a restart is not cheap).
- [ ] Rate-limit the rebalancer: at most one proxy move per pane per `CLAUDE_POOL_REBALANCE_COOLDOWN_MS`
      (15 min), and the existing target claims/debit so five panes do not pile onto one account in a
      tick. New reason `'rebalance'` in `ClaudeSessionMoveReason`, decisions list, notices
      ("… continues on <to> to balance your accounts").
- [ ] Prompt-cache awareness: a proxy flip costs one cache miss. Do not rebalance a pane whose last
      turn ended < 2 min ago (likely mid-conversation burst) unless over the hard line. Read
      `turnEndedAt` from the hook status entry (extend `AgentHookStatusChangeEntry` like
      `mainAgentState` was).
- [ ] Tests for every branch above, plus a lifecycle test: three panes on A at 60/60/60, B at 5 → one
      pane moves per cooldown until the gap closes.

