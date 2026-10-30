# pr/claude-monitoring-pane-restart

Branch: `pr/claude-monitoring-pane-restart`
HEAD: `85be7c39f85e`
Base: `e8e08036729` (`upstream/main`)
Parent: `e8e08036729`
Author: Nachumi Eliyahu <nachumi@a2zoperations.com>
Tracking: none. Not pushed.
Worktree: `/Users/nachumieliyahu/orca/workspaces/orca-fork/pr-midturn`
Diff vs `upstream/main`: 6 files, +62/−3.

Commits:

- `e71e24465158` Restart a monitoring Claude pane once its main agent is done.
- `85be7c39f85` Expect the status-change roster to include the main agent state.

This branch is only the mid-turn fix. It does not include the account registry, session mover, auth proxy, pool, durable jobs, or the plugin API.

## Issue text

Title: Restart a monitoring Claude pane once its main agent is done

A Claude pane that is only watching another agent stays "busy" after the main agent has finished. Account switching waits for the pane to be between turns, so that pane never restarts. The status hook already knows the main agent's state. Record it, and treat the pane as idle when that state is done.

## PR

## ELI5

A Claude pane that is only watching another agent used to look busy forever. Orca would not restart it when you switched accounts. Orca now sees that the main agent is finished, and the restart can go ahead.

## What Changed

Before, a monitoring pane counted as mid-turn whenever its own status was not done. After, the hook status entry carries `mainAgentState`, and the pane is mid-turn only when that main agent is not done. If the entry has no main agent, the old check remains. Nothing else in account switching changes on this branch.

## Why

Switching accounts restarts panes that are between turns. A monitoring pane never reached "done" on its own status, so the switch waited. The hook payload already has the main agent's state. Copying that one field is enough. Restarting on the pane's own status would cut a watch that is still attached to a live main agent.

## Linked Issue

Fixes #<to be created>

## Visual Proof

Record a short screen video. Start a Claude pane that is monitoring another agent, and wait until the main agent is done while the watch is still up. Switch Claude accounts. The monitoring pane should restart. The before state is the same pane sitting still because it still looks mid-turn. Do not show the account pool, the auth proxy, or session-move notices.

## Testing

- macOS: the first `check:changed` on `e71e24465158` (`/tmp/pr1-check.log`) failed only unit tests, in 1811.0s. The product failure was `agent-session-saved-roster.test.ts`. That assertion is fixed in `85be7c39f85`. The re-run on this HEAD (`/tmp/pr1-check2.log`) is `✗ 1 of 27 check(s) failed in 1362.7s: unit tests` (`CHECK:1`). Every other check passed. The eight unit failures are six `wsl-host-agent-launch-paths.test.ts` cases, because this Mac has `/usr/local/bin/claude`, and two `profile-project-domain-transfer.test.ts` cases that timed out at 30s. Neither file is in this diff. Linux, Windows, and SSH were not tested.
- Linux: not tested
- Windows: not tested
- SSH / remote: not tested

- [ ] I manually tested these changes locally
- [x] Automated tests added/updated, or explained why not below

Tests cover the status listener spreading `mainAgent.state`, and `isClaudePaneMidTurn` using `mainAgentState` when it is present. They have not been executed on this branch in this run.

`structured-agent-session-create-adoption.test.ts` changes `resolveCommand` to return `{ command: process.execPath, prefixArgs: [] }`. The registry branch and the durable-jobs branch touch the same test. After this PR lands, drop that hunk when rebasing the others.

## AI Disclosure

Drafted with Claude Code (Anthropic) and Grok; reviewed and tested by the author

## Review

## Agent skill upstream boundary

- [x] Not applicable, or this change copies or mechanically translates no upstream skill-installer source, tests, fixtures, registry entries, path tables, comments, or documentation.

## Notes

Security: no new credential path. Cross-platform: the hook field is data, not a path or shortcut. Remote: the status entry is the same shape a remote host already sends; an older host simply omits `mainAgentState` and the pane keeps the old check. Mobile: no new control. Backwards compatible: the field is optional.

## Checklist

- [x] This PR is small and focused
- [x] I explained what changed and why (ELI5, the user-facing before/after, the mechanism, and why over the alternatives)
- [ ] Before/after screenshots or videos attached for UI changes, or `N/A` with reason
- [x] Self-reviewed for correctness, security, and performance
- [x] Cross-platform, SSH/remote, and path/shortcut impact considered (or N/A)
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` pass (or CI will cover; local preferred)

## Files

Full diff vs `upstream/main`:

- `src/main/agent-hooks/server-status-listener-fanout.test.ts`
- `src/main/agent-hooks/server/server-listeners.ts`
- `src/main/agent-hooks/server/server-types.ts`
- `src/main/native-chat/agent-session-wire/structured-agent-session-create-adoption.test.ts`
- `src/renderer/src/lib/claude-session-account-move.test.ts`
- `src/renderer/src/lib/claude-session-account-move.ts`
