# Task 3 — pool-surface
Repo: A2Z-Operations/orca, fresh worktree off blowzer/session-mover (head a9d2f353274). Commit as Nachumi Eliyahu <nachumi@a2zoperations.com> only, no Co-Authored-By / AI trailers. Do not push. Never print tokens. Tests: `corepack pnpm exec vitest run --config config/vitest.config.ts <paths>`; typecheck: `corepack pnpm run typecheck:node|web|cli`. Read first: docs/team/orca-fork/reviews/proxy-strategy-REPORT.md, mover-quiet-wait-REPORT.md, mover-handoff-note-REPORT.md, durable-background-jobs-REPORT.md + -FOLLOWUP.md, and the phase-2 plan section pasted below (the whole plan is at ~/Documents/claude/BLOWzer/docs/superpowers/plans/2026-10-29-orca-account-pool-and-upstream.md). Adapt and report instead of asking; if a sibling task (named in the plan) owns a file you need, keep your change minimal and note the seam in the report. Finish with a report at docs/team/orca-fork/reviews/<task>-REPORT.md (git add -f) and worker_done --outcome --report-path.

### Task 3: Pool surface — setting, CLI, account list, status bar badge

**Files:** `src/cli/specs/account.ts`, `src/cli/handlers/account-session-mover.ts` (template),
`account-list-format.ts`, `src/shared/rpc-contract/accounts-params.ts` + generated catalog,
`src/main/runtime/rpc/methods/accounts.ts`, `runtime-account-controller.ts`,
`src/renderer/src/components/settings/claude-session-mover-setting.tsx` (template),
`accounts-pane-claude-section.tsx`, `src/renderer/src/components/status-bar/ClaudeSwitcherMenu.tsx`,
terminal tab title/badge components (find where the Codex pane account badge is drawn — grep
`codex-pane-accounts`, `CodexRestartChip`).

- [ ] `orca account pool --agent claude --on|--off [--environment]`; `orca account list` prints
      `pool: on|off` and, per account, `sessions: <assigned count>`; `orca account moves` (new)
      prints the mover's last decisions with time, pane, from → to, reason, strategy (resume|proxy).
- [ ] Settings row "Spread sessions across accounts" next to the mover row, same component pattern.
- [ ] **Per-pane account badge**: a small chip in the terminal tab header showing the assigned
      account's short label, updated on every move (renderer subscribes to the registry snapshot
      already exposed for `account list`; add an RPC/IPC event `claudeAccounts:paneAssigned`). Follow
      `docs/STYLEGUIDE.md` tokens and shadcn primitives.
- [ ] All seven locales (`en, es, fr, ja, ko, pt, zh`) for every new string, through the project's
      localization scripts (`config/scripts/*localization*.mjs`); `verify-localization-catalogs` and
      `-extraction` must exit 0.
- [ ] Tests: CLI handler tests (mirror `account-session-mover.test.ts`), RPC method tests, a
      fixture screenshot of the badge (`pnpm fixtures:shot`).

