# Orca session mover: move live Claude sessions before a usage limit (design)

Date 2026-10-19. Owner: Nachumi. Target: the Orca fork `A2Z-Operations/orca`, branch `blowzer/auto-switch` (upstream v1.4.230 + our commits), written so upstream `stablyai/orca` can adopt it as-is.

## 1. Problem

Orca manages several Claude accounts. Today a usage limit is handled in three disconnected pieces:

| Piece | Where it runs | What it covers | What it misses |
|---|---|---|---|
| Account auto-switch (PR #28044/#29060 + our lines 5h 95 %, weekly 90 %, Fable weekly 90 %) | main process | moves the **selected** account when **it** crosses a line, so **new** sessions start on the account with the most room | sessions already running; any account that is not the selected one |
| Restart running sessions after a switch (PR #29898, in 1.4.230) | **renderer only**, local desktop | after the selected account changed, restarts live Claude sessions that sat on the old account, when idle, with a resume; setting Ask / Restart / Keep (default Ask) | headless hosts (`orca serve`); sessions whose own account ran out while another account is selected; it never looks at usage, only at "the selection changed" |
| Headless runtime (orcad) | `orca serve` | wires the auto-switch | never starts usage polling ("refreshes on demand"), so the switch fires only while a window asks for usage; statusline usage posted by sessions on non-selected accounts is dropped (`configDir mismatch`) |

Result seen on 2026-10-19: a running session on a non-selected account hit "You've hit your session limit · resets 12:50am" and nothing moved it. Upstream issues #19900, #23542, #23885 and #29999 describe the same gap and a demand for a switch that reaches running sessions.

## 2. Goal

A session that is about to run out of room moves itself to the account with the most room, between turns, with its conversation intact, on every host (desktop or headless), with no human in the loop when the setting says so. Durable, observable, testable, and shaped so upstream adopts it.

Non-goals (this spec): Codex sessions (the design leaves the hook, the code is Claude-only); the in-place token swap (a later strategy behind a setting, see §9); any change to the renderer's existing restart flow (it keeps working for the selected-account case; upstream is reshaping those files on `codex-switch-dialog-main`, so we stay out of them).

## 3. Shape

Four small main-process units, each testable alone, plus settings and CLI:

```
RateLimitService ──state──▶ ┐
agentHookServer  ──status─▶ ├─▶ ClaudeSessionMover ──decide──▶ MoveStrategy.resume ──▶ runtime pane replacement (spawn with replacesPtyId)
ClaudePaneAccountRegistry ─▶ ┘            │
                                          └─▶ notices (toast when a window is attached, log line always)
```

### 3.1 `ClaudePaneAccountRegistry` (new, main) — which account each live Claude session runs on
Mirror of the existing `codex-pane-account-registry.ts`. Recorded where main injects `CLAUDE_CONFIG_DIR` at spawn (`ipc/pty/*/spawn-preflight.ts` → `prepareClaudeAuth`): `{ ptyId, paneKey?, accountId, configDir, launchedAt, pinned }`. `pinned` = the launch carried its own `CLAUDE_CONFIG_DIR` (claude-pick, hand-pinned); such sessions are moved only once their account is **at** the line, never for a better bargain. Forgotten on PTY exit. Exposes `list()`, `get(ptyId)`, `byAccount(accountId)`. Fallback for sessions spawned before the registry existed: infer from the hook server's `transcriptPath` (the way the renderer's `resolveClaudeSessionAccountId` does).

### 3.2 Per-account live usage (change, main) — stop dropping what sessions already tell us
`ingestLiveClaudeRateLimits` today keeps a statusline post only when its `configDir` is the selected account's and drops the rest. Change: route a post whose `configDir` belongs to **another managed account** into that account's entry in `inactiveClaudeAccounts` (fresh reading, `updatedAt = now`, same shape as a polled reading). Posts from unknown folders stay dropped. Effect: every account with a live session is read every 15 s for free, the poller stays the fallback for silent accounts.

### 3.3 `ClaudeSessionMover` (new, main) — the decision
Subscribes to `rateLimits.onStateChange` and `agentHookServer.subscribeStatusChanges`. On each update, for each registry entry:
1. Usage of **that session's account** (selected → `state.claude`, else its `inactiveClaudeAccounts` entry). Reading older than `DEFAULT_POLL_MS` → not actionable (request a read at most once per poll interval, as the auto-switch does).
2. Over the line? Shared `claudeAutoSwitchHeadroom` / `isClaudeOverAutoSwitchLine` with the same `CLAUDE_AUTO_SWITCH_LINES`. Pinned sessions: only `isAtLimit`.
3. Target: shared `pickClaudeAutoSwitchTarget` over the other readable, signed-in accounts that share the runtime, minus accounts a move claimed in the last cooldown (so five sessions do not all jump onto one account at once; a target's reading is debited by an estimate of one turn after each claim). No target → `stay`, logged once per session per window.
4. Turn state: the pane's hook status must be `done`; otherwise `wait` and re-decide on the next status change (never interrupt a turn).
5. Settings: `off` → never; `ask` → raise a notice (desktop prompt reusing the existing dialog shape; on a headless host `ask` behaves as `move` and says so in the log, because nobody can answer); `move` → act.
6. Cooldowns: per session 5 min, per target account 60 s; a failed move marks the session for 60 s.
Decision record: `{ ptyId, from, to, window, percent, line, reason, at }` → one structured log line + the last decision kept per pane for `orca account list --json`.

### 3.4 `MoveStrategy.resume` (new, main) — the move
Builds the resume the way the phone's resume does (`buildAgentResumeStartupPlan` in shared + the pane's provider session from `agentHookServer.getProviderSessionIdentities()`), with the **target** account's launch env (new `ClaudeProfileRouter.launchEnvFor(accountId)`; today only the selected account's env exists), and spawns it **in the same pane** through the existing main-side pane replacement (`pane-owner-replacement.ts`: stop the old PTY, swap the pane binding), by adding `replacesPtyId` to `RuntimePtyController.spawn`. `initiallyHidden` until the new PTY is up, as the renderer's detached restart does. No provider session → skip + notice ("no conversation to resume"). Replacement throws `terminal_pane_owner_changed` → abort, mark, retry later. The old process is stopped only after the new spawn is accepted.

### 3.5 Headless parity (change, main)
`orcad` starts usage polling (`rateLimits.start()`) whenever `claudeAutoSwitchEnabled` or the mover is on, and passes `onClaudeAutoSwitched`/mover notices into its notification channel so a connected window shows the toast later. Without this the existing auto-switch is inert on servers.

### 3.6 Settings and CLI
- Setting `claudeSessionMover: 'off' | 'ask' | 'move'` (shared global settings, default `ask`), beside `claudeAutoSwitchEnabled` and `claudeAccountSwitchRunningSessions`. UI row under Settings → Accounts → Claude: "Move running sessions before a usage limit".
- RPC `accounts.setClaudeSessionMover`, CLI `orca account session-mover --agent claude --off|--ask|--move [--environment <sel>] [--json]`; `orca account list` prints `session-mover: move` and, with `--json`, the last decision per live session.
- The lines stay in one constant (`CLAUDE_AUTO_SWITCH_LINES`) and become a settings override later if upstream asks; not in scope.

### 3.7 Interplay with upstream's restart flow
When a window is attached and the selected account switches, upstream's renderer flow may restart the same pane. Two guards avoid a double move: the registry is re-recorded at every spawn (a restarted pane shows its new account, so the mover sees no reason to act), and a pane with a move in flight is skipped by both (the renderer's `isAccountRestartReady` already refuses a pane whose owner changed). Nothing in `src/renderer` is edited.

## 4. Safety
- Never moves mid-turn; never moves twice inside the cooldown; never moves to an account inside its Retry-After, signed out, or at its own line.
- A move that cannot be built or fails leaves the session as it was (the old PTY is stopped only after the new one is accepted).
- Readings: a stale reading never triggers a move; a limit reading (≥ 100 %) relaxes the ten-point minimum gain to "any room", as the auto-switch does.
- No credential copying between folders (that is the in-place strategy, §9).
- Every decision is logged with its inputs, so a wrong move is explainable from the log alone.

## 5. Tests
- `claude-pane-account-registry.test.ts`: record / forget / infer-from-transcript / pinned flag.
- `claude-live-usage-routing.test.ts`: a statusline post from a non-selected account lands in that account's entry; unknown folder dropped; selected account unchanged.
- `claude-session-mover.test.ts` (fake clock, fake registry, fake hook statuses, fake strategy; the 19-test `claude-account-auto-switch.test.ts` conventions): over-line + idle → move; mid-turn → wait then move on `done`; pinned + 93 % → stay, pinned + 100 % → move; two sessions, one target → second waits (claim cooldown); stale reading → read-usage then stay; `off`/`ask`/`move` branches; headless `ask` acts; failed move → marked, retried after 60 s; no provider session → skip with reason.
- `move-strategy-resume.test.ts` with an inline `RuntimePtyController` fake: resume command carries the target folder; `replacesPtyId` honoured; owner-changed error → no stop of the old PTY.
- CLI handler + RPC tests (settings round-trip), orcad start test (polling starts when the setting is on).
- Rehearsal, recorded in the fork's `docs/`: on the Studio (headless) and the MacBook, a scratch session driven to the line on an account with a near-exhausted window moves between turns and continues its conversation; the log line and `orca account list --json` show the decision.

## 6. Rollout
1. Fork branch `blowzer/session-mover` on top of `blowzer/auto-switch`; tests green; build; Studio first (headless proof), then the MacBook (owner's click).
2. Setting `move` on the Studio and on the MacBook for our use; default stays `ask` in the code.
3. Observe one day of decisions in the log; fix what shows.
4. Upstream, after the owner's yes, as three PRs in dependency order: (a) registry + live usage routing + orcad polling start (pure improvements, no behaviour change for users); (b) the mover with setting default `ask`; (c) CLI. Our three threshold lines stay a one-commit fork config on top.

## 7. Files (fork)
New: `src/main/claude-accounts/claude-pane-account-registry.ts`, `claude-session-mover.ts`, `claude-session-mover-policy.ts` (the per-session glue over the shared policy), `claude-session-move-strategy.ts` (interface + `resume`), tests beside each.
Changed: `src/main/rate-limits/service/service-fetch-policy.ts` (routing), `src/main/claude-accounts/claude-profile-router.ts` (`launchEnvFor(accountId)`), `src/main/runtime/runtime-pty-controller-contract.ts` + the runtime spawn path (`replacesPtyId` via `pane-owner-replacement`), `src/main/provider-account-services.ts` (wire the mover), `src/main/orcad/orcad-account-services.ts` (start polling + notices), `src/shared/global-settings-types.ts` + defaults, `src/main/runtime/rpc/methods/accounts.ts` (+ catalog), `src/cli/specs/account.ts` + a handler, the Settings → Accounts → Claude row, `src/renderer/src/i18n/locales/en.json`.

## 8. Risks
- Pane replacement from the runtime path is new plumbing; mitigated by reusing `pane-owner-replacement` verbatim and testing the owner-changed path.
- Usage readings are percentages with 15 s granularity; a very long single turn can still hit the wall. The hard-limit case then moves the session at the end of that turn (the error ends the turn), which is the rescue the owner saw missing.
- Upstream's pending renderer refactor: untouched by us; conflicts limited to `en.json` strings.

## 9. Later: in-place token swap (`MoveStrategy.swap`, not in this spec)
Continue a session mid-turn by handing it the target account's credentials without a restart. Needs: a token-sync layer so a refresh in one folder is written back to the account's canonical store (Claude keys its Keychain item to the folder path), validation of the target token before writing (#23885's failure), and Claude Code re-reading credentials on 401/429. Shipped behind `claudeSessionMover: 'move'` + `strategy: 'swap'` only after a rehearsal on both Macs.
