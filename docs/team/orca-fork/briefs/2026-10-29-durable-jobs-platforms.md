# Task 6 — durable-jobs-platforms
Repo: A2Z-Operations/orca, fresh worktree off blowzer/session-mover (head a9d2f353274). Commit as Nachumi Eliyahu <nachumi@a2zoperations.com> only, no Co-Authored-By / AI trailers. Do not push. Never print tokens. Tests: `corepack pnpm exec vitest run --config config/vitest.config.ts <paths>`; typecheck: `corepack pnpm run typecheck:node|web|cli`. Read first: docs/team/orca-fork/reviews/proxy-strategy-REPORT.md, mover-quiet-wait-REPORT.md, mover-handoff-note-REPORT.md, durable-background-jobs-REPORT.md + -FOLLOWUP.md, and the phase-2 plan section pasted below (the whole plan is at ~/Documents/claude/BLOWzer/docs/superpowers/plans/2026-10-29-orca-account-pool-and-upstream.md). Adapt and report instead of asking; if a sibling task (named in the plan) owns a file you need, keep your change minimal and note the seam in the report. Finish with a report at docs/team/orca-fork/reviews/<task>-REPORT.md (git add -f) and worker_done --outcome --report-path.

### Task 6: Durable jobs — Monitor tool, TaskStop forwarding, Windows/WSL

**Files:** `src/main/claude/durable-background-job*.{ts,mjs}`, `src/main/ipc/pty/host-env/durable-background-job.ts`.

- [ ] Monitor tool: the same PreToolUse rewrite for Claude's `Monitor` (verify its tool name and input
      shape on Claude Code 2.1.312; if it cannot be detached safely, document why and leave it).
- [ ] TaskStop: the waiter forwards SIGTERM/SIGINT to the job's process group so stopping the task in
      Claude stops the job (today it only stops the tail). Keep `orca job stop` as the explicit path.
- [ ] Windows: a detached job via `start /b` + job object or `wmic`/`powershell Start-Process -WindowStyle Hidden`;
      WSL: `setsid` inside the guest. Guard, test per platform with the existing platform matrix
      helpers (`docs/agents-md-refs/cross-platform-support.md`).
- [ ] Permission rule: ship the one-line allow pattern in docs and, if Claude Code supports it,
      `permissionDecision: allow` from the hook for the rewritten waiter only.

