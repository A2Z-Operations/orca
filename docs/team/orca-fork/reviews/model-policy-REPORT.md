# Claude model policy: spend Fable first, fall back to Opus

Date: 2026-10-30. Branch: `nachumi-a2zoperations/claude-model-policy-fallback`, off `blowzer/session-mover` at `6e2a01122b2`. Code commit: `2571ae8919f`. Not pushed.

The rule is always on in the fork (`claudeModelPolicy`, absent means on). An account runs Fable while its Fable window is under 90% and its regular weekly window is under 91%. Otherwise that account runs Opus 5.5. A new launch prefers the account with the most Fable headroom that still clears both lines, and otherwise the account with the most weekly headroom, on Opus. A live session flips through the auth proxy. It does not restart.

## Experiments

Full write-up: `docs/team/orca-fork/reviews/model-policy-EXPERIMENT.md`. Written before the policy code. No tokens are in either document.

**(a) Fable does debit the regular weekly window, on these Max seats.** Three accounts returned 200 from `api/oauth/usage`. Fable's own meter is a `weekly_scoped` limit at 50% of the weekly allowance, and `used_percent_of_weekly` matches `fablePercent * 0.5` (reports@sabrent.com 39% → share 20, nachumi770@gmail.com 32% → 16, hello@getblowzer.com 78% → 39). When weekly is the binding limit, Fable's `is_active` is false. Seven other keychain accounts returned 401. One ~52k-token turn did not move the integer percents. Legacy `fable_weekly` fields were null. A missing Fable or weekly window is Opus, not 0% used.

**(b) Buffer and parse under 8 MB.** Claude Code 2.1.316, no `--bare`, `POST /v1/messages` 200 `text/event-stream`, body 134,864 bytes, parse-and-rewrite 0.357 ms. The client printed `pong` and kept `modelUsage.canonicalModel` on `claude-fable-5-1`, so Orca has to show the effective model itself. `claude-fable-5-1` is 16 characters and `claude-opus-5-5` is 15, so Content-Length is recomputed. `thinking.type` `disabled` and `tool_choice` `any` returned 400 and are mapped to adaptive / auto on the buffer path. `thinking.budget_tokens` was a 429, not an observed 400; it is still dropped. `anthropic-beta` and `output_config.effort` are left alone. Sonnet is not rewritten. The experiment proxy buffered the response, so SSE time-to-first-byte was not measured. The production proxy still pipes the response. A live Opus-to-Fable Claude Code turn was not run (cost, then 429s).

## Design

`chooseClaudeModel` is a pure function of limits, settings, and now. A fresh choice (no current model) is Fable only when both windows are present and under the lines. An account already on Opus returns to Fable only when both windows are 5 points under the lines. The return reason is `fable-headroom` or `window-reset`. `hysteresis` means "stay on Opus". A window whose `resetsAt` has passed counts as 0% and `window-reset`. At or above 80% of the weekly window the choice carries "Fable budget will be stranded".

`chooseClaudePoolAccountForModel` ranks fresh, signed-in, unpinned accounts. Fable-eligible rows sort by Fable headroom. If none qualify, Opus rows sort by weekly headroom. Ties break to fewer assigned panes, then account order. This ranking does not use the pool's 10-point floor. Policy off keeps today's pool chooser and does not change which account a launch uses. Policy on with the pool off still attaches the model, and sets `pooled: false` when the chosen account is the selected one, so the launch is not recorded as a pool pick.

Launch injection is `ANTHROPIC_MODEL` set to the full API id. Both the PTY spawn and the structured child honor that variable. An explicit `--model` / `-m` in the command, or `ANTHROPIC_MODEL` already in the shell, is `modelSource: 'pinned'` and is not overwritten. The host-env step copies the stamped environment; it only rewrites a sequenced Codex resume command, so the variable survives. The IPC spawn stamps the same way and does not call `applyRuntimeClaudeAuthEnv`. Structured launches also set `options.model` when the pane is still on the policy. A saved session model or a user flag pins the pane and drops a policy-injected env var. The pane registry stores the short label (`fable` or `opus`) and `modelSource`. The proxy slot copies those fields.

The proxy rewrites only when the slot's source is `policy`, the method is not GET or HEAD, and the content type includes `json`. Under 8 MB it parses, rewrites the top-level `model`, and maps thinking and tool_choice. Over the cap (tests set a small cap) it swaps only the top-level model string. Content-Length is set from the rewritten bytes. A pinned slot, a non-policy model such as Sonnet, and a non-JSON body are not rewritten. The SSE response is piped.

The ticker subscribes to the same `rateLimits.onStateChange` the mover uses, and it starts even when the mover is off. It skips a pinned pane and a stale reading. Leaving Fable happens at the line. Returning waits out the 5-point band. At most one flip per pane per 10 minutes. Each flip is `setClaudePaneModel`, a `kind: 'model'` row (same account on both sides, cap 50, kept separately so a later mover decision does not erase it), and `accounts.model.changed` (`ptyId`, `accountId`, `from`, `to`, `reason`). The strand warning is logged once per pane until it clears. The usage-window rows on `accounts.list` are filled from the account list that call already built. The provider does not call `listAccounts()` again.

`orca account list` appends `weekly 42% · fable 71%` (an em dash when a side was not read) and `model-policy: on (fable<90, weekly<91)`. `orca account model-policy --agent claude --on|--off|--status|--set fable-line=.. weekly-guard=..` writes `accounts.setClaudeModelPolicy`. Lines clamp to 1–100. Moves print `fable → opus  weekly-guard  model`. The tab chip is `reports · fable`. Settings has "Spend Fable first" next to the pool row. Phone tab status gains `model` when the pane has one. Default-on policy keeps usage polling on even when the mover, auto-switch, and pool are all off.

## Files

- `src/main/claude-accounts/claude-model-policy.ts` — choice, pool ranking, ids, lines
- `src/main/claude-accounts/claude-model-policy-launch.ts` — pin detection and `ANTHROPIC_MODEL`
- `src/main/claude-accounts/claude-model-body-rewrite.ts` — buffer and streaming rewrite
- `src/main/claude-accounts/claude-model-policy-ticker.ts` — flip, cooldown, hysteresis
- `src/main/claude-accounts/claude-model-flip-history.ts` — `kind: 'model'` list
- `src/main/claude-accounts/claude-account-summary.ts` — folder summary, split out so selection stays under 300 lines
- `src/main/claude-accounts/claude-auth-proxy/claude-auth-proxy-model-body.ts` — when the proxy rewrites
- `src/main/runtime/rpc/methods/accounts-model-policy.ts` — `accounts.setClaudeModelPolicy`
- `src/cli/handlers/account-model-policy.ts` — CLI
- `src/renderer/src/components/settings/claude-model-policy-setting.tsx` — settings row
- Launch, registry, slot owner, list format, moves line, plugin event, phone status, and the tab chip are wired in the existing files named in the task.

## Tests

Node v24.22.0.

Direct vitest (`corepack pnpm exec vitest run --config config/vitest.config.ts`), 21 files, 194 tests, all passed:

- `claude-model-policy.test.ts` (10), `claude-model-body-rewrite.test.ts` (6), `claude-model-policy-launch.test.ts` (4), `claude-model-policy-ticker.test.ts` (2)
- `claude-auth-proxy-model-rewrite.test.ts` (3) — buffered rewrite with thinking and tool_choice mapped, Content-Length equal to the new body, `anthropic-beta` forwarded, first SSE chunk `data: one` before the rest, streaming swap above a tiny cap leaves thinking alone, pinned JSON and `text/plain` unchanged, GET is not rewritten, Sonnet passthrough
- `claude-auth-proxy.test.ts` (19), `spawn-claude-auth.test.ts` (14), `claude-account-pool-launch.test.ts` (3), `claude-pane-account-registry.test.ts` (8)
- `claude-structured-pane-account.test.ts` (6), `claude-structured-launch-resolution.test.ts` (32), `claude-structured-launch-account-routing.test.ts` (4), `claude-structured-spawn-options.test.ts` (13), `claude-launch-routing.test.ts` (3)
- `accounts.test.ts` (21), `account-list-format.test.ts` (4), `account-pool.test.ts` (4), `index-local-command-routing-flags.test.ts` (20)
- `plugin-claude-accounts.test.ts` (14), `runtime-mobile-structured-tab-status.test.ts` (2), `claude-usage-polling-policy.test.ts` (2)

`typecheck:node`, `typecheck:web`, and `typecheck:cli` exited 0 after the last source edit (the usage-window provider takes the accounts `list()` already built, and `createClaudeUsagePollingSwitch` takes `Partial<GlobalSettings>`).

`pnpm check:changed --base=blowzer/session-mover --maxWorkers=2` ran 26 checks on 67 files since `6e2a01122b2` and failed 2, in 3718s.

`oxlint` failed anti-slop on `claude-usage-polling-policy.ts`: `updates?: object`. That parameter is now `Partial<GlobalSettings>`, and the unrelated-key test passes `appFontFamily`. Re-ran default oxlint and `config/oxlint-anti-slop.json` on the touched files: 0 errors. The recorded failure had already read the old signature. `check-changed-code-quality.mjs` against `blowzer/session-mover` passed after that edit (0 new findings).

The related unit-test check failed 52 tests. The retained tail starts at failure 9 of 52, a `commit-msg` refusal in `runtime-repository-clone-host-dedupe.test.ts` (author `Orca Test`). The same hook refused fixture authors `Test User`, `Test`, `Orca Test`, and `Worktree Removal` in `runtime-git-stage-worktree-scope.test.ts`, `ephemeral-vm-provisioned-root-ref.test.ts`, `spawn-push-target-materialization-real-git.test.ts`, `runtime-failed-local-worktree-removal.test.ts`, `runtime-interrupted-local-worktree-removal.test.ts`, and `orca-runtime.test.ts`. `claude-auth-proxy.test.ts` "cuts an idle stream..." failed with `Error: aborted` inside that run and passed when re-run alone (1 test, 1.1s). Two failures were this change. `accounts.list` overflowed because the usage-window provider called `listAccounts()` from inside `list()`. The provider now receives that account list. Headless startup called `rateLimits.start` with the mover off, because the policy defaults on. The mover sequence in `orcad-account-services.test.ts` now turns the policy off, and a new test expects the default-on start. Re-ran `orcad-account-services.test.ts`, `claude-account-service.test.ts`, the polling policy test, and the model policy and ticker tests: 5 files, 53 tests, passed. The related suite was not repeated after that fix.

## Not covered

A live Opus-to-Fable Claude Code turn. The response `message.model` was not extracted from SSE (the experiment proxy saw no events, likely gzip). `thinking.budget_tokens` 400 was not observed. Seven accounts were 401. Integer meters did not move after one turn. The installed `orca` on this machine does not yet print the new windows; that binary is the app that is running, not this worktree. WSL guest launches still go through the same stamp only when they are not the guest-proxy env replacement. A user who pins a model keeps it across a line crossing. The tab chip was not opened in Electron; a visible window would take focus on this desktop.

## Hand check

`orca account model-policy --agent claude --status` should print `model-policy: on (fable<90, weekly<91>)`. `orca account list` should show `weekly N% · fable N%` on each Claude account once this build is the running app.

Open a Claude session on a managed account. The tab chip should read like `reports · fable` while both windows are under the lines. `orca account moves` grows a `model` row when the ticker flips.

To force a flip without waiting for real usage, lower the lines under the account's current percents:

```sh
orca account model-policy --agent claude --set fable-line=1 --set weekly-guard=1
```

The next usage publish (or a settings change that refreshes usage) moves a policy session to Opus. The slot then ignores another flip for 10 minutes. Put the lines back with `--set fable-line=90 --set weekly-guard=91`. Returning to Fable also waits until both windows are 5 points under those lines. `--off` stops injection and rewrites. An explicit `claude --model claude-sonnet-4-6`, or `ANTHROPIC_MODEL` in the shell, stays pinned and is not rewritten.
