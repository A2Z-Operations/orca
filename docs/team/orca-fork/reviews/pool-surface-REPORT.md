# Pool surface: setting, CLI, account list, pane badge

Date: 2026-10-29. Branch: `nachumi-a2zoperations/pool-surface-task3`, off `blowzer/session-mover` at `f050bb3b07` (plan head `a9d2f35327` is the parent of that brief commit). Not pushed.

## What it does

`claudeAccountPool` is `'off' | 'on'`. Absent means off, and the default settings object sets `'off'`. The switch is stored and reported. It does not choose a launch account. Task 1 owns that policy (`claude-profile-router`, spawn auth, auto-switch policy). Until that lands, turning the switch on does not change which account a new Claude session starts on. The settings sentence still says new sessions start on the signed-in account with the most room left, because that is the product behavior Task 1 is responsible for.

`orca account pool --agent claude --on|--off [--environment]` writes `accounts.setClaudeAccountPool` (`accounts-admin`, `{ enabled: boolean }`). Omitted `--agent` means Claude. Any other agent is rejected. Exactly one of `--on` or `--off`. Text prints `Claude account pool: on|off`. JSON prints `{ "pool": "on"|"off" }`. `--environment` is allowed, same as session-mover and auth-proxy. `account list` still rejects `--environment`.

`orca account list` prints `pool: on|off` after `session-mover`, so the existing `auto-switch` / `session-mover` lines stay intact. When the host sends `assignedSessions`, each account line ends with `sessions: N`, including `0` when that account id is missing from the array. Older hosts that omit the field print no sessions suffix. JSON is the full snapshot, so `pool`, `assignedSessions`, `paneAccounts`, and `strategy` ride along.

`orca account moves [--agent claude] [--environment]` reads `accounts.list` `sessionMoves`. Text is newest first, as the host returns it: ISO time, pane key or pty id, `from → to` (`to` is `-` when null), reason, strategy (`resume`, `proxy`, or `-` when an older host omits it). Empty text is `No Claude session moves.` JSON prints the array itself.

The short label is the email local-part. When two managed accounts share that local-part, the host appends `@` plus the first domain label (`ada@example.com` and `ada@work.example` become `ada@example` and `ada@work`). The renderer displays that string.

## Pane badge and status bar

The terminal tab header shows a `hostContext` badge with the focused pane's short label. `ClaudePaneAccountMark` sits in `SortableTab` beside the title, resolves the focused pty itself, and also draws the existing tab color dot. The chip is hidden while the title is being edited, and hidden when the pane has no assignment. The tooltip is the email. It uses `text-3xs` and the existing badge variant. No new color or size token. `SortableTab` was already at the file line limit, so the mark component is what keeps that file under it.

Initial paint comes from `accounts.list` `paneAccounts`. Later updates are the desktop event `claudeAccounts:paneAssigned`: the pane registry notifies only when the billed account or pane key changes, when `assign` changes the billed account, and when `forget` clears a recorded pane. Main sends that event to the desktop window. The preload bridge subscribes. The web client stubs `onPaneAssigned`; a web or orcad client keeps the `list()` snapshot until the tab remounts. `orcad-account-services.ts` is not wired. If the account is no longer in settings, the event label is the first 8 characters of the account id and the tooltip is omitted.

Session counts and the chip use `paneAccounts` and `assignedSessions`. `paneAssignments` is unchanged: it is still only panes whose billed account differs from the spawn folder. Counts drop a pane whose billing account is not in the managed list.

The status-bar Claude menu shows a Pool badge when `pool` is `on`, and a session count on an account row when that count is greater than 0. The selected account in the status bar is still the selected account.

Settings → Accounts → Claude, in the local-only block, immediately after the mover row and before the auth-proxy row: "Spread sessions across accounts". Remote account scope hides it with the mover and the proxy.

## Strategy on move history

`remember()` sets `strategy` from the pane record: `proxy` when the pane has a proxy slot, otherwise `resume`. Task 2 still owns evaluation and which strategy a move uses. Older records and older hosts omit the field. The printer shows `-`.

## Files

- Setting and defaults (Task 1 seam, storage only): `src/shared/claude-account-switch-settings.ts`, `src/shared/default-global-settings.ts`, `src/shared/managed-account-types.ts`
- Snapshot and short label: `src/main/claude-accounts/claude-account-selection.ts`, `service.ts`, `claude-account-short-label.ts`
- Registry events: `claude-pane-account-registry.ts`, `src/main/startup/main-process-account-services.ts`
- History seam: `claude-session-mover-history.ts` (`strategy` on `remember()`)
- RPC: `accounts-params.ts`, generated `rpc-params-catalog.generated.ts`, `runtime/rpc/methods/accounts.ts`, `runtime-account-controller.ts`, `runtime-service-command-surface.ts`
- CLI: `src/cli/specs/account.ts`, `handlers/account-pool.ts`, `handlers/account-moves.ts`, `account.ts`, `account-list-format.ts`, handler manifest, root help, `src/cli/index.ts` remote-selection exception
- UI: `claude-account-pool-setting.tsx`, `accounts-pane-claude-section.tsx`, `ClaudeSwitcherMenu.tsx`, `ClaudePaneAccountBadge.tsx`, `SortableTab.tsx`, `use-tab-agent.ts` (`useFocusedTerminalPtyId`), `claude-pane-account-assignments.ts`
- CLI group: `src/cli/account-handler-group.ts` (the account keys moved out of the manifest so that file stays under its line limit)
- Listed panes: `claude-listed-pane-accounts.ts` (snapshot rows extracted from `claude-account-selection.ts` for the same reason)
- IPC: `src/preload/api/agent-account-api.ts`, `claude-accounts-bridge.ts`; web stub in `web-agent-accounts-api.ts`
- Locales: `accounts.claude.pool.*` in `en`, `es`, `fr`, `ja`, `ko`, `pt`, `zh`

## Tests

`corepack pnpm` cannot find `pnpm.cjs` on this Mac. The equivalent pnpm 12.14.0 was `node .../pnpm/12.14.0/node_modules/pnpm/bin/pnpm.mjs`.

`vitest run --config config/vitest.config.ts` on the pool and moves handlers, RPC accounts, command routing, registry, account service, short label, session-mover, session-mover lifecycle, account specs, and the handler-group manifest: 11 files, 124 tests, passed.

Renderer: `use-tab-agent` suites, Claude status-bar sign-in (the switcher menu), `AccountsPane`, tab-title tooltip, and the SortableTab rename shortcut: 10 files, 108 tests, passed.

`typecheck:node`, `typecheck:web`, and `typecheck:cli` exited 0.

`verify-localization-catalogs` and `verify-localization-extraction` exited 0 (17816 English key references). The six new keys are in all seven catalogs. Non-English catalogs still have their pre-existing missing keys; that does not fail the catalog verify.

`pnpm fixtures:shot tab-bar/ClaudePaneAccountBadge:chip` wrote `.cache/fixtures/tab-bar__ClaudePaneAccountBadge--chip.dark.png`. The cold start exited 1 because the first load of `fixtures.html` logs a favicon 404. A warm shot of the same fixture exited 0. The image shows the tab title `claude` with chips `ada` and `ada@work`.

`pnpm check:changed` was not run.

## How to verify by hand

1. Restart Orca on this branch with two signed-in Claude accounts. Settings → Accounts → Claude should show "Spread sessions across accounts" under the mover row, off by default.
2. `orca account pool --agent claude --on` should print `Claude account pool: on`. `orca account list` should print `pool: on` and `sessions: N` on each account. The status-bar Claude menu should show a Pool badge.
3. Open a Claude pane. The terminal tab should show that account's short label. A move that changes the billed account should update the chip without reloading the tab. `orca account moves` should print the decision with `resume` or `proxy`.
4. A new Claude session still starts on the selected account. Spreading launches is Task 1, and it is not in this worktree.
