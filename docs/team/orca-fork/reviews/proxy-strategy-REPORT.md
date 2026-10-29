# Auth proxy: restart-free Claude account moves

Date: 2026-10-29. Branch: `nachumi-a2zoperations/orcad-auth-proxy-account`, fast-forwarded onto `blowzer/session-mover` at `f3dbe7880c` before this work was committed, so the background-work wait and the resume handoff note stay. Not pushed.

Implementation commit: `9974c4fa41a` (`feat(claude-accounts): move a running Claude session by swapping its auth proxy slot`).

## What it does

One loopback HTTP listener per execution host, started with the Claude account services and stopped on cleanup. It binds `127.0.0.1` on a random port and forwards every request to `https://api.anthropic.com`: method, path, query, body, and a streamed response, including SSE. Hop-by-hop headers, `Host`, and the request `Content-Length` are dropped. When the path is `/p/<slot>/...`, the proxy replaces `Authorization` with `Bearer <token>` for the account currently assigned to that slot. The token is re-read on each request through `readClaudeOAuthCredentials`. The proxy never refreshes a token and never logs one. The log line is method, upstream path, status, and account id.

The slot URL is `http://127.0.0.1:<port>/p/<slot>/` with a trailing slash. Without that slash, `new URL('/v1/messages', base)` drops the `/p/<slot>` prefix. An unknown slot, or a known slot whose token read returns nothing, is forwarded with the incoming `Authorization` unchanged.

`claudeAuthProxy` defaults on (`!== false`, and the default settings object sets `true`). Off is today's behaviour: no `ANTHROPIC_BASE_URL` from Orca. A user-set `ANTHROPIC_BASE_URL` is left unchanged and noted once: `[claude-auth-proxy] ANTHROPIC_BASE_URL is already set; leaving it unchanged`.

## Launch and the billed account

`launchEnv`, `launchEnvFor`, `preparationFor`, and `prepareLaunchFor` add the slot URL when the proxy is listening and the setting is on. The URL is not added inside `chosenAccountLaunchEnv`. Opening a terminal calls `launchEnv`, so that shell gets a slot; an Orca-spawned Claude replaces it with a fresh slot. A `claude` typed into an existing terminal keeps the terminal's slot.

The pane registry keeps the spawn `accountId` and `configDir`, and adds `assignedAccountId` (the account the proxy bills) plus `proxySlot`. On spawn they match. A proxy move mutates `assignedAccountId` in place and remembers the provider session id. The mover's "from" account, usage attribution, the auto-switch "running sessions" scan, and `orca account list` use the assigned account when it differs from the spawn account. `account list` text adds `auth-proxy: on|off` and, when a pane has been moved, `pane <ptyId>: account <id>`. JSON carries `authProxy` and `paneAssignments`.

Live statusline posts include the hook `paneKey`. When the assigned account differs from the spawn account, ingestion bills that account and does not drop the post for a config-dir mismatch.

## The `proxy` move

Evaluation picks the proxy strategy when the pane has a slot. Otherwise it keeps `resume`. A proxy move flips the slot, updates the registry, remembers the session, and returns `moved` with the same pty id. It does not spawn, and it does not write the resume handoff note: the process never stopped, so that note would be false. Claim, cooldown, and the 5% debit stay. `allowMidTurn` skips the mid-turn, no-status, and background-work waits, because none of those waits exist to protect a process that is not restarted. A resume move still waits.

Desktop notice, when the pty id did not change: "{{from}} is near its usage limit. The session continues on {{to}} without a restart." Orcad: "<from> continues on <to> without a restart."

A later `--resume` of that session id, with no explicit account, launches on the remembered assigned account. The transcript file stays in the spawn folder, so `claude --resume` may not find the session there. A resume typed into a shell does not go through this preflight.

## Setting and CLI

Settings → Accounts → Claude, next to the mover row: "Bill Claude through a local auth proxy". Hidden for a remote account scope, same as the mover row. `orca account auth-proxy --agent claude --on|--off` writes `accounts.setClaudeAuthProxy` (`accounts-admin`), including with `--environment`.

## Files

- Proxy: `src/main/claude-accounts/claude-auth-proxy/` (`claude-auth-proxy.ts`, `-host.ts`, `-note.ts`, test)
- Start/stop: `src/main/orcad/orcad-account-services.ts`, `src/main/startup/main-process-account-services.ts`
- Launch and resume: `claude-profile-router.ts`, `environment.ts`, `src/main/ipc/pty/runtime/spawn-claude-auth.ts`, `src/main/ipc/pty/host-env/claude-pane-account.ts`
- Registry and mover: `claude-pane-account-registry.ts`, `claude-session-move-strategy.ts`, `claude-session-mover-evaluation.ts`, `-policy.ts`, `-history.ts`, `-types.ts`, `provider-claude-session-mover.ts`
- Attribution: `service-fetch-policy.ts`, `provider-account-services.ts`, `claude-statusline-rate-limits.ts`, `server-lifecycle.ts`, renderer `claude-session-account-move.ts`, `claude-auto-switch-follow.ts`, `claude-pane-account-folder.ts`
- Setting, RPC, CLI: `claude-account-switch-settings.ts`, `default-global-settings.ts`, `accounts-params.ts`, `rpc-params-catalog.generated.ts`, `runtime-account-controller.ts`, `accounts.ts`, `account-auth-proxy.ts`, help and `account list` format, `claude-auth-proxy-setting.tsx`
- English: `accounts.claude.authProxy.*`, `accounts.claude.sessionMover.movedRestartlessBody`. The runtime catalog also gained the handoff strings that were already in `en.json` but missing from the boot bundle.

## Tests

`vitest run --config config/vitest.config.ts` (pnpm 12.14.0 native binary; `corepack pnpm` cannot find `pnpm.cjs` on this Mac):

Proxy (header replacement, SSE pass-through, unknown slot, token re-read), registry, proxy strategy, policy including `allowMidTurn`, mover evaluation, router env, existing `launchEnvFor`, spawn auth, pane record, RPC, CLI auth-proxy and session-mover, routing `--environment`, live usage routing, statusline, renderer session scan, orcad account services, mover lifecycle and sessions.

19 files, 165 tests, passed, including the `account list` pane line in `account-auth-proxy.test.ts` ("shows auth-proxy in the Claude block").

`pnpm tc` was not in the `check:changed` failure list, so node, web, and cli typecheck passed on this diff.

## Not covered

Windows, WSL, and SSH remote hosts are not implemented beyond the existing guards, and were not tested. WSL `createOrcadAccountServices` still returns null before the proxy starts, so a WSL guest does not listen. An SSH execution host would need its own orcad listener on that machine's loopback; this change does not add a remote proxy client. `/status`, `.claude.json`, and the transcript directory stay on the spawn account. That is the product limit from `proxy-swap-EXPERIMENT.md`.

`pnpm check:changed --base=HEAD` ran 26 checks and failed 6. Three are already on `blowzer/session-mover` and are not in this diff: `main-sync-spawn-ratchet` and the process-host import boundary on `src/main/claude/durable-background-job.mjs`, and `runtime-electron-ratchet` on `src/main/i18n/system-language.ts` and `src/main/updater/updater-disabled.ts`. Localization catalogs and extraction failed in that same run because it had started before `en.json` and the runtime catalog were updated. A later `verify-localization-catalogs` and `verify-localization-extraction` exited 0 (17810 English keys; the boot catalog still has 7 superfluous keys that were left in place). The related unit suite's captured failures are outside this feature: `pty-launch-parity` expects a Claude command without the durable-jobs `--plugin-dir` already added on `f3dbe7880c` (the received command does not add `ANTHROPIC_BASE_URL`); real-git fixtures fail because this machine's global `commit-msg` hook refuses authors other than Nachumi Eliyahu; one profile-domain transfer timed out at 30s under load. The log dropped the middle of that suite. The 19 files above were re-run afterwards and passed. A check against `origin/main` is the wrong base for this fork.

## How to verify by hand

1. Restart Orca on this branch with two signed-in Claude accounts. Settings → Accounts → Claude should show the proxy switch on.
2. Open a new Claude pane. Its environment should contain `ANTHROPIC_BASE_URL=http://127.0.0.1:<port>/p/<slot>/`. The proxy log should show method, path, status, and an account id, and never a token.
3. Send a short prompt. Note the response organization id or the weekly rate-limit fraction. Move the session onto the other account (the mover, once that account has more room, or by assigning the slot). The process id stays. The next prompt's organization and weekly fraction should match the target account. The notice should say the session continues without a restart.
4. `/status` should still show the spawn account's email. The transcript should still be under the spawn `CLAUDE_CONFIG_DIR`.
5. `orca account list` should show `auth-proxy: on` and, after a move, `pane <ptyId>: account <id>`.
6. Turn the switch off (`orca account auth-proxy --agent claude --off`) and open a new pane. Orca should not set `ANTHROPIC_BASE_URL`. With the switch on, export your own `ANTHROPIC_BASE_URL` before launch and confirm Orca leaves that value in place.
