# Task 1 — pool-policy
Repo: A2Z-Operations/orca, fresh worktree off blowzer/session-mover (head a9d2f353274). Commit as Nachumi Eliyahu <nachumi@a2zoperations.com> only, no Co-Authored-By / AI trailers. Do not push. Never print tokens. Tests: `corepack pnpm exec vitest run --config config/vitest.config.ts <paths>`; typecheck: `corepack pnpm run typecheck:node|web|cli`. Read first: docs/team/orca-fork/reviews/proxy-strategy-REPORT.md, mover-quiet-wait-REPORT.md, mover-handoff-note-REPORT.md, durable-background-jobs-REPORT.md + -FOLLOWUP.md, and the phase-2 plan section pasted below (the whole plan is at ~/Documents/claude/BLOWzer/docs/superpowers/plans/2026-10-29-orca-account-pool-and-upstream.md). Adapt and report instead of asking; if a sibling task (named in the plan) owns a file you need, keep your change minimal and note the seam in the report. Finish with a report at docs/team/orca-fork/reviews/<task>-REPORT.md (git add -f) and worker_done --outcome --report-path.

### Task 1: Pool policy — choose the account with the most headroom at launch

**Files:** `src/main/claude-accounts/claude-account-selection.ts` (selected-account resolution),
`claude-account-auto-switch-policy.ts` (`claudeAutoSwitchHeadroom`, lines 95/90/90),
`claude-profile-router.ts` (`launchEnv`/`launchEnvFor`), `src/main/ipc/pty/runtime/spawn-claude-auth.ts`
(where a spawn picks its account), `src/shared/claude-account-switch-settings.ts`,
`default-global-settings.ts`, `managed-account-types.ts`.

- [ ] New pure module `claude-account-pool-policy.ts`: `chooseClaudePoolAccount({ accounts, usage, now, pinnedCounts, assignedCounts })`
      → the account with the greatest headroom (min over 5h / weekly / Fable-weekly windows, same
      `claudeAutoSwitchHeadroom` maths), tie-break by fewest assigned sessions, then by stable order.
      Candidates must be signed-in, fresh usage (reuse `isFresh`), not in a failure hold. A stale
      candidate counts as "unknown" and is skipped unless every candidate is stale (then fall back to the
      selected account). Export `CLAUDE_POOL_MIN_HEADROOM_PTS = 10`.
- [ ] Setting `claudeAccountPool?: 'off' | 'on'` (absent = off). When on, every Orca-made Claude launch
      (new pane, worker-start, resume by the mover, mobile cold restore) asks the pool policy instead of
      the selected account. A pane launched by hand (`claude` typed in a shell) stays pinned to its
      folder as today. The "selected account" remains what new **non-pooled** launches and the status
      bar show.
- [ ] Registry: every pooled launch records `source: 'pool'` and the assignment in
      `claude-pane-account-registry.ts`; `assignedCounts` come from `listClaudePaneAccounts()`.
- [ ] Tests: headroom choice, tie-break, stale skipping, all-stale fallback, pinned exclusion, min
      headroom, and a launch-path test proving `CLAUDE_CONFIG_DIR` follows the pool choice.

