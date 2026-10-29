# Task 8 — mover-observability
Repo: A2Z-Operations/orca, fresh worktree off blowzer/session-mover (head d40a1caf472 — pool, proxy remote hosts, robustness, durable jobs, plugin API are ALL merged now; read docs/team/orca-fork/reviews/merge-phase2-REPORT.md and pool-surface-REPORT.md too). Commit as Nachumi Eliyahu <nachumi@a2zoperations.com> only, no Co-Authored-By / AI trailers. Do not push. Never print tokens. Tests: `corepack pnpm exec vitest run --config config/vitest.config.ts <paths>`; typecheck: `corepack pnpm run typecheck:node|web|cli`. Read first: docs/team/orca-fork/reviews/proxy-strategy-REPORT.md, mover-quiet-wait-REPORT.md, mover-handoff-note-REPORT.md, durable-background-jobs-REPORT.md + -FOLLOWUP.md, and the phase-2 plan section pasted below (the whole plan is at ~/Documents/claude/BLOWzer/docs/superpowers/plans/2026-10-29-orca-account-pool-and-upstream.md). Adapt and report instead of asking; if a sibling task (named in the plan) owns a file you need, keep your change minimal and note the seam in the report. Finish with a report at docs/team/orca-fork/reviews/<task>-REPORT.md (git add -f) and worker_done --outcome --report-path.

### Task 8: Mover and pool observability + mobile

- [ ] `orca account moves` already from Task 3; add the same list to the Settings accounts pane
      ("Recent moves") and to the mobile notification stream (orcad path already dispatches
      `dispatchMobileNotification`).
- [ ] Metrics in `orca-stats.json`-style local stats: moves per strategy, rebalances, failures.

