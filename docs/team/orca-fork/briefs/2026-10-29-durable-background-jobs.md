# Background jobs that survive a Claude restart

Repo: A2Z-Operations/orca, base branch blowzer/session-mover (you are in a child worktree of it). Commit as Nachumi Eliyahu <nachumi@a2zoperations.com> only, no Co-Authored-By / AI trailers. Do not push. Never print tokens or secrets. Run tests with `corepack pnpm exec vitest run --config config/vitest.config.ts <paths>`; typecheck with the package.json typecheck scripts. Finish with worker_done (outcome, files, --report-path). Adapt and report instead of asking.

## Problem

Claude Code's Bash run_in_background and Monitor tasks are child processes of the claude process.
When Orca's session mover restarts the session on another account, they die. Goal: long-running
background commands launched from an Orca-managed Claude session keep running across the restart
and their output stays reachable.

## Explore first (report what you find, then prototype the best option)

- Orca injects a Claude plugin per profile: `--plugin-dir ~/Library/Application Support/orca/
  claude-agent-view/<hash>/orca-agent-view` (hooks/ inside; source in this repo — find it, grep
  "orca-agent-view"). Claude Code hooks: PreToolUse can return hookSpecificOutput.updatedInput to
  rewrite the tool input (verify against the installed Claude Code 2.1.312 docs/behaviour).
- Option A (hook): PreToolUse on Bash when run_in_background is true: rewrite `command` so the real
  work runs detached under Orca's terminal daemon (orcad / the PTY host — see src/main/runtime and
  the `orca terminal create` path) or at least under `setsid nohup … > <orca job log> 2>&1`,
  while the command Claude sees tails that log so Claude's task tracking still works. Check what
  Claude's background-task bookkeeping needs (exit code, output file) and whether a detached
  process confuses it.
- Option B (Orca job API): a tiny `orca job start/status/logs` on the daemon that the hook routes
  commands into; the resumed session can `orca job list` to find its jobs again.
- Explain trade-offs (sandbox/permissions mode, cwd/env capture, Windows/WSL out of scope, cleanup
  of orphaned jobs, how the mover's hand-off note can reference surviving jobs by id).
  Prototype the recommended option end-to-end on macOS: launch a session, start a 2-minute
  background job, restart the session with `claude --resume`, prove the job finished and its output
  is readable from the resumed session. Unit tests for the hook rewriting logic.
  Report → docs/team/orca-fork/reviews/durable-background-jobs-REPORT.md with commit hash.
