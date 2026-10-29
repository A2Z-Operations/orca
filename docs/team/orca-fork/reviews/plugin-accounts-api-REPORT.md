# Plugin accounts API

Date: 2026-10-29. Branch: `nachumi-a2zoperations/plugin-accounts-api`. Not pushed.

## What shipped

Read-only capability `accounts.read`. Workers call `orca.host.call('accounts.listClaudeAccounts')`. That dotted name is host method 14, `since` `1.1`, scope `host-accounts`, mutation false, panel false. `pluginApi` stays major 1. Capabilities went from 7 to 8.

The result is `{ accounts: [{ id, label, usage, assignedSessionCount }] }`, at most 64 accounts, sorted by id. `label` is the trimmed email, or the id when the email is blank, sliced to 512 characters. An id that is empty or longer than 256 characters is dropped, not sliced. `usage` is `session`, `weekly`, `fableWeekly`, and `updatedAt`. A window is `{ usedPercent, windowMinutes, resetsAt }` or null. `usedPercent` is clamped to 0–100. A window with a non-finite percent or a duration outside 1–100000 minutes is dropped. `assignedSessionCount` uses `claudeBillingAccountId` (`assignedAccountId ?? accountId`) and caps at 10000.

Strict schemas reject extra fields. The projection does not copy tokens, credential paths, organization ids, auth method, `error`, `usageMetadata`, `extraUsage`, `buckets`, `resetDescription`, pane config dirs, or pty ids.

## Events

`accounts.usage.changed` is `{ accountId, label, usage }`. The desktop binder reads settings, rate limits, and the pane registry, fingerprints the three windows plus `updatedAt`, and treats the first read as a baseline. Later polls emit only for a changed fingerprint or a new account. A removed account, a label change, and a session-count change do not emit.

`accounts.session.moved` is `{ ptyId, fromAccountId, toAccountId, previousPtyId? }`. The only mover seam is `settle` in `claude-session-mover-history.ts`. It publishes the raw new pty id before `claudeSessionMoveNoticeDetail` appends ` (wait:background-work)`. A resume move includes `previousPtyId`. A proxy move keeps the same pty, so `previousPtyId` is absent. A move onto the same account is dropped. The publisher swallows listener errors, so a plugin cannot fail the move.

Manifest `contributes.events` for either account event requires `accounts.read` and does not require `events:subscribe`. Worktree and agent events still require `events:subscribe`. A dynamic `events.subscribe` that names an account event needs both capabilities. That second check is in `executePluginHostCall` and returns `capability_denied` without subscribing any of the requested events. Delivery also skips an account event when the plugin manifest lacks `accounts.read`, on both the manifest path and the dynamic path. `events.subscribe` itself stays gated by `events:subscribe`. The gate was not changed to OR.

## Seams

`claude-accounts` does not import the plugin host. `claude-account-plugin-publish.ts` is a process-local listener. The plugin events module registers it. An unset listener is a no-op. orcad moves through `orcad-account-services.ts` and has no plugin host, so those moves do not crash and do not reach desktop plugins. No orcad plugin host was added.

Desktop startup still initializes account services, then plugins. The binder runs when `PluginService` is constructed, including when the plugin system is disabled. `emitEvent` already no-ops while disabled. Events are not published from `main-process-account-services` `onNotice`, because that path returns early when notifications are disabled.

Usage for the host-selected account is `state.claude` when that reading exists, otherwise that account's inactive row. Every other managed account uses `inactiveClaudeAccounts`. A WSL-selected account is neither `state.claude` nor in the inactive list, so its windows stay null. The list call does not use `ClaudeAccountService.listAccounts()`, which reads the system-default login file.

The consent sentence is the English catalog key `auto.components.settings.PluginConsentDialog.capability.accountsRead`. It matches `PLUGIN_CAPABILITY_DESCRIPTIONS['accounts.read']`. The other six locales are Task 10. `translate()` falls back to English.

The example worker is `docs/plugins/accounts-read-example.md`. It is documentation, not a loaded plugin. `docs/**` is gitignored, so the example and this report are `git add -f`.

Claude accounts are host settings, not folder-workspace settings. The list is the same for every folder workspace. Nothing here is platform-specific.

## Checks

`pnpm exec vitest run --config config/vitest.config.ts` on `plugin-claude-accounts.test.ts`, `plugin-host-methods.test.ts`, `claude-session-mover.test.ts`, and `plugin-manifest.test.ts`: 38 passed. `pnpm run tc:node` and `pnpm run tc:web` exited 0. oxlint on the touched TypeScript files reported 0 warnings. This machine's `corepack pnpm` shim is ENOEXEC; the commands used `sh` on the pnpm 12.14.0 script.

## Left

Task 10 owns translations of the new consent string. Task 12 owns the pull request. This branch is not pushed. WSL-selected usage stays empty until a host reading exists for that account. orcad does not deliver these events.
