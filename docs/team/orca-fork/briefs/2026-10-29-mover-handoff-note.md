# Mover: tell the resumed session what the restart killed

Repo: A2Z-Operations/orca, base branch blowzer/session-mover (you are in a child worktree of it). Commit as Nachumi Eliyahu <nachumi@a2zoperations.com> only, no Co-Authored-By / AI trailers. Do not push. Never print tokens or secrets. Run tests with `corepack pnpm exec vitest run --config config/vitest.config.ts <paths>`; typecheck with the package.json typecheck scripts. Finish with worker_done (outcome, files, --report-path). Adapt and report instead of asking.

## Context

The session mover restarts a Claude session on another account with `claude --resume <id>`
(src/main/claude-accounts/claude-session-move-strategy.ts → RuntimePtyController.spawn with
replacesPtyId / claudeAccountId; the resume plan comes from
src/shared/tui-agent-resume-startup.ts buildAgentResumeStartupPlan). The restart kills background
Bash tasks / Monitors that belonged to the old process and Claude Code does not restore them.

## Change

After a successful move, deliver ONE message into the resumed session so Claude knows what happened:
"Orca moved this session from <from email> to <to email> because <detail>. The restart ended any
background jobs and subagents of the previous process (<list what Orca knows>). Re-run what is still
needed, then continue." Rules:

- Send it only after the resumed Claude is ready for input (the hook server reports the new PTY's
  pane 'done' / provider session identity for the resumed session id; look at how
  src/main/agent-hooks/server exposes status per pane and at how the renderer/CLI writes to a PTY —
  `orca terminal send` goes through an RPC; find the main-side write path (runtime pty controller
  write) and use it). Fall back to a timeout + screen check, never send into a shell prompt.
- What Orca knows: the pre-move hook payload (workingMode 'monitoring', claudeRunningNonAgentTask,
  subagents[] with ids/agentType/state) — capture it in the mover before the move
  (claude-session-mover-evaluation.ts has the view) and pass it to the strategy outcome.
- Setting: reuse claudeSessionMover; no new setting. Headless (orcad) path must work too.
- Keep the text in i18n (translateMain pattern in src/main/startup/main-process-account-services.ts).
  Tests: unit test for the note builder (pure) and a lifecycle test that the note is written once,
  after readiness, and not on a failed move.
  Report → docs/team/orca-fork/reviews/mover-handoff-note-REPORT.md with the commit hash.
