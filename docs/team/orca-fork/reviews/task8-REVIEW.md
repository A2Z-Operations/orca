# Review: session mover Task 8 (setting surface)

Range `362b5c2710..91442d2441`. One commit, `91442d2441694126f8860ebd5f23e31c08d984b1`, 20 files, +358 / -7. Author and committer are both Nachumi Eliyahu `<nachumi@a2zoperations.com>`. Read at `91442d2441`. This review re-ran the RPC method test, `account.test.ts`, `account-session-mover.test.ts`, the routing test, and `src/cli/specs`: 8 files, 101 passed. `verify:rpc-params-catalog` exited 0. `verify:localization-catalog` verified 17807 key references and exited 0. `verify:localization-extraction` and `verify:localization-coverage` exited 0. Typecheck was not re-run.

Line numbers are the file at `91442d2441`.

## Spec compliance

### Step 1: RPC test

| Requirement | Where | Verdict |
|---|---|---|
| Test sets the policy on the server that owns the accounts | `src/main/runtime/rpc/methods/accounts.test.ts:21-35` | ✅ |
| Permission is `accounts-admin` | `:31` | ✅ |
| `setting: 'sometimes'` is rejected | `:32` | ✅ |
| Handler resolves the runtime state and calls `setClaudeSessionMover('move')` | `:33-34` | ✅ |
| The method is a request method | `:26-28` | ✅ |
| Step 1 red run | Not in the diff. The report cites a missing-method red under `.git/task8/`. Not re-run. | ✅ Process step. |

### Step 2: RPC implementation

| Requirement | Where | Verdict |
|---|---|---|
| `SetClaudeSessionMoverParams` is `setting: 'off' \| 'ask' \| 'move'` | `src/shared/rpc-contract/accounts-params.ts:34` | ✅ |
| `accounts.setClaudeSessionMover`, permission `accounts-admin`, forwards `params.setting` | `src/main/runtime/rpc/methods/accounts.ts:155-159` | ✅ Same shape as `accounts.setClaudeAutoSwitch` at `:149-154`. The runtime that receives the call is the owner. Neither method takes a separate target. |
| `RuntimeAccountController.setClaudeSessionMover` calls `claudeAccounts.setSessionMover` | `src/main/runtime/runtime-account-controller.ts:208-210`. Import at `:1` | ✅ |
| Command surface type and bind | `src/main/runtime/runtime-service-command-surface.ts:59` and `:174` | ✅ |
| Catalog entry `'accounts.setClaudeSessionMover': SetClaudeSessionMoverParams` | `src/shared/rpc-contract/rpc-params-catalog.generated.ts:61` and `:725` | ✅ `verify:rpc-params-catalog` (`generate-rpc-params-catalog.mjs --check`) exited 0, so the file matches the generator. |
| RPC suite green | This review: 16 passed in `accounts.test.ts` | ✅ |

### Step 3: CLI tests

| Requirement | Where | Verdict |
|---|---|---|
| Sets `move` through `accounts.setClaudeSessionMover` and prints `session-mover: move` | `src/cli/handlers/account-session-mover.test.ts:26-40` | ✅ The plan placed this in `account.test.ts`. See deviations. |
| `--json` prints `{ sessionMover: 'off' }` | `:43-51` | ✅ |
| Zero or two of `--off`, `--ask`, `--move` throw, and `--agent codex` throws, with no RPC | `:54-76` | ✅ |
| `account list` human line `auto-switch: on` then `session-mover: move` | `:78-96` | ✅ |
| `account session-mover --environment m4air` constructs the client with `m4air` and calls the RPC | `src/cli/index-local-command-routing-flags.test.ts:373-404` | ✅ |
| Step 3 red run | Not in the diff. The report cites a missing-handler red. Not re-run. | ✅ Process step. |

### Step 4: CLI implementation

| Requirement | Where | Verdict |
|---|---|---|
| `'ask'` and `'move'` in `CLI_BOOLEAN_FLAGS` | `src/shared/cli-argument-boundary.ts:8` and `:38` | ✅ |
| `setClaudeSessionMover`: Claude only, exactly one of off/ask/move, RPC, JSON, text | `src/cli/handlers/account-session-mover.ts:15-38` | ✅ 39 lines. |
| Handler map entry | `src/cli/handlers/account.ts:43` and `:298` | ✅ |
| Manifest key `account session-mover` | `src/cli/handler-group-manifest.ts:42` | ✅ |
| Spec path, summary, usage, flags, notes, examples | `src/cli/specs/account.ts:65-79` | ✅ The text matches the plan. |
| Primary help row | `src/cli/root-help-text-primary.ts:32` | ✅ |
| Secondary help row | `src/cli/root-help-text-secondary.ts:48` | ✅ |
| `shouldIgnoreRemoteSelection` keeps `session-mover` on the same carve-out as `auto-switch` | `src/cli/index.ts:33-35` | ✅ |
| `AccountsBlock.sessionMover` and the human `session-mover:` line | `src/cli/handlers/account-list-format.ts:12-13` and `:47-48` | ✅ |
| `orca account list --json` keeps `sessionMover` and `sessionMoves` | `src/cli/format.ts:74-76` prints the RPC result. `accounts.list` returns `getAccountsSnapshot` (`src/main/runtime/rpc/methods/accounts.ts:140`). The snapshot's Claude state is `listAccounts()` (`src/main/runtime/runtime-account-controller.ts:150`), which includes both fields (`src/main/claude-accounts/claude-account-selection.ts:108-109`, Task 7). The new list test asserts both survive (`account-session-mover.test.ts:99-128`). | ✅ |
| CLI suites green | This review: the plan's paths plus the split test file, 101 passed | ✅ |
| `typecheck:cli` | Not re-run. | ✅ The report cites exit 0. This review does not adopt that as its own run. |

### Step 5: Settings row and strings

| Requirement | Where | Verdict |
|---|---|---|
| Nine English keys under `accounts.claude.sessionMover` | `src/renderer/src/i18n/locales/en.json:21347-21356` | ✅ Titles, description, Off/Ask/Move, notice title, moved/ask/failed bodies. |
| `ClaudeSessionMoverSetting` select, default `ask`, writes `claudeSessionMover` | `src/renderer/src/components/settings/claude-session-mover-setting.tsx:41-45` | ✅ 65 lines. The fallback matches `default-global-settings.ts:187`. |
| Row beside the Claude account rows, hidden on a remote scope | `src/renderer/src/components/settings/accounts-pane-claude-section.tsx:389-394` | ✅ Auto-switch renders at `:389`. The mover renders with the running-session row at `:392-393`. |
| The row writes through `updateSettings`, the same call the running-session row uses | `:392-393` and `claude-session-mover-setting.tsx:44` | ✅ `updateSettings` persists through `window.api.settings.set` (`src/renderer/src/store/slices/worktree-visibility-settings-write.ts:108`). The mover reads `getSettings().claudeSessionMover` on each pass (`src/main/claude-accounts/claude-session-mover.ts:23-24`). |
| A remote host is set with `orca account session-mover --environment` | `src/cli/index.ts:33-35` and the routing test at `index-local-command-routing-flags.test.ts:373-404` | ✅ The plan states this split. |
| No component unit test | None added | ✅ The plan says the row mirrors the untested running-session row and is covered by typecheck and the localization verifiers. |
| Localization verifiers | This review: catalog, extraction, and coverage each exited 0. Other locales still have missing keys, and the catalog verifier allows that. No locale file other than `en.json` changed in the diff. | ✅ |

### Step 6: commit

| Requirement | Where | Verdict |
|---|---|---|
| Subject `feat(accounts): claudeSessionMover setting — RPC, CLI session-mover command, account list line, Settings row` | Commit subject | ✅ |

### Design §3.6

| Requirement | Where | Verdict |
|---|---|---|
| Setting `off` \| `ask` \| `move`, default `ask` | Params at `accounts-params.ts:34`. UI fallback at `claude-session-mover-setting.tsx:41`. Stored default at `default-global-settings.ts:187` (earlier task). | ✅ |
| Row under Settings, Accounts, Claude: "Move running sessions before a usage limit" | `en.json:21348` and the row at `accounts-pane-claude-section.tsx:393` | ✅ |
| RPC `accounts.setClaudeSessionMover` | `accounts.ts:155-159` | ✅ |
| CLI `orca account session-mover --agent claude --off\|--ask\|--move [--environment] [--json]` | Spec at `specs/account.ts:66-70`. Handler at `account-session-mover.ts:15-38`. | ✅ |
| `orca account list` prints `session-mover: move` | `account-list-format.ts:47-48` | ✅ |
| `orca account list --json` includes the last decision per live session | Preserved on `result.claude.sessionMoves`. Test at `account-session-mover.test.ts:104-127`. | ✅ |

### Declared deviations

| Deviation | Judgment | Verdict |
|---|---|---|
| Handler and list tests live in `account-session-mover.test.ts` because `account.test.ts` is at the 800 counted-line test cap | `account.test.ts` is 828 physical lines and 712 counted lines (blank and comment lines removed). The new file is 130 physical lines. Adding those cases to the existing file crosses 800. No `max-lines` disable was added. Assertions match the plan. | ✅ |
| Routing test spies on `console.log` inside the test | The neighbouring auto-switch test does the same (`index-local-command-routing-flags.test.ts:281`). | ✅ |
| Extra account-list JSON case for `sessionMover` and `sessionMoves` | The human formatter only adds the policy line. JSON already prints the whole snapshot (`format.ts:74-76`). The extra test locks the design's `--json` field. | ✅ |
| English only; other locales stay on fallback | The three localization verifiers exited 0. The catalog check allows the existing missing translations. | ✅ |

## Correctness

No Blocker, Important, or Minor.

Checked the paths the design calls out. A desktop Ask stays `ask`: the CLI writes the setting it was given (`account-session-mover.ts:27-33`), and the headless rewrite stays in the mover (`claude-session-mover.ts:25`). The Settings select offers Off, Ask, and Move and ignores any other value (`claude-session-mover-setting.tsx:42-45`). `account list` with no `--agent` prints the Claude policy line when the host sends `sessionMover` (`account-list-format.ts:47-48`). `--environment` on `session-mover` reaches the named server (`index.ts:110-112` with the carve-out at `:33-35`). The RPC permission matches auto-switch.

## Quality

New production files: `account-session-mover.ts` 39 lines, `claude-session-mover-setting.tsx` 65 lines. Both are under the plan's about-200 guide. The new test is 130 lines. `handler-group-manifest.ts` is 299 counted lines, under the 300 counted-line rule. `account.ts` is 283 counted lines. The diff does not touch `runtime/spawn-commit.ts`.

The diff adds one lint annotation: `accounts.test.ts:24`, `oxlint-disable-next-line typescript/consistent-type-assertions`, with the SAFETY comment the plan wrote. The auto-switch stub in the same file uses the same annotation (`:294`). The diff adds no `max-lines` disable and no file-level `eslint-disable`.

The handler follows `account-auto-switch.ts` (agent check, one flag, one RPC, JSON or one line). The Settings component follows `claude-running-session-switch-setting.tsx`. The plan asks for those twins.

The five handler tests assert an RPC payload, a thrown message, a printed line, or a JSON object. The routing test asserts the client constructor argument and the RPC payload (`index-local-command-routing-flags.test.ts:402-404`). This review re-ran them: 101 passed across the plan's CLI paths, the split test file, and the RPC file.

## Verdict

Yes

0 Blockers, 0 Importants, 0 Minors.
