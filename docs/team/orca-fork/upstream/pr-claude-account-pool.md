# pr/claude-account-pool

Branch: `pr/claude-account-pool`
HEAD: `add29910ad68`
Base: `e8e08036729` (`upstream/main`)
Author: Nachumi Eliyahu <nachumi@a2zoperations.com>
Tracking: none. Not pushed.
Worktree: `/Users/nachumieliyahu/orca/workspaces/orca-fork/pr-pool`
Diff vs `upstream/main`: 211 files, +14333/−258. The pool commit itself is 62 files, +1647/−114.

Commits, oldest first:

- `cb595fb45e0` Record which Claude account each pane runs, and switch before a limit.
- `90b651fb3db` Restart a monitoring Claude pane once its main agent is done.
- `367e93d8d83` Move a running Claude session before its account hits a limit.
- `ce070e32194` Drop the new session-mover type assertions.
- `e3e6b10031b` Keep Electron out of the headless language reader.
- `991f86cc2b4` Bill a moved Claude session through a local auth proxy.
- `82f9ce675b9` Spread new Claude sessions across signed-in accounts.
- `a245581feee` Call the optional job lister through a typed function.
- `add29910ad6` Expect the status-change roster to include the main agent state.

Needs the auth proxy branch. Does not include durable job scripts or the plugin publisher.

## Defaults

`claudeAccountPool` defaults to `'off'`. A missing field is off. Membership in the pool is `=== 'on'`. `claudeLaunchPinsAccount` takes the auth preparation and the account id. It pins when an account was named, or when the preparation is marked `pooled`.

## Issue text

Title: Spread new Claude sessions across signed-in accounts

With several Claude logins, every new session still starts on the selected account, so one login fills up while the others sit idle. When the pool is on, start the new session on the signed-in account with the most room left. Leave hand-pinned sessions on their account. A running session that is far behind the freest account can move through the auth proxy, quietly, at most once per 15 minutes. `orca account moves` prints the mover's last decision for each live session.

## PR

## ELI5

You can tell Orca to spread new Claude chats across the accounts you are signed in to. Each new chat starts on the account that has the most room left. The account you selected is still what you see in the status bar, and it is still what a new chat uses when this is off. A small "Pool" badge shows when spreading is on, and each account shows how many chats it is carrying.

## What Changed

Before, a new Claude launch used the selected account unless automatic switch fired at the 95/90 lines. After, Settings → Accounts → Claude → "Spread sessions across accounts" is off by default. On, a new launch uses the signed-in account with the most room. Ties break to the fewest assigned sessions. An account with a hand-pinned session stays out of the pool. A named account that cannot launch falls back to the selected account and is not recorded as pooled.

The pane record's source is `pool` for a pooled launch, and the assignment is stored even before a proxy slot exists.

A running session can be rebalanced onto a freer account when the pool is on, the auth proxy is on, and the gap is at least 25 points with the target still holding 30 points of room. A rebalance waits until two minutes after a turn and at most once per 15 minutes. A hard-line move still uses the shorter cooldown. The notice says the session continues on the other account to balance the accounts.

CLI:

```sh
orca account pool --agent claude --on
orca account pool --agent claude --off
orca account moves
orca account moves --json
```

Both accept `--environment` and run on that paired server. `orca account list` shows `pool: on|off` and a session count on each account.

The tab shows the account, and the account switcher shows a Pool badge plus a session count when the count is greater than zero.

`orca job` is not on this branch.

## Why

Automatic switch waits until an account is almost full. Spreading new work earlier keeps one login from being the only one that works. Default off keeps the selected account as the launch target. Rebalancing a live session is a proxy move, not a restart, and it is rate-limited so a warm cache is not thrown away for a small gap. `orca account moves` is the same list the Settings page and the phone already show, so the CLI does not invent a second history.

## Linked Issue

Fixes #<to be created>

## Visual Proof

Record a short screen video. With the pool off, start two Claude sessions and show both on the selected account. Turn "Spread sessions across accounts" on. Start another Claude and show it land on the account with more room. Show the Pool badge in the account switcher and the session counts. Show a hand-pinned session staying on its account. Run `orca account pool --agent claude --on` and `orca account moves`. If the auth proxy is also on, show one live session move to the freer account without a restart, and show the rebalance sentence. Do not show `orca job`.

## Testing

- macOS: committed. Husky lint-staged passed on `82f9ce675b9` and on `a245581feee`. The default oxlint config and the casting config are clean on the lines the pool commit adds. `a245581feee` is the same hand-off lint fix as `078678aee0b` on the auth-proxy branch. `check:changed --base=upstream/main` has not been run on this HEAD.
- Linux: not tested
- Windows: not tested
- SSH / remote: not tested

- [ ] I manually tested these changes locally
- [x] Automated tests added/updated, or explained why not below

Tests cover the headroom choice, pinned accounts, the fallback when a pooled folder cannot launch, the rebalance gap and cooldowns, the CLI, remote routing for `account pool` and `account moves`, and the settings row. They have not been executed as a full gate on this branch yet.

Locales: `accounts.claude.pool` is in en, es, fr, ja, ko, pt, and zh. The six keys match.

## AI Disclosure

Drafted with Claude Code (Anthropic) and Grok; reviewed and tested by the author

## Review

## Agent skill upstream boundary

- [x] Not applicable, or this change copies or mechanically translates no upstream skill-installer source, tests, fixtures, registry entries, path tables, comments, or documentation.

## Notes

Security: the pool chooses among accounts Orca already stored. It does not print tokens. Cross-platform: the choice is numbers and account ids. WSL launches stay on the matching runtime. Remote: `account pool` and `account moves` accept `--environment`, same as auto-switch, session-mover, and auth-proxy. Mobile: the phone already receives the move rows. The pool setting is desktop. Backwards compatible: default off, and a missing field is off.

Rebase after the auth-proxy PR lands: drop every commit except `82f9ce675b9`. Drop `a245581feee` as well if the auth-proxy branch already contains the same typed `listJobs` call.

## Checklist

- [ ] This PR is small and focused
- [x] I explained what changed and why (ELI5, the user-facing before/after, the mechanism, and why over the alternatives)
- [ ] Before/after screenshots or videos attached for UI changes, or `N/A` with reason
- [x] Self-reviewed for correctness, security, and performance
- [x] Cross-platform, SSH/remote, and path/shortcut impact considered (or N/A)
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` pass (or CI will cover; local preferred)

The branch contains the earlier ladder steps so it builds on current `upstream/main`. The reviewable pool commit is `82f9ce675b9`. `a245581feee` only replaces `Reflect.apply` in the inherited hand-off note.

## Files

Full diff vs `upstream/main`:

- `docs/reference/claude-accounts.md`
- `docs/site/content/docs/agents/claude-code.mdx`
- `docs/site/content/docs/cli/reference.mdx`
- `src/cli/account-handler-group.ts`
- `src/cli/command-scoped-flag-help.ts`
- `src/cli/handler-group-manifest.ts`
- `src/cli/handlers/account-auth-proxy.test.ts`
- `src/cli/handlers/account-auth-proxy.ts`
- `src/cli/handlers/account-auto-switch.ts`
- `src/cli/handlers/account-list-format.test.ts`
- `src/cli/handlers/account-list-format.ts`
- `src/cli/handlers/account-moves.test.ts`
- `src/cli/handlers/account-moves.ts`
- `src/cli/handlers/account-pool.test.ts`
- `src/cli/handlers/account-pool.ts`
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
- `src/main/claude-accounts/claude-account-pool-launch.test.ts`
- `src/main/claude-accounts/claude-account-pool-launch.ts`
- `src/main/claude-accounts/claude-account-pool-policy.test.ts`
- `src/main/claude-accounts/claude-account-pool-policy.ts`
- `src/main/claude-accounts/claude-account-selection.ts`
- `src/main/claude-accounts/claude-account-service.test.ts`
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
- `src/main/claude-accounts/runtime-auth/runtime-auth-types.ts`
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
- `src/renderer/src/components/settings/claude-account-pool-setting.tsx`
- `src/renderer/src/components/settings/claude-auth-proxy-setting.tsx`
- `src/renderer/src/components/settings/claude-recent-moves.tsx`
- `src/renderer/src/components/settings/claude-session-mover-setting.tsx`
- `src/renderer/src/components/status-bar/ClaudeSwitcherMenu.tsx`
- `src/renderer/src/components/tab-bar/ClaudePaneAccountBadge.fixture.tsx`
- `src/renderer/src/components/tab-bar/ClaudePaneAccountBadge.tsx`
- `src/renderer/src/components/tab-bar/SortableTab.tsx`
- `src/renderer/src/i18n/en-runtime-required.json`
- `src/renderer/src/i18n/locales/en.json`
- `src/renderer/src/i18n/locales/es.json`
- `src/renderer/src/i18n/locales/fr.json`
- `src/renderer/src/i18n/locales/ja.json`
- `src/renderer/src/i18n/locales/ko.json`
- `src/renderer/src/i18n/locales/pt.json`
- `src/renderer/src/i18n/locales/zh.json`
- `src/renderer/src/lib/claude-auto-switch-follow.test.ts`
- `src/renderer/src/lib/claude-auto-switch-follow.ts`
- `src/renderer/src/lib/claude-pane-account-assignments.ts`
- `src/renderer/src/lib/claude-pane-account-folder.ts`
- `src/renderer/src/lib/claude-session-account-move.test.ts`
- `src/renderer/src/lib/claude-session-account-move.ts`
- `src/renderer/src/lib/use-tab-agent.ts`
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
