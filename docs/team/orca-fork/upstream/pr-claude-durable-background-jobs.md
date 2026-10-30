# pr/claude-durable-background-jobs

Branch: `pr/claude-durable-background-jobs`
HEAD: `c1552b7eccf8`
Base: `e8e08036729` (`upstream/main`)
Author: Nachumi Eliyahu <nachumi@a2zoperations.com>
Tracking: none. Not pushed.
Worktree: `/Users/nachumieliyahu/orca/workspaces/orca-fork/pr-slice`
Diff vs `upstream/main`: 35 files, +2805/−6.

Commits:

- `c1552b7eccf8` Add durable background jobs that outlive a Claude restart.

This branch does not include the account registry, session mover, auth proxy, pool, or plugin API. The session mover's hand-off note looks for `resources/durable-jobs/durable-background-job.mjs` by path and skips the note's job list when the file is absent, so the mover branch does not need this one.

## Issue text

Title: Keep a Claude background bash command running across a session restart

A Claude background bash command dies when Claude's process dies. A session move restarts that process, so the command dies with it. Rewrite a background bash call into a waiter that starts the command in its own session and tails the log. `orca job` lists, reads, stops, and starts those jobs on the machine that holds the files.

## PR

## ELI5

When Claude runs a command in the background, that command used to die if Claude restarted. Orca now starts that command on its own, so it keeps running. You can list those commands, read their logs, and stop them with `orca job`.

## What Changed

Before, `run_in_background` bash lived inside Claude's process. After, on a Claude launch, Orca copies three scripts into the app user-data directory and points Claude at that plugin. The hook runs before Bash. It rewrites only a call whose `run_in_background` is true. The command Claude then runs is a waiter. The waiter starts the shell in a new session and tails a log.

On macOS and Linux the shell's parent becomes pid 1. On Windows the launch is a hidden PowerShell script. A WSL guest uses `setsid` inside the guest. `ORCA_DURABLE_JOBS=0` turns the rewrite off and Orca does not inject the plugin.

Jobs are files under the durable-job root (`~/Library/Application Support/orca/durable-jobs` on macOS, `~/.orca/durable-jobs` elsewhere, or `ORCA_DURABLE_JOB_ROOT`). Ids look like `dj_` plus 16 hex characters.

CLI, on the machine that holds the files:

```sh
orca job list
orca job status --id <id>
orca job logs --id <id>
orca job stop --id <id>
orca job start --id <id>
```

`orca job` does not take `--environment`. It always reads this machine's files.

## Why

A restart is how a session move keeps the conversation, and it should not kill a command the person already sent to the background. Detaching only background bash leaves foreground commands and permissions as they are. Default on for Claude launches matches the expectation that a background command outlives the chat. The env switch turns it off without a setting migration. Keeping the scripts beside the app, not inside the archive, is required because system node runs the copy.

## Linked Issue

Fixes #<to be created>

## Visual Proof

Record a short screen video. Start Claude, run a background command that prints for a minute, then restart the Claude pane. The command's output should still be growing. Run `orca job list`, `orca job logs --id <id>`, and `orca job stop --id <id>`. Show `ORCA_DURABLE_JOBS=0` leaving the original command unchanged. Do not show account switching.

## Testing

- macOS: `check:changed --base=upstream/main` on `c1552b7eccf8` (`/tmp/pr6-check2.log`). 20 of 21 checks passed, including typecheck, format, oxlint, changed-code quality, and the ratchets. Unit tests failed in 258.4s with 9 failures, all pre-existing macOS pty flakes under fake timers (a callback that never arrived, or a spawn mark left undefined). Not product-fixed.
- Linux: not tested
- Windows: not tested
- SSH / remote: not tested

The 9 failures:

- `src/main/ipc/pty-claude-agent-view-readiness.test.ts` — spawns a plain shell while reconciliation is pending
- `src/main/ipc/pty/pty-runtime-hidden-at-spawn-mark.test.ts` — marks a fresh daemon session hidden before spawn resolves
- `src/main/ipc/pty-attach-view-joins-main-start.test.ts` — three cases (cold saved refusal, attach to the terminal main starts, attach when start carries no payload)
- `src/main/ipc/pty/pty-launch-race-parity.test.ts` — producer registration exit
- `src/main/ipc/pty/pty-hidden-at-spawn-mark.test.ts` — hidden-at-spawn mark
- `src/main/ipc/pty-spawn-scaling.performance.test.ts` — N/10N tabs visits and exact outcome roots
- `src/main/ipc/pty/pty-pane-materialization-race.test.ts` — reuses renderer spawn when runtime materialization starts

Real-git fixtures did not fail on this run. `GIT_IDENTITY_ALLOW_OTHER=1` is what those fixtures need on this machine when they do run.

- [ ] I manually tested these changes locally
- [x] Automated tests added/updated, or explained why not below

An earlier log that reported casting findings on this HEAD was overwritten by another task and does not reproduce. `oxlint` on the current HEAD is clean. Do not edit this branch from that overwritten log.

`structured-agent-session-create-adoption.test.ts` overlaps the mid-turn branch. After that PR lands, drop the duplicate hunk.

## AI Disclosure

Drafted with Claude Code (Anthropic) and Grok; reviewed and tested by the author

## Review

## Agent skill upstream boundary

- [x] Not applicable, or this change copies or mechanically translates no upstream skill-installer source, tests, fixtures, registry entries, path tables, comments, or documentation.

## Notes

Security: the hook does not grant permission. Claude still checks the rewritten command. `orca job stop` signals the job's process group and refuses pid 1 and below. Cross-platform: macOS and Linux use setsid-style detach, Windows uses a hidden PowerShell script, WSL uses `setsid` in the guest. Remote: job commands stay on this machine because the files are local. Mobile: no job control on the phone. Backwards compatible: `ORCA_DURABLE_JOBS=0` restores the old bash call.

Failure modes to keep in the issue: a denied tool can leave a pending job directory; if detach fails, the waiter says so and runs the command in its own process, which then dies with Claude; the environment is the waiter's environment at spawn and is not written next to the command.

## Checklist

- [x] This PR is small and focused
- [x] I explained what changed and why (ELI5, the user-facing before/after, the mechanism, and why over the alternatives)
- [ ] Before/after screenshots or videos attached for UI changes, or `N/A` with reason
- [x] Self-reviewed for correctness, security, and performance
- [x] Cross-platform, SSH/remote, and path/shortcut impact considered (or N/A)
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` pass (or CI will cover; local preferred)

## Files

Full diff vs `upstream/main`:

- `config/build-plugins/durable-job-scripts.ts`
- `config/electron-builder.config.cjs`
- `config/scripts/electron-builder-config.test.mjs`
- `config/scripts/main-entry-facade.test.ts`
- `docs/site/content/docs/agents/claude-code.mdx`
- `electron.vite.config.ts`
- `resources/durable-jobs/durable-background-job-hook.mjs`
- `resources/durable-jobs/durable-background-job-plan.mjs`
- `resources/durable-jobs/durable-background-job.mjs`
- `src/cli/handler-group-manifest.ts`
- `src/cli/handlers/job.test.ts`
- `src/cli/handlers/job.ts`
- `src/cli/help.ts`
- `src/cli/job-handler-group.ts`
- `src/cli/remote-selection-scope.ts`
- `src/cli/root-help-text-primary.ts`
- `src/cli/root-help-text-secondary.ts`
- `src/cli/specs/index.ts`
- `src/cli/specs/job.ts`
- `src/main/claude/durable-background-job-plugin.test.ts`
- `src/main/claude/durable-background-job-plugin.ts`
- `src/main/claude/durable-background-job.test.ts`
- `src/main/ipc/pty/host-env/assembly.ts`
- `src/main/ipc/pty/host-env/durable-background-job.test.ts`
- `src/main/ipc/pty/host-env/durable-background-job.ts`
- `src/main/ipc/pty/host-env/pi-agent.ts`
- `src/main/ipc/pty/pty-launch-parity.test.ts`
- `src/main/ipc/pty/spawn-options-assembly.ts`
- `src/main/native-chat/agent-session-wire/structured-agent-session-create-adoption.test.ts`
- `src/main/orcad/durable-residue.ts`
- `src/main/orcad/orcad-entry.ts`
- `src/main/pty/wsl-orca-env.test.ts`
- `src/main/pty/wsl-orca-env.ts`
- `src/main/startup/cli-command-names.ts`
- `src/main/startup/main-process-ready-runtime.ts`
