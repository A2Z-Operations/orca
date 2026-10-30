# pr/claude-auth-proxy

Branch: `pr/claude-auth-proxy`
HEAD: `81fde266a1b1`
Base: `e8e08036729` (`upstream/main`)
Author: Nachumi Eliyahu <nachumi@a2zoperations.com>
Tracking: none. Not pushed.
Worktree: `/Users/nachumieliyahu/orca/workspaces/orca-fork/pr-proxy`
Diff vs `upstream/main`: 187 files, +12777/−235. The proxy commit itself is 60 files, +2795/−29.

Commits, oldest first:

- `cb595fb45e0` Record which Claude account each pane runs, and switch before a limit.
- `90b651fb3db` Restart a monitoring Claude pane once its main agent is done.
- `367e93d8d83` Move a running Claude session before its account hits a limit.
- `ce070e32194` Drop the new session-mover type assertions.
- `e3e6b10031b` Keep Electron out of the headless language reader.
- `991f86cc2b4` Bill a moved Claude session through a local auth proxy.
- `078678aee0b` Call the optional job lister through a typed function.
- `81fde266a1b` Expect the status-change roster to include the main agent state.

Needs the registry and the session mover. Does not include the account pool, `orca account moves`, durable jobs, or the plugin publisher. `claudeLaunchPinsAccount` stays the one-argument form. The pool branch changes it to two arguments.

## Defaults

`claudeAuthProxy` defaults to false. The check is `=== true`, so a missing field is off. The listener is used, and a launch stamps `ANTHROPIC_BASE_URL`, only when the setting is on and the user has not already set that variable.

## Issue text

Title: Bill a running Claude session through a local auth proxy so it can change accounts without restarting

Moving a session by restarting it drops the in-memory conversation. A loopback proxy can present another managed account's credential on the next request while Claude Code keeps running. The transcript folder and `/status` stay on the account the pane launched with. The billed account is the one the proxy slot points at. This stays off until someone turns it on.

## PR

## ELI5

Orca can put a small local proxy between a running Claude session and Anthropic. When you move that session to another signed-in account, the next request is billed to the new account and Claude does not restart. Nothing changes until you turn the setting on. If you already set your own Anthropic base URL, Orca leaves it alone.

## What Changed

Before, the only way to change the account a live Claude pane billed was to resume it, which restarts the process. After, with Settings → Accounts → Claude → "Bill Claude through a local auth proxy" on, each launch gets a loopback slot URL. A move assigns that slot to the new account. The pane list follows the assignment, not the transcript folder.

CLI: `orca account auth-proxy --agent claude --on|--off|--status`. `--environment` writes the setting on that paired server. `--status` prints the live listener (port, slot, account, requests in the last hour, last error) and does not change the setting.

On Windows with a WSL guest, the guest gets its own loopback listener. The proxy reads stored OAuth credentials and does not refresh tokens. A user-set `ANTHROPIC_BASE_URL` is kept, and Orca notes that once. A foreign loopback `/p/<slot>/` URL is replaced with this host's slot.

The account pool, the pool badge, and `orca account moves` are not in this commit.

## Why

A restart is the wrong tool when the goal is only to change who gets billed. Replacing the bearer at a loopback `ANTHROPIC_BASE_URL` is accepted by Claude Code 2.1.312, while `/status` and the transcript directory stay on the spawn account. Default off keeps current launches identical. Keeping a user-set base URL avoids silently overriding a gateway the person configured. Not refreshing tokens keeps the proxy from minting credentials it was not asked to mint.

## Linked Issue

Fixes #<to be created>

## Visual Proof

Record a short screen video with the auth-proxy setting off, then on. Off: a running Claude session has no loopback base URL, and a move still resumes the pane. On: turn the setting on, start a Claude session on account A, move it to account B without a process restart, and show `/status` still naming A while the next request's usage lands on B. Show the Settings row and `orca account auth-proxy --status`. Show one case where `ANTHROPIC_BASE_URL` was already set and Orca prints a single note and does not replace it. Do not show the pool badge.

## Testing

- macOS: before `991f86cc2b4`, changed-code quality, the Electron ratchet, oxfmt, typecheck of node, web, and cli, the RPC catalog check, and the three localization checks passed against `upstream/main`. Husky lint-staged passed on `991f86cc2b4` and on `078678aee0b`. The full `check:changed` unit suite has not been run on this HEAD. `078678aee0b` is the same hand-off lint fix the session-mover gate needs. Drop it after that fix lands on the mover branch.
- Linux: not tested
- Windows: not tested. The WSL guest path is covered by unit tests in the tree. It was not run on a Windows host.
- SSH / remote: not tested

- [ ] I manually tested these changes locally
- [x] Automated tests added/updated, or explained why not below

Tests cover slot URLs, the proxy request path, WSL status, launch env stamping, foreign slot replacement, and pane assignment. They have not been executed as a full gate on this branch yet.

## AI Disclosure

Drafted with Claude Code (Anthropic) and Grok; reviewed and tested by the author

## Review

## Agent skill upstream boundary

- [x] Not applicable, or this change copies or mechanically translates no upstream skill-installer source, tests, fixtures, registry entries, path tables, comments, or documentation.

## Notes

Security: the proxy binds loopback, reads credentials Orca already stored, and does not write them. It does not refresh tokens. Cross-platform: the listener is Node. The WSL path is a separate guest env and reports unsupported on a non-WSL host. Remote: `account auth-proxy` is in the remote-selection exception with auto-switch and session-mover, because it writes the paired host's setting. Mobile: no new mobile control. The desktop setting is the switch. Backwards compatible: default false, and a missing field stays off.

A resume of a session the proxy already billed stays on that billed account. The comment in the spawn path says so.

Rebase after the session-mover PR lands: drop every commit except `991f86cc2b4`. Also drop `078678aee0b` once the mover branch contains the same typed `listJobs` call.

## Checklist

- [ ] This PR is small and focused
- [x] I explained what changed and why (ELI5, the user-facing before/after, the mechanism, and why over the alternatives)
- [ ] Before/after screenshots or videos attached for UI changes, or `N/A` with reason
- [x] Self-reviewed for correctness, security, and performance
- [x] Cross-platform, SSH/remote, and path/shortcut impact considered (or N/A)
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` pass (or CI will cover; local preferred)

The branch contains the registry, the mid-turn fix, and the session mover so it builds on current `upstream/main`. The reviewable proxy commit is `991f86cc2b4`. `078678aee0b` only replaces `Reflect.apply` in the inherited hand-off note.

## Files

The proxy commit's 60 files are the diff of `991f86cc2b4`. Full diff vs `upstream/main`:

- `docs/reference/claude-accounts.md`
- `docs/site/content/docs/cli/reference.mdx`
- `src/cli/command-scoped-flag-help.ts`
- `src/cli/handler-group-manifest.ts`
- `src/cli/handlers/account-auth-proxy.test.ts`
- `src/cli/handlers/account-auth-proxy.ts`
- `src/cli/handlers/account-auto-switch.ts`
- `src/cli/handlers/account-list-format.test.ts`
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
- `src/main/claude-accounts/claude-auth-proxy/claude-auth-proxy-headers.ts`
- `src/main/claude-accounts/claude-auth-proxy/claude-auth-proxy-host.test.ts`
- `src/main/claude-accounts/claude-auth-proxy/claude-auth-proxy-host.ts`
- `src/main/claude-accounts/claude-auth-proxy/claude-auth-proxy-note.ts`
- `src/main/claude-accounts/claude-auth-proxy/claude-auth-proxy-request-log.ts`
- `src/main/claude-accounts/claude-auth-proxy/claude-auth-proxy-token-cache.ts`
- `src/main/claude-accounts/claude-auth-proxy/claude-auth-proxy-url.test.ts`
- `src/main/claude-accounts/claude-auth-proxy/claude-auth-proxy-url.ts`
- `src/main/claude-accounts/claude-auth-proxy/claude-auth-proxy.test.ts`
- `src/main/claude-accounts/claude-auth-proxy/claude-auth-proxy.ts`
- `src/main/claude-accounts/claude-credential-persistence-ratchet.test.ts`
- `src/main/claude-accounts/claude-listed-pane-accounts.ts`
- `src/main/claude-accounts/claude-pane-account-assign.test.ts`
- `src/main/claude-accounts/claude-pane-account-assign.ts`
- `src/main/claude-accounts/claude-pane-account-registry.test.ts`
- `src/main/claude-accounts/claude-pane-account-registry.ts`
- `src/main/claude-accounts/claude-profile-chosen-account.ts`
- `src/main/claude-accounts/claude-profile-launch-errors.ts`
- `src/main/claude-accounts/claude-profile-router-auth-proxy.test.ts`
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
- `src/main/claude-accounts/environment.ts`
- `src/main/claude-accounts/runtime-auth-service.ts`
- `src/main/claude-accounts/service.ts`
- `src/main/claude-accounts/wsl-auth-proxy-status.test.ts`
- `src/main/claude-accounts/wsl-auth-proxy-status.ts`
- `src/main/host/electron-system-language.ts`
- `src/main/i18n/system-language.test.ts`
- `src/main/i18n/system-language.ts`
- `src/main/index.ts`
- `src/main/ipc/claude-accounts.ts`
- `src/main/ipc/pty/host-env/claude-pane-account.test.ts`
- `src/main/ipc/pty/host-env/claude-pane-account.ts`
- `src/main/ipc/pty/provider/state-cleanup.ts`
- `src/main/ipc/pty/runtime/spawn-claude-auth.test.ts`
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
- `src/main/ipc/pty/runtime/wsl-guest-auth-proxy-env.test.ts`
- `src/main/ipc/pty/runtime/wsl-guest-auth-proxy-env.ts`
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
- `src/renderer/src/components/settings/claude-auth-proxy-setting.tsx`
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
- `src/shared/claude-auth-proxy-status.ts`
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
