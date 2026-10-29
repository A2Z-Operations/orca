# Durable background jobs: follow-up (test fix, hand-off integration, packaging)
Repo: A2Z-Operations/orca, branch blowzer/session-mover (fresh worktree). Commit as
Nachumi Eliyahu <nachumi@a2zoperations.com> only, no AI trailers. Do not push. Tests:
`corepack pnpm exec vitest run --config config/vitest.config.ts <paths>`. Adapt, don't ask. worker_done with --report-path.

Context: db81938beb (merged) added the PreToolUse hook + `orca job` CLI + plugin injection
(src/main/claude/durable-background-job*.{ts,mjs}, src/main/ipc/pty/host-env/durable-background-job.ts,
spawn-options-assembly.ts). Report: docs/team/orca-fork/reviews/durable-background-jobs-REPORT.md.
The hand-off note (89e8db05f0, merged): src/main/claude-accounts/claude-session-move-handoff-note.ts / -handoff.ts.

1. **Broken test**: src/main/ipc/pty/pty-agent-pane-launch.test.ts "starts the host's planned command
   once…" expects `command: 'claude'` and now gets `claude --plugin-dir …/orca-durable-jobs`. Fix it the
   right way: the test's spawn context should not inject the plugin (e.g. the fixture sets
   ORCA_DURABLE_JOBS=0 or the injection is keyed off a flag the test leaves unset) OR update the
   expectation if every Claude launch is meant to carry the plugin. Check the four other failing files
   in src/main/ipc (pty-attach-view-joins-main-start, pty-claude-agent-view-readiness,
   pty-spawn-scaling.performance) — they fail on the base too (env-only); confirm and leave them.
2. **Hand-off integration**: the mover's note must call `formatSurvivingJobNote` with the dying
   session's surviving jobs (listJobs() filtered by session id from request.json) instead of saying
   all background jobs ended. Tests.
3. **Packaging**: `ensureDurableBackgroundJobPlugin` reads the two .mjs files from the repo layout
   and silently skips in a packaged app. Make the packaged `/Applications/Orca.app` ship them
   (electron-builder extraResources or bundle them next to the agent-view plugin assets — look at
   how `orca-agent-view` plugin files reach the app: grep claude-agent-view) and resolve the path in
   both dev and packaged runs. Prove with `corepack pnpm run build:desktop` that the files land in
   out/ or resources.
4. **Permissions**: the rewritten command prompts in non-bypass sessions. Make the waiter command
   match a stable allow pattern and document the one-line allow rule (or auto-allow via the hook's
   permissionDecision if Claude Code 2.1.312 supports it for PreToolUse — verify).
5. **Sweeper**: remove `pending` request dirs older than 1h and exited jobs older than 7 days, and
   old content-hash plugin dirs, at orcad/app start. Tests.
Report → docs/team/orca-fork/reviews/durable-background-jobs-FOLLOWUP.md.
