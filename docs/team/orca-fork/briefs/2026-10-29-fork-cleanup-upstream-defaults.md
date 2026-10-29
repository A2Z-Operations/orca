# Task 10 — fork-cleanup-upstream-defaults
Repo: A2Z-Operations/orca, fresh worktree off blowzer/session-mover (head d40a1caf472 — pool, proxy remote hosts, robustness, durable jobs, plugin API are ALL merged now; read docs/team/orca-fork/reviews/merge-phase2-REPORT.md and pool-surface-REPORT.md too). Commit as Nachumi Eliyahu <nachumi@a2zoperations.com> only, no Co-Authored-By / AI trailers. Do not push. Never print tokens. Tests: `corepack pnpm exec vitest run --config config/vitest.config.ts <paths>`; typecheck: `corepack pnpm run typecheck:node|web|cli`. Read first: docs/team/orca-fork/reviews/proxy-strategy-REPORT.md, mover-quiet-wait-REPORT.md, mover-handoff-note-REPORT.md, durable-background-jobs-REPORT.md + -FOLLOWUP.md, and the phase-2 plan section pasted below (the whole plan is at ~/Documents/claude/BLOWzer/docs/superpowers/plans/2026-10-29-orca-account-pool-and-upstream.md). Adapt and report instead of asking; if a sibling task (named in the plan) owns a file you need, keep your change minimal and note the seam in the report. Finish with a report at docs/team/orca-fork/reviews/<task>-REPORT.md (git add -f) and worker_done --outcome --report-path.

### Task 10: Clean the fork for contribution

- [ ] Fix the fork-caused ratchets: `runtime-electron-ratchet` (our `updater-disabled.ts` and the
      `system-language.ts` touch), process-host import boundary baseline for `durable-background-job.mjs`
      done right (not a baseline bump). `pnpm check:changed` must be fully green except the two
      machine-only real-git fixtures (document them; upstream CI will pass them).
- [ ] Separate fork-only commits (updater kill switch, `ORCA_NO_PUBLISH` packaging, BLOWzer docs) onto
      `blowzer/fork-only` so the feature branches are pure.
- [ ] Defaults for upstream: `claudeAuthProxy` **off**, `claudeAccountPool` off, `claudeSessionMover`
      `ask` (headless = move stays), `claudeAutoSwitchEnabled` false. The fork keeps its own defaults
      in `blowzer/fork-only`.
- [ ] Seven locales complete for every string this programme added (Task 3 did the pool; audit
      auto-switch, mover, proxy, durable jobs, hand-off note).
- [ ] Docs in upstream style: `docs/reference/claude-accounts.md` (accounts, auto-switch, mover,
      proxy, pool, durable jobs; policy lines; failure modes; CLI), linked from the docs index. No
      BLOWzer names anywhere.


Clarifications: (a) create branch `blowzer/fork-only` from the current head holding ONLY the fork-specific commits re-applied (updater kill switch `src/main/updater/updater-disabled.ts` + its wiring, ORCA_NO_PUBLISH packaging bits, BLOWzer docs under docs/team); then make `blowzer/session-mover` upstream-pure by reverting those pieces there with a clear commit (the leader builds fork releases from `blowzer/fork-only` merged on top of `blowzer/session-mover`). (b) The defaults flip (proxy off, pool off, mover ask, auto-switch off) goes on `blowzer/session-mover`; `blowzer/fork-only` re-applies the fork defaults (proxy on, pool on, mover move, auto-switch on). (c) Audit all seven locales for every key added since upstream tag v1.4.243 (`git diff v1.4.243 -- src/renderer/src/i18n/locales/en.json` lists the keys) and fill every gap in es/fr/ja/ko/pt/zh for THOSE keys only. (d) The docs page lives at docs/reference/claude-accounts.md and is linked from the docs index that upstream uses (find it).
