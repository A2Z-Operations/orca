# Auth proxy slots vs session counts on a headless host

Date: 2026-10-30. Branch: `nachumi-a2zoperations/proxy-slot-session-count`, off `blowzer/session-mover` at `e5682aa17d4`. Not pushed.

The Studio observation (`orcad` 1.4.244-blowzer.6): `orca account auth-proxy --agent claude --status` listed 19 slots, `orca account list` printed `sessions: 0` for every account, and the mover's decision list showed 3 live sessions (`stay`, `stay`, `wait:no-status`).

## 1. When a slot is created and released

A slot is created by `claudeAuthProxyBaseUrl`, which `ClaudeProfileRouter.withAuthProxy` calls from `launchEnv`, `launchEnvFor`, `preparation`, `preparationFor`, `prepareLaunch`, and `prepareLaunchFor`. `terminalEnv` calls `launchEnv` once the shell env has resolved, so every terminal open takes a slot. The WSL guest path allocates one more when it can read the account folder's token.

Before this change a slot was released only when `forgetClaudePaneAccount` saw `record.proxySlot`, and when `stopClaudeAuthProxy` cleared the map. PTY exit does call `forgetClaudePaneAccount` (`clearProviderPtyState`, unless `preserveAgentSessionOwners` on a disconnect). The registry is in memory, so an orcad restart drops every record and `stop()` drops every slot. The 19 slots were leftovers inside one process, not slots that survived a restart.

Five paths allocated a slot that nothing released:

- A Claude launch takes two slots. `terminalEnv` puts slot A in the shell env. `prepareLaunch` puts slot B in `claudeAuth.envPatch`. On the runtime/orcad path, `applyRuntimeClaudeAuthEnv` treated a same-port `/p/<slot>/` URL as a user `ANTHROPIC_BASE_URL`: it kept A, dropped B from the applied env, and logged the user-URL note. The registry still parsed B from the patch, so forget released B and A leaked. The desktop IPC merge spreads the patch over the shell env, so B was applied and A leaked the other way. If the pool had picked a different account, the process billed A while the registry said B.
- A shell that is not itself a Claude launch never stored its slot. Commit called forget on a missing record and left the slot. A `claude` typed in that shell keeps using it, so the slot has to live until the PTY exits.
- `prepareForRateLimitFetch` calls `preparation()`, which allocates a slot. The poll only reads `CLAUDE_CONFIG_DIR` and the credential file. Headless usage polling repeats this.
- `recordClaudePaneAccount` replaced a record without releasing a different previous slot. The spawn path forgets first, so this was the smaller leak.
- A reattach still runs terminal env setup. The live process does not take that new env. The fresh slot was unbound.

What changed:

- Forget releases the record's slot and every slot bound to that PTY, including a shell slot that has no pane record. Re-recording a different slot releases the old one.
- Each `orca account auth-proxy --status` prunes first. A slot with no owner is dropped (the leaked set). A slot bound to a PTY is dropped when that PTY is in neither `listRegisteredPtys()` nor the pane registry. An unbound slot younger than 30 seconds is kept, so a status call during spawn does not kill the slot between allocate and commit. A slot a pane record still names is kept and bound, including when the owner map was lost.
- The runtime merge now prefers the launch patch. The shell slot is released and is not logged as a user URL. A real user base URL (not `/p/<slot>/`) is still left alone. A loopback slot on another port is still replaced. The desktop merge still lets the patch win, and now releases the shell slot it discarded.
- The quota poll releases the slot `preparation()` just allocated and strips it from the patch it returns. A slot already bound to a PTY is not taken.
- Commit binds the slot in the env that was actually applied. A reattach releases that slot when it is still unbound, because the existing process did not receive it.

`stop()` still clears the map. After this, a status during a quiet process should list one slot per live shell or Claude pane, not the leftovers of every poll and every double launch.

## 2. Why `sessions: 0` while panes are live

`claudeListedPaneAccounts` counts every registry record whose billing id (`assignedAccountId ?? accountId`) is in the managed account list. It is not limited to `assignedAccountId`, to `source: 'pool'`, or to a window-attached client. A record whose id is not in that list is dropped, so it increments no row. The CLI prints `sessions: 0` whenever `assignedSessions` is present and the id is missing from the map. Older hosts omit the field entirely.

The registry is one process-global `Map`. The desktop IPC spawn and the orcad runtime spawn both commit through `publishCommittedPtySpawn`, which calls `recordClaudePaneAccountForSpawn`. A fresh orcad Claude launch was already recorded. `isClaudeLaunch` is false for a pre-adopted restore, and a reattach returned before recording, on purpose: re-recording under today's selection would erase the account baked into the process. After an orcad restart the map is empty until a non-reattach spawn or until the mover infers a row from a transcript path (`source: 'transcript'`, no slot).

`account list` and the mover's `sessionMoves` come from the same snapshot, but they do not filter the same way. `assignedSessions` only counts records whose billing id is a managed account. `sessionMoves` keeps the last decision for any PTY still in the registry, including a decision whose account has since left the list (`evaluate` skips the update when `from` is missing and leaves the old decision). So one `account list` can print `sessions: 0` on every managed row and still print `session <ptyId>: stay`. The three decisions can also be the mover log from a moment when the registry had rows, and the list a later moment when it did not. The 19 slots do not imply 19 registry rows: most of those slots were never recorded.

What changed: a reattach that is a Claude launch, has prepared auth, and finds no registry row now records that account. It does not store the new proxy slot, because the process kept the env it was born with, and it does not overwrite a row that is already there. A pre-adopted restore is still not a Claude launch, so it still waits for transcript inference. The runtime/orcad spawn test now checks `assignedSessions` for a `source: 'spawn'` pane, including one with no `assignedAccountId` and one that is not a pool launch.

## 3. `wait:no-status` on a live session

`decideClaudeSessionMove` returns `{ kind: 'wait', reason: 'no-status' }` only after the usage reading is fresh, the session is over the line, the failure hold and the cooldown have passed, `allowMidTurn` is false, and `paneState` is null. `allowMidTurn` is the proxy move: the pane has a `proxySlot` and the proxy strategy is on. A proxy pane skips the no-status, mid-turn, and background-work waits, because those waits exist to protect a process that would be restarted. `wait:no-status` is a resume-strategy pane (no slot) that is over the line and has no hook status.

`paneState` is `status.mainAgentState ?? status.state` for that pane key. A row marked `providerSessionOnly` is left out of the status list, so it also yields null. The mover can still infer a transcript record from `providerSessions` without having a state.

It does resolve. `AgentHookServer.loadStatusHookOwner` already primes the snapshot before it binds: it hydrates `last-status.json`, then drains the agent-hooks spool (`ingestSpoolRecord` / `applySpoolHook`, marked replay). A hydrated state is enough. The mover does not look at `observedInCurrentRuntime`. The spool is only events that failed delivery while the server was down. An idle pane that posted successfully before the restart is in `last-status.json`, not the spool. The desktop process also runs `retireRestoredStatusesWithDeadTerminals` at startup. Orcad does not. Orcad starts the hook server before the account services, and the mover re-evaluates on the status-change event, so a late drain updates the decision. A pane that has neither a hydrated status nor a spooled event stays at `wait:no-status` until the next live hook (Stop, statusline, UserPromptSubmit). A quiet prompt does not post until the next interaction. No second spool reader was added.

## Files

- `src/main/claude-accounts/claude-auth-proxy/claude-auth-proxy-slot-owners.ts` — slot to PTY, 30s unbound grace, prune decision
- `src/main/claude-accounts/claude-auth-proxy/claude-auth-proxy-slot-env.ts` — release the superseded shell slot, drop the poll slot, bind or release the applied slot
- `claude-auth-proxy-host.ts` — note on allocate, release helper, prune inside `claudeAuthProxyStatus`
- `claude-auth-proxy-url.ts` — `claudeAuthProxySlotId`
- `claude-pane-account-registry.ts` — release on forget and on slot replacement, bind the recorded slot
- `runtime-auth-service.ts` — quota poll does not keep the slot
- `ipc/pty/runtime/spawn-claude-auth.ts` — launch slot wins over this process's terminal slot
- `ipc/pty/ipc/spawn-env.ts` — desktop merge releases the shell slot the patch replaces
- `ipc/pty/spawn-commit-publication.ts` — bind the applied slot after the pane record
- `ipc/pty/host-env/claude-pane-account.ts` — empty-registry reattach records the account and not the new slot
- `ipc/pty/runtime/wsl-guest-auth-proxy-env.ts` — note the guest slot, release it if the URL cannot be built

## Tests

`node .../pnpm/12.14.0/node_modules/pnpm/bin/pnpm.mjs exec vitest run --config config/vitest.config.ts` on the files below. 9 files, 58 tests, all passed. (`corepack pnpm` on this Mac fails to switch to pnpm 12.14.0 with `ENOEXEC`; the versioned `pnpm.mjs` is the same 12.14.0.)

- `claude-auth-proxy-slot-hygiene.test.ts` — prune decision; status drops an untracked slot, a stale unbound slot, and a dead PTY; status keeps a fresh unbound slot, a registered PTY, and a pane record; launch slot replaces the terminal slot; poll slot is released; shell slot is bound; reattach slot is released
- `claude-pane-account-registry.test.ts` — re-record releases the old slot; forget releases a slot bound with no pane record
- `claude-pane-account.test.ts` — reattach into an empty registry is counted and stores no slot; an existing reattach row is left alone
- `spawn-claude-auth.test.ts` — same-port terminal slot is released, the launch slot is applied, and the user-URL note is not logged. The previous user-URL and foreign-port cases still pass
- `runtime-auth-service.test.ts` — a quota preparation does not keep its slot
- `spawn-replacement-addendum.test.ts` — the runtime/orcad spawn path records a `source: 'spawn'` pane that `claudeListedPaneAccounts` counts, for an explicit account and for an unpinned selected account
- `claude-profile-router-auth-proxy.test.ts`, `claude-pane-account-assign.test.ts`, `wsl-guest-auth-proxy-env.test.ts` — existing proxy lifecycle still passes

`pnpm check:changed --maxWorkers=2 --base=HEAD` ran 19 checks against `e5682aa17d`. Eighteen passed, including format, lint, and typecheck. The unit-test check failed 19 tests. Eighteen of those are this machine's global `commit-msg` hook refusing fixture authors (`Orca Test <test@orca.invalid>`, `Worktree Removal <removal@example.invalid>`) in `orca-runtime.test.ts` and `runtime-interrupted-local-worktree-removal.test.ts`. The same hook failure is already noted on this branch. The other failure, `claude-auth-proxy.test.ts` "cuts an idle stream at the configured budget and keeps an active stream", was `Error: aborted` inside that 15-minute related run. Re-run alone, that file passed 19 tests.

## What's left

- A pre-adopted restore, which is how orcad brings back an already-running Claude, is not a Claude launch. It still gets a registry row only from transcript inference. Recording today's selection over that process would name the wrong account.
- Slots do not survive `stop()`. A process that was alive across an orcad restart still has the previous port in its env. The new process will not list those dead slots. The process bills through the old URL until it is launched again.
- The desktop IPC merge still overwrites a user `ANTHROPIC_BASE_URL` with the launch patch. The runtime path leaves a user URL alone. That split was already there.
- `account list` does not prune. `auth-proxy --status` does. An unbound slot younger than 30 seconds can still appear during a spawn.

## How to verify

On the Studio, after this build: open a few terminals, run one Claude, then `orca account auth-proxy --agent claude --status`. The slot list should be about one per live terminal, and a second status a minute later should not have grown. `orca account list` should show `sessions: 1` on the account that Claude launch recorded. A pane with a proxy slot should not sit on `wait:no-status`. A resume-strategy pane with no hook yet can, until the next Stop, statusline, or prompt.
