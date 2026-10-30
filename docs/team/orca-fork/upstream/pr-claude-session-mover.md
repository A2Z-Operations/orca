# pr/claude-session-mover

Branch: `pr/claude-session-mover`
HEAD: `54d7b14c6863`
Base: `e8e08036729` (`upstream/main`)
Author: Nachumi Eliyahu <nachumi@a2zoperations.com>
Tracking: none. Not pushed.
Worktree: `/Users/nachumieliyahu/orca/workspaces/orca-fork/pr-mover`
Diff vs `upstream/main`: 162 files, +9995/−225.

Commits, oldest first:

- `cb595fb45e0` Record which Claude account each pane runs, and switch before a limit.
- `90b651fb3db` Restart a monitoring Claude pane once its main agent is done.
- `367e93d8d83` Move a running Claude session before its account hits a limit.
- `ce070e32194` Drop the new session-mover type assertions.
- `e3e6b10031b` Keep Electron out of the headless language reader.
- `27a69fd505a` Call the optional job lister through a typed function.
- `54d7b14c686` Expect the status-change roster to include the main agent state.

Needs the registry and the mid-turn fix. Does not include the auth proxy, the account pool, durable job scripts, or the plugin publisher. The registry's follow-up commits `81011fc7f5b` and `5446d553722` are not in this history. Root help for auto-switch is added again in `e3e6b10031b`.

`claudeLaunchPinsAccount` stays one argument. The pool's two-argument pin is the later branch.

## Defaults

`claudeSessionMover` defaults to `ask`. On a headless host, `ask` acts as `move`, because nobody can answer a prompt. Headless usage polling runs when auto-switch is on, or when the mover is anything but `off` (`?? 'ask'`). The registry branch polls only when auto-switch is on. Do not copy this polling change back onto the registry branch.

The hand-off note does not import the durable-job module. It looks for `resources/durable-jobs/durable-background-job.mjs` on disk and, if the file is missing, reports that no detached jobs were still running.

## Issue text

Title: Move a running Claude session to another account before a usage limit

Automatic switch only changes the next launch. A session that is already running keeps billing the account that is about to hit the line. Between turns, resume that same pane on the account with the most room left, and tell the continued session what changed. Ask first unless the person chose always-move. On a machine with no window, asking is not possible, so ask means move.

## PR

## ELI5

When a Claude account is close to its limit, Orca can move the chat that is already running onto another signed-in account that has more room. It asks you first. On a machine with no window, it moves without asking, because nobody is there to answer. The chat comes back in the same pane. A short note tells it which account it left and what was still running.

## What Changed

Before, a running Claude session stayed on the account it launched with until you restarted it by hand. After, Settings → Accounts → Claude → "Move running sessions before a usage limit" is `ask` by default.

| Value | Desktop | Headless |
| --- | --- | --- |
| off | Never move a running session | Never |
| ask | Show a notice. Do not move until the setting is move | Treat as move |
| move | Between turns, resume the same pane on the account with the most room | Same |

The lines are the same as automatic switch: 95% of the 5-hour window, 90% of the weekly window, 90% of the Fable weekly window. Orca only moves toward an account that has clearly more room.

CLI: `orca account session-mover --agent claude --off|--ask|--move`. `--environment` writes the setting on that paired server. Recent moves are listed in Settings. The CLI command `orca account moves` is not on this branch. It lands with the account pool.

The hand-off note says either "No detached Orca jobs were still running." or "Detached Orca jobs still running after this restart: …". It also names the account the session left and which subagents the restart ended.

The headless language reader no longer imports Electron. The desktop binds the reader from `src/main/host/electron-system-language.ts`, which only `src/main/index.ts` imports. orcad and the CLI never load that file.

## Why

Waiting for the next launch leaves the current session on an account that is about to stop. Resuming the same pane keeps the conversation. Asking on the desktop avoids a surprise restart. A headless host cannot show the question, so treating ask as move is the only way the default does something there. Default ask, not move, keeps a desktop session where it is until the person agrees.

The durable-job scripts are a separate change. The note checks for the file so this branch runs without them.

## Linked Issue

Fixes #<to be created>

## Visual Proof

Record a short screen video. With the setting on ask, push account A past a line while a Claude pane is between turns and account B has room. Show the notice, and show that the pane does not restart until you set the mover to move. Then show the same pane resume on B, with the hand-off note in the continued session. Show the Settings list of recent moves. Show `orca account session-mover --agent claude --move`. Do not show a proxy move, the pool badge, or `orca account moves`.

## Testing

- macOS: the first `check:changed` (`/tmp/pr3-check.log`, `--timeout=60`) failed changed-code quality, the Electron ratchet, and unit tests at the 60-minute cap. Quality and the Electron ratchet were fixed in `ce070e32194` and `e3e6b10031b`. The re-run on `e3e6b10031b` (`/tmp/pr3-check2.log`, `--timeout=120`, `GIT_IDENTITY_ALLOW_OTHER=1`) finished `✗ 2 of 28 check(s) failed in 4848.9s: oxlint, unit tests` (`CHECK:1`). Every other check passed, including typecheck, changed-code quality, format, the ratchets, localization, and import boundaries. Oxlint was `anti-slop/no-reflect-apply` on `Reflect.apply(listJobs, ...)`. That call is replaced in `27a69fd505a`. Anti-slop and default oxlint are clean on that file. The full suite was not re-run after that one-line commit. Unit failures on the re-run, not product-fixed: 15 cases in `runtime-failed-local-worktree-removal.test.ts` (commit-msg refused author `Worktree Removal` even with `GIT_IDENTITY_ALLOW_OTHER=1` on the gate process); the macOS pty flakes in `pty-claude-agent-view-readiness`, `pty-runtime-hidden-at-spawn-mark`, three `pty-attach-view-joins-main-start` cases, both `pty-launch-race-parity` lanes, `pty-hidden-at-spawn-mark`, `pty-spawn-scaling.performance`, and `pty-pane-materialization-race`; five `wsl-host-agent-launch-paths.test.ts` cases because this Mac has `/usr/local/bin/claude` so a Windows-only refusal launches the local binary instead; `structured-agent-session-at-rest-command-population.test.ts` expected 4 and got 3; `profile-project-domain-transfer.test.ts` timed out at 30s. Linux, Windows, and SSH were not tested.
- Linux: not tested
- Windows: not tested
- SSH / remote: not tested

- [ ] I manually tested these changes locally
- [x] Automated tests added/updated, or explained why not below

Tests cover the policy lines, ask versus move, the headless ask-as-move rule, the hand-off sentences, the quiet wait, and the CLI. Known macOS pty flakes and this machine's real-git fixtures are listed in the ladder report if the re-run hits them. They are not product fixes.

## AI Disclosure

Drafted with Claude Code (Anthropic) and Grok; reviewed and tested by the author

## Review

## Agent skill upstream boundary

- [x] Not applicable, or this change copies or mechanically translates no upstream skill-installer source, tests, fixtures, registry entries, path tables, comments, or documentation.

## Notes

Security: a move uses the account folders Orca already stores. It does not print tokens. Cross-platform: resume is a process restart through the existing spawn path. WSL accounts that cannot run on the launch host are not chosen. Remote: `account session-mover` accepts `--environment` and writes the paired host's setting. Mobile: the phone gets the same recent-move rows as the desktop list. There is no new phone control for the setting. Backwards compatible: the default is ask, and a missing field is ask.

Quiet wait uses `backgroundWork` and `turnEndedAt` so a move does not cut a turn that is still producing output.

Rebase after the registry and the mid-turn PRs land: drop `cb595fb45e0` and `90b651fb3db`, and drop the duplicate auto-switch help lines inside `e3e6b10031b`. Keep `81011fc7f5b` and `5446d553722` from the registry branch. The mid-turn commit on this branch does not include the adoption-test line that `e71e24465158` has. Keep that line from the mid-turn PR.

## Checklist

- [ ] This PR is small and focused
- [x] I explained what changed and why (ELI5, the user-facing before/after, the mechanism, and why over the alternatives)
- [ ] Before/after screenshots or videos attached for UI changes, or `N/A` with reason
- [x] Self-reviewed for correctness, security, and performance
- [x] Cross-platform, SSH/remote, and path/shortcut impact considered (or N/A)
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` pass (or CI will cover; local preferred)

The branch is larger than one commit because it contains the registry and the mid-turn fix, which it needs in order to build on current `upstream/main`. The reviewable mover commits are `367e93d8d83`, `ce070e32194`, and `e3e6b10031b`.

## Files

Full diff vs `upstream/main`:

- `docs/reference/claude-accounts.md`
- `docs/site/content/docs/cli/reference.mdx`
- `src/cli/handler-group-manifest.ts`
- `src/cli/handlers/account-auto-switch.ts`
- `src/cli/handlers/account-list-format.ts`
- `src/cli/handlers/account-session-mover.test.ts`
- `src/cli/handlers/account-session-mover.ts`
- `src/cli/handlers/account.ts`
- `src/cli/index-local-command-routing-flags.test.ts`
- `src/cli/remote-selection-scope.ts`
- `src/cli/root-help-text-primary.ts`
- `src/cli/root-help-text-secondary.ts`
- `src/cli/specs/account.ts`
- `src/main/agent-hooks/server-claude-statusline.test.ts`
- `src/main/agent-hooks/server-status-listener-fanout.test.ts`
- `src/main/agent-hooks/server-turn-ended-at.test.ts`
- `src/main/agent-hooks/server/server-lifecycle.ts`
- `src/main/agent-hooks/server/server-listeners.ts`
- `src/main/agent-hooks/server/server-types.ts`
- `src/main/claude-accounts/claude-account-auto-switch-policy.test.ts`
- `src/main/claude-accounts/claude-account-auto-switch-policy.ts`
- `src/main/claude-accounts/claude-account-auto-switch.test.ts`
- `src/main/claude-accounts/claude-account-auto-switch.ts`
- `src/main/claude-accounts/claude-account-home-attribution.test.ts`
- `src/main/claude-accounts/claude-account-home-attribution.ts`
- `src/main/claude-accounts/claude-account-selection.ts`
- `src/main/claude-accounts/claude-account-short-label.test.ts`
- `src/main/claude-accounts/claude-account-short-label.ts`
- `src/main/claude-accounts/claude-credential-persistence-ratchet.test.ts`
- `src/main/claude-accounts/claude-listed-pane-accounts.ts`
- `src/main/claude-accounts/claude-pane-account-registry.test.ts`
- `src/main/claude-accounts/claude-pane-account-registry.ts`
- `src/main/claude-accounts/claude-profile-chosen-account.ts`
- `src/main/claude-accounts/claude-profile-launch-errors.ts`
- `src/main/claude-accounts/claude-profile-router-launch-env-for.test.ts`
- `src/main/claude-accounts/claude-profile-router.ts`
- `src/main/claude-accounts/claude-profile-setup-queue.ts`
- `src/main/claude-accounts/claude-profile-system-default-comparison.ts`
- `src/main/claude-accounts/claude-session-move-handoff-note.test.ts`
- `src/main/claude-accounts/claude-session-move-handoff-note.ts`
- `src/main/claude-accounts/claude-session-move-handoff.test.ts`
- `src/main/claude-accounts/claude-session-move-handoff.ts`
- `src/main/claude-accounts/claude-session-move-mobile-notice.test.ts`
- `src/main/claude-accounts/claude-session-move-mobile-notice.ts`
- `src/main/claude-accounts/claude-session-move-stats.ts`
- `src/main/claude-accounts/claude-session-move-strategy.test.ts`
- `src/main/claude-accounts/claude-session-move-strategy.ts`
- `src/main/claude-accounts/claude-session-mover-evaluation.ts`
- `src/main/claude-accounts/claude-session-mover-history.ts`
- `src/main/claude-accounts/claude-session-mover-lifecycle.test.ts`
- `src/main/claude-accounts/claude-session-mover-policy.test.ts`
- `src/main/claude-accounts/claude-session-mover-policy.ts`
- `src/main/claude-accounts/claude-session-mover-sessions.test.ts`
- `src/main/claude-accounts/claude-session-mover-sessions.ts`
- `src/main/claude-accounts/claude-session-mover-test-fixture.ts`
- `src/main/claude-accounts/claude-session-mover-types.ts`
- `src/main/claude-accounts/claude-session-mover.test.ts`
- `src/main/claude-accounts/claude-session-mover.ts`
- `src/main/claude-accounts/claude-usage-polling-policy.test.ts`
- `src/main/claude-accounts/claude-usage-polling-policy.ts`
- `src/main/claude-accounts/runtime-auth-service.ts`
- `src/main/claude-accounts/service.ts`
- `src/main/host/electron-system-language.ts`
- `src/main/i18n/system-language.test.ts`
- `src/main/i18n/system-language.ts`
- `src/main/index.ts`
- `src/main/ipc/claude-accounts.ts`
- `src/main/ipc/pty/host-env/claude-pane-account.test.ts`
- `src/main/ipc/pty/host-env/claude-pane-account.ts`
- `src/main/ipc/pty/provider/state-cleanup.ts`
- `src/main/ipc/pty/runtime/spawn-claude-auth.ts`
- `src/main/ipc/pty/runtime/spawn-commit.ts`
- `src/main/ipc/pty/runtime/spawn-host-binding.ts`
- `src/main/ipc/pty/runtime/spawn-preflight-requested-shell.test.ts`
- `src/main/ipc/pty/runtime/spawn-preflight.ts`
- `src/main/ipc/pty/runtime/spawn-replacement-addendum.test.ts`
- `src/main/ipc/pty/runtime/spawn-replacement-flow-fixture.ts`
- `src/main/ipc/pty/runtime/spawn-replacement-flow.test.ts`
- `src/main/ipc/pty/runtime/spawn-replacement.test.ts`
- `src/main/ipc/pty/runtime/spawn-replacement.ts`
- `src/main/ipc/pty/runtime/spawn-state.ts`
- `src/main/ipc/pty/runtime/spawn.ts`
- `src/main/ipc/pty/spawn-commit-assembly.ts`
- `src/main/ipc/pty/spawn-commit-binding.ts`
- `src/main/ipc/pty/spawn-commit-publication.ts`
- `src/main/native-chat/agent-session-wire/structured-agent-session-adapter-errors.ts`
- `src/main/native-chat/agent-session-wire/structured-agent-session-create-adoption.test.ts`
- `src/main/native-chat/agent-session-wire/structured-agent-session-failure-text.ts`
- `src/main/orcad/orcad-account-services.test.ts`
- `src/main/orcad/orcad-account-services.ts`
- `src/main/orcad/orcad-stats.ts`
- `src/main/provider-account-services.ts`
- `src/main/provider-claude-session-mover.ts`
- `src/main/rate-limits/claude-active-usage-fetch.ts`
- `src/main/rate-limits/claude-profile-usage.test.ts`
- `src/main/rate-limits/claude-usage-window.ts`
- `src/main/rate-limits/service-headless-polling.test.ts`
- `src/main/rate-limits/service-live-claude-usage-routing.test.ts`
- `src/main/rate-limits/service/service-configuration.ts`
- `src/main/rate-limits/service/service-fetch-policy.ts`
- `src/main/rate-limits/service/service-polling.ts`
- `src/main/rate-limits/service/service-state.ts`
- `src/main/runtime/construction/runtime-identity-state.ts`
- `src/main/runtime/rpc/methods/accounts-claude-policy.ts`
- `src/main/runtime/rpc/methods/accounts.test.ts`
- `src/main/runtime/rpc/methods/accounts.ts`
- `src/main/runtime/runtime-account-controller.ts`
- `src/main/runtime/runtime-pty-controller-contract.ts`
- `src/main/runtime/runtime-service-command-surface.ts`
- `src/main/startup/main-process-account-services.ts`
- `src/main/startup/main-process-observers.ts`
- `src/main/startup/main-process-quit-update-veto.test.ts`
- `src/main/startup/main-process-quit.ts`
- `src/main/startup/main-process-state.ts`
- `src/main/stats/claude-session-move-stats.test.ts`
- `src/main/stats/collector.ts`
- `src/main/stats/stats-file-loader.ts`
- `src/main/stats/types.ts`
- `src/preload/api/agent-account-api.ts`
- `src/preload/api/claude-accounts-bridge.ts`
- `src/renderer/src/components/ClaudeAccountSwitchDialog.test.tsx`
- `src/renderer/src/components/ClaudeAccountSwitchDialog.tsx`
- `src/renderer/src/components/native-chat/agent-session-chosen-account-words-text.ts`
- `src/renderer/src/components/native-chat/agent-session-failure-words-text.ts`
- `src/renderer/src/components/settings/AccountsPane.owner-scope.test.tsx`
- `src/renderer/src/components/settings/AccountsPane.test.tsx`
- `src/renderer/src/components/settings/accounts-claude-search.ts`
- `src/renderer/src/components/settings/accounts-pane-claude-auto-switch.tsx`
- `src/renderer/src/components/settings/accounts-pane-claude-mover-settings.tsx`
- `src/renderer/src/components/settings/accounts-pane-claude-section.tsx`
- `src/renderer/src/components/settings/accounts-pane-types.ts`
- `src/renderer/src/components/settings/claude-recent-moves.tsx`
- `src/renderer/src/components/settings/claude-session-mover-setting.tsx`
- `src/renderer/src/i18n/en-runtime-required.json`
- `src/renderer/src/i18n/locales/en.json`
- `src/renderer/src/lib/claude-auto-switch-follow.test.ts`
- `src/renderer/src/lib/claude-auto-switch-follow.ts`
- `src/renderer/src/lib/claude-pane-account-assignments.ts`
- `src/renderer/src/lib/claude-pane-account-folder.ts`
- `src/renderer/src/lib/claude-session-account-move.test.ts`
- `src/renderer/src/lib/claude-session-account-move.ts`
- `src/renderer/src/runtime/runtime-provider-accounts-client.test.ts`
- `src/renderer/src/runtime/runtime-provider-accounts-client.ts`
- `src/renderer/src/web/preload-api/web-agent-accounts-api.ts`
- `src/renderer/src/web/web-preload-api-rate-limits.test.ts`
- `src/shared/agent-session-failure-copy.ts`
- `src/shared/agent-session-failure-words.ts`
- `src/shared/agent-session-failure.ts`
- `src/shared/agent-session-refusal-details.ts`
- `src/shared/agent-session-refusal-reason-words.ts`
- `src/shared/claude-account-switch-settings.ts`
- `src/shared/claude-chosen-account-failure-kinds.ts`
- `src/shared/claude-profile-routing.ts`
- `src/shared/claude-session-move-line.ts`
- `src/shared/claude-statusline-rate-limits.ts`
- `src/shared/cli-argument-boundary.ts`
- `src/shared/default-global-settings.ts`
- `src/shared/global-settings-types.ts`
- `src/shared/managed-account-types.ts`
- `src/shared/rpc-contract/accounts-params.ts`
- `src/shared/rpc-contract/rpc-params-catalog.generated.ts`
- `src/shared/structured-agent-session-dispatch-rejection.ts`
