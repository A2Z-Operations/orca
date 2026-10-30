# pr/plugin-accounts-api

Branch: `pr/plugin-accounts-api`
HEAD: `3733d18a3aeb`
Base: `e8e08036729` (`upstream/main`)
Author: Nachumi Eliyahu <nachumi@a2zoperations.com>
Tracking: none. Not pushed.
Worktree: `/Users/nachumieliyahu/orca/workspaces/orca-fork/pr-plugin`
Diff vs `upstream/main`: 113 files, +4809/−178. That includes the registry commits this branch needs. The plugin commit itself is 19 files, +1044/−13.

Commits, oldest first:

- `cb595fb45e0` Record which Claude account each pane runs, and switch before a limit.
- `81011fc7f5b` Keep usage-polling types named and fixture clocks off the wall.
- `5446d553722` List auto-switch in the root CLI help.
- `3733d18a3ae` Let a plugin read Claude accounts and hear when a session moves.

Needs the registry only. Does not include the mid-turn fix, session mover, auth proxy, pool, or durable jobs. The session-mover branch does not import `claude-account-plugin-publish`. This branch owns that publisher.

## Issue text

Title: Let a plugin read Claude account usage and hear when a session moves

A plugin with `accounts.read` should see each Claude account's label, usage windows, and how many sessions are assigned to it, and it should hear when usage changes or a session moves. It should not see tokens, credential paths, or billing balances. Sandboxed panels should not be able to call the method.

## PR

## ELI5

A plugin can now ask Orca which Claude accounts are signed in, how full each one is, and how many sessions sit on it. It can also subscribe to "usage changed" and "a session moved." It cannot see passwords or tokens. The plugin has to be granted `accounts.read`.

## What Changed

Before, plugin events and host methods had no account surface. After:

- Capability `accounts.read`.
- Events `accounts.usage.changed` and `accounts.session.moved`. Account events map to `accounts.read` in `PLUGIN_EVENT_CAPABILITY`.
- Host method `accounts.listClaudeAccounts` (`since: 1`, scope desktop, worker only, not a mutation). `PLUGIN_HOST_API_MINOR` goes from 0 to 1. Frame and worker tests expect `{ major: 1, minor: 1 }`.
- The result is `{ accounts: [{ id, label, usage, assignedSessionCount }] }`. `usage` has `session`, `weekly`, `fableWeekly`, and `updatedAt`. Each window is `{ usedPercent, windowMinutes, resetsAt }` or null. `label` is the account email.
- A planted token field is rejected by the schema.
- `events:subscribe` still expands only to `workspace:read` and `agent:read`. Account events are not pulled in by that expansion.

`docs/plugins/accounts-read-example.md` is an example worker, not a plugin Orca loads. Generated plugin docs were not regenerated.

## Why

The registry already knows which account a pane bills and what its usage is. Plugins that route work across accounts need that read, and they need it without a credential. A new capability keeps it off for plugins that were not granted it. Worker-only keeps a sandboxed panel from calling it. Minor version 1 is the existing rule for a method whose `since` is 1.

## Linked Issue

Fixes #<to be created>

## Visual Proof

N/A for a settings screen. Record a short screen video of a sample worker with `accounts.read`: call `accounts.listClaudeAccounts`, show labels and percents and no token, then trigger a usage refresh and an account change and show the two events. Show a worker without the capability receiving neither event. Do not show the pool badge or the auth proxy.

## Testing

- macOS: committed. Husky lint-staged passed on the commit. The casting config is clean on the new files. `check:changed --base=upstream/main` has not been run on this HEAD yet.
- Linux: not tested
- Windows: not tested
- SSH / remote: not tested

- [ ] I manually tested these changes locally
- [x] Automated tests added/updated, or explained why not below

Tests cover the projection, the schema dropping a token, the capability gate on both events, and the host API minor version.

## AI Disclosure

Drafted with Claude Code (Anthropic) and Grok; reviewed and tested by the author

## Review

## Agent skill upstream boundary

- [x] Not applicable, or this change copies or mechanically translates no upstream skill-installer source, tests, fixtures, registry entries, path tables, comments, or documentation.

## Notes

Security: the projection omits tokens, credential paths, and billing balances. The schema rejects an extra token field. Cross-platform: the payload is numbers and strings, no paths. Remote: the method reads the host that owns the accounts. An older plugin host does not advertise the method. Mobile: no new phone control. Backwards compatible: plugins without `accounts.read` see no change. `events:subscribe` does not grow new capabilities.

The branch also contains the registry, because the publisher reads pane records and usage. Review the tip commit for the plugin surface. After the registry PR lands, rebase and drop `cb595fb45e0`, `81011fc7f5b`, and `5446d553722`.

## Checklist

- [x] This PR is small and focused
- [x] I explained what changed and why (ELI5, the user-facing before/after, the mechanism, and why over the alternatives)
- [x] Before/after screenshots or videos attached for UI changes, or `N/A` with reason
- [x] Self-reviewed for correctness, security, and performance
- [x] Cross-platform, SSH/remote, and path/shortcut impact considered (or N/A)
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` pass (or CI will cover; local preferred)

## Files

The plugin commit's files:

- `docs/plugins/accounts-read-example.md`
- `src/main/claude-accounts/claude-account-plugin-publish.ts`
- `src/main/plugins/plugin-claude-account-events.ts`
- `src/main/plugins/plugin-claude-account-projection.ts`
- `src/main/plugins/plugin-claude-accounts.test.ts`
- `src/main/plugins/workers/plugin-host-method-bindings.ts`
- `src/main/plugins/workers/plugin-host-methods.test.ts`
- `src/main/plugins/workers/plugin-host-runtime.test.ts`
- `src/main/plugins/workers/plugin-host-service-bindings.ts`
- `src/main/startup/main-process-plugins.ts`
- `src/renderer/src/components/plugins/page/PluginContributionActionEvents.tsx`
- `src/renderer/src/components/plugins/presentation/plugin-capability-presentation.ts`
- `src/renderer/src/components/right-sidebar/plugin-frame-host.test.ts`
- `src/shared/plugins/capabilities/plugin-capabilities.ts`
- `src/shared/plugins/contributions/plugin-event-contribution.ts`
- `src/shared/plugins/events/plugin-events.ts`
- `src/shared/plugins/frames/plugin-frame-api.test.ts`
- `src/shared/plugins/plugin-claude-account-contract.ts`
- `src/shared/plugins/workers/plugin-host-api.ts`

The full diff vs `upstream/main` also contains the registry files:

- `docs/plugins/accounts-read-example.md`
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
- `src/main/claude-accounts/claude-account-plugin-publish.ts`
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
- `src/main/plugins/plugin-claude-account-events.ts`
- `src/main/plugins/plugin-claude-account-projection.ts`
- `src/main/plugins/plugin-claude-accounts.test.ts`
- `src/main/plugins/workers/plugin-host-method-bindings.ts`
- `src/main/plugins/workers/plugin-host-methods.test.ts`
- `src/main/plugins/workers/plugin-host-runtime.test.ts`
- `src/main/plugins/workers/plugin-host-service-bindings.ts`
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
- `src/main/startup/main-process-plugins.ts`
- `src/preload/api/agent-account-api.ts`
- `src/preload/api/claude-accounts-bridge.ts`
- `src/renderer/src/components/ClaudeAccountSwitchDialog.test.tsx`
- `src/renderer/src/components/ClaudeAccountSwitchDialog.tsx`
- `src/renderer/src/components/native-chat/agent-session-chosen-account-words-text.ts`
- `src/renderer/src/components/native-chat/agent-session-failure-words-text.ts`
- `src/renderer/src/components/plugins/page/PluginContributionActionEvents.tsx`
- `src/renderer/src/components/plugins/presentation/plugin-capability-presentation.ts`
- `src/renderer/src/components/right-sidebar/plugin-frame-host.test.ts`
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
- `src/shared/plugins/capabilities/plugin-capabilities.ts`
- `src/shared/plugins/contributions/plugin-event-contribution.ts`
- `src/shared/plugins/events/plugin-events.ts`
- `src/shared/plugins/frames/plugin-frame-api.test.ts`
- `src/shared/plugins/plugin-claude-account-contract.ts`
- `src/shared/plugins/workers/plugin-host-api.ts`
- `src/shared/rpc-contract/accounts-params.ts`
- `src/shared/rpc-contract/rpc-params-catalog.generated.ts`
- `src/shared/structured-agent-session-dispatch-rejection.ts`
