# pr/claude-pane-account-registry

Branch: `pr/claude-pane-account-registry`
HEAD: `5446d5537228`
Base: `e8e08036729` (`upstream/main`)
Author: Nachumi Eliyahu <nachumi@a2zoperations.com>
Tracking: none. Not pushed.
Worktree: `/Users/nachumieliyahu/orca/workspaces/orca-fork/pr-registry`
Diff vs `upstream/main`: 94 files, +3765/−165.

Commits, oldest first:

- `cb595fb45e0` Record which Claude account each pane runs, and switch before a limit.
- `81011fc7f5b` Keep usage-polling types named and fixture clocks off the wall.
- `5446d553722` List auto-switch in the root CLI help.

This branch does not include the mid-turn restart fix, the session mover, the auth proxy, the account pool, durable jobs, or the plugin API. The source union on a pane record includes `'pool'` so a later writer typechecks. Nothing on this branch writes `source: 'pool'`.

## Defaults

`claudeAutoSwitchEnabled` defaults to false. Headless usage polling runs only while that setting is on. A later branch polls while the session mover is ask or move. Do not copy that polling change back onto this branch.

## Issue text

Title: Remember which Claude account each pane runs, and switch before a usage limit

Orca can hold more than one Claude login, but a live pane did not record which login it started with, and a new launch always used the selected account even when that account was nearly out of quota. Record the pane's account, attribute its status-line usage to that account, and, when the setting is on, start the next Claude on the account with the most room left.

## PR

## ELI5

Orca can keep more than one Claude login. This change remembers which login each open Claude pane is using, and it can start the next Claude on a login that still has room. That automatic choice stays off until you turn it on. Sessions that are already running are not moved by this setting.

## What Changed

Before, a new Claude launch used the selected account, and a pane did not keep a record of that choice after spawn. After, each live Claude pane records the account, the folder, and whether the session was pinned. `accounts.list` includes `paneAccounts` and `assignedSessions`. A status-line reading is stored on that pane's account.

Settings → Accounts → Claude → "Switch accounts before a usage limit" is off by default. On, when the selected account passes 95% of its 5-hour window or 90% of a weekly window, the next Claude starts on the signed-in account with the most room left. A desktop notification names the account. Running sessions get the same restart question as a switch you make by hand.

CLI: `orca account auto-switch --agent claude --on|--off`. `--environment` writes the setting on that paired server. Other `orca account` commands stay on this machine. A launch can name one saved account. An unknown id, or a WSL account where WSL cannot run, fails before the process starts.

On a machine with no window, usage is polled only while automatic switching is on.

## Why

The selected account is the wrong launch target once it is about to hit a limit and another login has room. Moving a session that is already running is a separate decision, so this setting only affects the next launch and then asks about running sessions the same way a hand switch does. Default off keeps today's launches unchanged. Polling usage on a headless host only while the setting is on avoids a background read nobody asked for.

## Linked Issue

Fixes #<to be created>

## Visual Proof

Record a short screen video. With the setting off, start Claude and show that it still uses the selected account. Turn "Switch accounts before a usage limit" on, with account A past a line and account B with room. Start a new Claude and show it lands on B, with the notification. Show a pane that was already running still on A until you answer the restart question. Show `orca account auto-switch --agent claude --on` and `orca account list`. Do not show the session mover, the auth proxy, or the pool badge.

## Testing

- macOS: committed. The first `check:changed` failed on anti-slop, the flaky-test ratchet, and a 30-minute unit-test timeout. Those code fixes are in `81011fc7f5b` and `5446d553722`. The full gate has not been re-run on this HEAD.
- Linux: not tested
- Windows: not tested
- SSH / remote: not tested

- [ ] I manually tested these changes locally
- [x] Automated tests added/updated, or explained why not below

Tests cover pane recording, usage attribution, the auto-switch choice, the setting default, the CLI, and remote routing for `account auto-switch`. The re-run is still to do.

`structured-agent-session-create-adoption.test.ts` overlaps the mid-turn branch and the durable-jobs branch. After the mid-turn PR lands, drop the duplicate hunk.

Root help lists `account auto-switch`. The session-mover branch also adds those lines in `e3e6b10031b`. After this PR lands, drop the duplicate help hunk when rebasing the session mover.

## AI Disclosure

Drafted with Claude Code (Anthropic) and Grok; reviewed and tested by the author

## Review

## Agent skill upstream boundary

- [x] Not applicable, or this change copies or mechanically translates no upstream skill-installer source, tests, fixtures, registry entries, path tables, comments, or documentation.

## Notes

Security: the registry stores account ids and config directories Orca already created. It does not print tokens. Cross-platform: paths go through the existing account-home helpers, including WSL. Remote: only auto-switch accepts `--environment`; list, add, select, and rm stay local. Mobile: the accounts snapshot gains pane fields an older client can ignore. Backwards compatible: the setting defaults off, and a missing field stays off.

The branch diff vs `upstream/main` is the whole registry. It is one feature, not the later mover or proxy.

## Checklist

- [x] This PR is small and focused
- [x] I explained what changed and why (ELI5, the user-facing before/after, the mechanism, and why over the alternatives)
- [ ] Before/after screenshots or videos attached for UI changes, or `N/A` with reason
- [x] Self-reviewed for correctness, security, and performance
- [x] Cross-platform, SSH/remote, and path/shortcut impact considered (or N/A)
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` pass (or CI will cover; local preferred)

## Files

Full diff vs `upstream/main`:

- `docs/reference/claude-accounts.md`
- `docs/site/content/docs/cli/reference.mdx`
- `src/cli/handler-group-manifest.ts`
- `src/cli/handlers/account-auto-switch.ts`
- `src/cli/handlers/account-list-format.ts`
- `src/cli/handlers/account.ts`
- `src/cli/remote-selection-scope.ts`
- `src/cli/root-help-text-primary.ts`
- `src/cli/root-help-text-secondary.ts`
- `src/cli/specs/account.ts`
- `src/main/agent-hooks/server-claude-statusline.test.ts`
- `src/main/agent-hooks/server/server-lifecycle.ts`
- `src/main/claude-accounts/claude-account-auto-switch-policy.test.ts`
- `src/main/claude-accounts/claude-account-auto-switch-policy.ts`
- `src/main/claude-accounts/claude-account-auto-switch.test.ts`
- `src/main/claude-accounts/claude-account-auto-switch.ts`
- `src/main/claude-accounts/claude-account-home-attribution.test.ts`
- `src/main/claude-accounts/claude-account-home-attribution.ts`
- `src/main/claude-accounts/claude-account-selection.ts`
- `src/main/claude-accounts/claude-account-short-label.test.ts`
- `src/main/claude-accounts/claude-account-short-label.ts`
- `src/main/claude-accounts/claude-listed-pane-accounts.ts`
- `src/main/claude-accounts/claude-pane-account-registry.test.ts`
- `src/main/claude-accounts/claude-pane-account-registry.ts`
- `src/main/claude-accounts/claude-profile-chosen-account.ts`
- `src/main/claude-accounts/claude-profile-launch-errors.ts`
- `src/main/claude-accounts/claude-profile-router-launch-env-for.test.ts`
- `src/main/claude-accounts/claude-profile-router.ts`
- `src/main/claude-accounts/claude-profile-setup-queue.ts`
- `src/main/claude-accounts/claude-profile-system-default-comparison.ts`
- `src/main/claude-accounts/claude-usage-polling-policy.test.ts`
- `src/main/claude-accounts/claude-usage-polling-policy.ts`
- `src/main/claude-accounts/runtime-auth-service.ts`
- `src/main/claude-accounts/service.ts`
- `src/main/ipc/claude-accounts.ts`
- `src/main/ipc/pty/host-env/claude-pane-account.test.ts`
- `src/main/ipc/pty/host-env/claude-pane-account.ts`
- `src/main/ipc/pty/provider/state-cleanup.ts`
- `src/main/native-chat/agent-session-wire/structured-agent-session-adapter-errors.ts`
- `src/main/native-chat/agent-session-wire/structured-agent-session-create-adoption.test.ts`
- `src/main/native-chat/agent-session-wire/structured-agent-session-failure-text.ts`
- `src/main/orcad/orcad-account-services.ts`
- `src/main/provider-account-services.ts`
- `src/main/rate-limits/claude-active-usage-fetch.ts`
- `src/main/rate-limits/claude-profile-usage.test.ts`
- `src/main/rate-limits/claude-usage-window.ts`
- `src/main/rate-limits/service-headless-polling.test.ts`
- `src/main/rate-limits/service-live-claude-usage-routing.test.ts`
- `src/main/rate-limits/service/service-configuration.ts`
- `src/main/rate-limits/service/service-fetch-policy.ts`
- `src/main/rate-limits/service/service-polling.ts`
- `src/main/rate-limits/service/service-state.ts`
- `src/main/runtime/rpc/methods/accounts-claude-policy.ts`
- `src/main/runtime/rpc/methods/accounts.ts`
- `src/main/runtime/runtime-account-controller.ts`
- `src/main/runtime/runtime-service-command-surface.ts`
- `src/main/startup/main-process-account-services.ts`
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
- `src/renderer/src/components/settings/accounts-pane-claude-section.tsx`
- `src/renderer/src/components/settings/accounts-pane-types.ts`
- `src/renderer/src/i18n/en-runtime-required.json`
- `src/renderer/src/i18n/locales/en.json`
- `src/renderer/src/lib/claude-auto-switch-follow.test.ts`
- `src/renderer/src/lib/claude-auto-switch-follow.ts`
- `src/renderer/src/lib/claude-pane-account-assignments.ts`
- `src/renderer/src/lib/claude-pane-account-folder.ts`
- `src/renderer/src/runtime/runtime-provider-accounts-client.test.ts`
- `src/renderer/src/runtime/runtime-provider-accounts-client.ts`
- `src/renderer/src/web/preload-api/web-agent-accounts-api.ts`
- `src/renderer/src/web/web-preload-api-rate-limits.test.ts`
- `src/shared/agent-session-failure-copy.ts`
- `src/shared/agent-session-failure-words.ts`
- `src/shared/agent-session-failure.ts`
- `src/shared/agent-session-refusal-details.ts`
- `src/shared/agent-session-refusal-reason-words.ts`
- `src/shared/claude-chosen-account-failure-kinds.ts`
- `src/shared/claude-profile-routing.ts`
- `src/shared/claude-statusline-rate-limits.ts`
- `src/shared/cli-argument-boundary.ts`
- `src/shared/default-global-settings.ts`
- `src/shared/global-settings-types.ts`
- `src/shared/managed-account-types.ts`
- `src/shared/rpc-contract/accounts-params.ts`
- `src/shared/rpc-contract/rpc-params-catalog.generated.ts`
- `src/shared/structured-agent-session-dispatch-rejection.ts`
