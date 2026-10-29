# Phase 2 merge: pool-surface and proxy-remote-hosts

Date: 2026-10-29. Branch `blowzer/session-mover` in the main checkout. Not pushed.

## Commits

| Commit                                            | What                                                                                                                                   |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `4f18a1cefa47381a11bd85367bd6000f954a5d7b`        | Merge `d5786ce36679bf5fbda345c5270e60d400a91c13` (pool-surface, Task 3)                                                                |
| `ceacc11b624b851afbddecb61e0e714f9adcc441`        | Merge `28e1d83a663e7af38c34902135f0fd9d798194e4` (proxy-remote-hosts)                                                                  |
| parent `ceacc11b624b851afbddecb61e0e714f9adcc441` | Locale strings, orcad CJS `import.meta`, launch-parity facts, PTY login-shell warm, operation-key read. This report is in that commit. |

Already on the branch before this task: pool-policy `bd264cf571d`, pool-rebalancer `fbe6ffda2e4`, proxy-robustness `07de9254d39`, durable-jobs-platforms `8911244b618`, plugin-accounts-api `07e548ad90a`.

## pool-surface conflicts

Files: `claude-account-selection.ts`, `service.ts`, `claude-account-switch-settings.ts`, `managed-account-types.ts`.

Task 1 keeps the setting semantics and the launch choice. Task 3 keeps the CLI, RPC, UI, session counts, move history, and the pane badge.

- One `claudeAccountPool?: ClaudeAccountPoolSetting` (`'off' | 'on'`) in `src/shared/claude-account-switch-settings.ts`. Absent means off. The only default is `'off'` in `src/shared/default-global-settings.ts`.
- `setAccountPool(enabled: boolean)` writes `'on'` or `'off'`. That is the signature Task 3's tests call, and it is the value `claudePoolAccountForLaunch` reads, so the switch chooses the account a new session launches on.
- The snapshot reports both `accountPool` (Task 1) and `pool` (CLI and status bar) as the same value, plus `assignedSessions`, `paneAccounts`, and `wslAuthProxy`.

## proxy-remote-hosts conflicts

Files: `spawn-claude-auth.ts`, `spawn-preflight.ts`, `managed-account-types.ts`.

The pooled account is the account whose proxy slot is prepared. `resolveRuntimeClaudeAuth` calls `prepareLaunchFor(pooled.accountId)` when the pool names an account. `applyRuntimeClaudeAuthEnv` drops a foreign loopback `/p/<slot>/` URL (`isForeignClaudeAuthProxyUrl` against `claudeAuthProxyListeningPort`) and then applies that account's host patch. `claudeLaunchPinsAccount` is true for an explicit account or a pooled choice, so the selected account's shell pointer does not survive.

`spawn-preflight.ts` runs `applyWslGuestAuthProxyEnv` only for a WSL orcad Claude launch that still has no `ANTHROPIC_BASE_URL`. A pooled or explicit slot already in the patch is left alone.

proxy-robustness (`07de9254d39`) had moved `claude-auth-proxy-host.ts` and the accounts RPC after remote-hosts branched. The cache-miss reader `readClaudeAuthProxyAccessToken` stays, including its one-line comment that the miss path never refreshes. The accounts methods kept together are `accounts.claudeAuthProxyStatus`, `accounts.setClaudeAccountPool`, and `accounts.assignClaudePane`.

`pnpm run generate:rpc-params-catalog` (`config/scripts/generate-rpc-params-catalog.mjs`) reported the catalog already matched. `src/shared/rpc-contract/rpc-params-catalog.generated.ts` was not hand-merged. It contains `AssignClaudePaneParams`, `ClaudeAuthProxyStatusParams`, `SetClaudeAccountPoolParams`, and the three method map entries.

## Gate fixes on the merged head

pnpm is `/opt/homebrew/bin/pnpm` 12.14.0. `corepack pnpm` and `~/.npm-global` pnpm fail with ENOEXEC on this machine. Vitest therefore runs on Homebrew Node v26.0.0 (`/opt/homebrew/Cellar/node/26.0.0/bin/node`). A newer `node` on `PATH` is v26.7.0 and was not the test runner.

- orcad's esbuild bundle is CJS and rejects `import.meta.dirname` / `import.meta.filename` (`empty-import-meta`). `durable-background-job-plugin.ts` and `durable-background-job.mjs` now take the directory from `fileURLToPath(import.meta.url)`, which esbuild rewrites. The hook module is outside that bundle and still uses `import.meta.dirname`.
- `pty-launch-parity.test.ts` sets `ORCA_DURABLE_JOBS=0` for that file only, matching `pty-agent-pane-launch.test.ts`. Durable jobs are otherwise on. `spawn-options-assembly.ts` omits `terminalShellArgs` when the resolver returns `undefined`, because a present key is a shell-profile fact.
- `orcad-forked-child-paths.test.ts` realpaths the temp deploy root. On macOS `/var/folders` is `/private/var/folders`, and `resolveOrcadInstallRoot` realpaths `process.argv[1]`.
- Plain PTY spawns wait on `resolveLoginShellEnvironment` (`zsh -ilc`, about 1.5s on this machine). `vi.waitFor` gives up at 1s, and fake timers also freeze the 5s shell fallback. `setupPtyIpcSuite` warms that cache in `beforeAll`, before any test calls `useFakeTimers`. It is not a global setup file.
- Node 26.0.0's `node:sqlite` stores a TEXT value that contains NUL, and `hex()` shows the bytes after it, but the JavaScript string returned for a TEXT column stops at the first NUL. Node 26.7.0 returns the full string. The agent-session operation key is `callerKey + NUL + operationId`, so a reopen on 26.0.0 dropped the row and replay launched again. `loadAgentSessionStoreRows` and the test read-back now `SELECT CAST(operation_key AS BLOB)` and decode the bytes as UTF-8. The separator is unchanged. Bind still writes the full key.

## Localization

New leaves from the seven branches: `accountsRead` and `sessionMover.rebalanceBody`. Hand-added in es, fr, ja, ko, pt, and zh. `{{from}}` and `{{to}}` are unchanged. `bootstrap-locale-catalog.mjs` was not run. `pnpm run sync:localization-runtime-catalog` rewrote `src/renderer/src/i18n/en-runtime-required.json`.

Pre-existing coverage gaps remain (the verifier does not fail on missing translations). After this sync, pt still reports 362 missing and zh 347 missing.

- `pnpm run verify:localization-catalogs` exit 0
- `pnpm run verify:localization-extraction` exit 0 (15672 keys extracted)

## Gates

Typecheck, each exit 0, after the source fixes: `pnpm run typecheck:node`, `typecheck:web`, `typecheck:cli`. `typecheck:node` was run again after the operation-key read change.

Vitest, second full pass, Homebrew Node 26.0.0, 471.77s, start 09:29:53:

```
Test Files  5 failed | 3484 passed | 36 skipped (3525)
Tests  12 failed | 36778 passed | 3 expected fail | 892 skipped (37685)
Errors  10 errors
```

The 12 failures are the known real-git fixtures. This machine's global `commit-msg` hook refuses any author other than Nachumi Eliyahu &lt;nachumi@a2zoperations.com&gt;. `GIT_IDENTITY_ALLOW_OTHER` was not set.

- `src/shared/git-branch-cleanup-real-git.test.ts` (7)
- `src/shared/git-change-list.test.ts` (1: reads root, branch and parent comparisons from a real repository)
- `src/main/plugins/plugin-install.test.ts` (`installPluginFromGit`)
- `src/main/plugins/plugin-private-marketplace.integration.test.ts` (1)
- `src/main/ipc/pty/ipc/spawn-push-target-materialization-real-git.test.ts` (2)

The 10 errors are `EnvironmentTeardownError` after passing renderer files (`worktree-activation-structured-chat-surface`, `worktree-creation-chat-setup`, `worktree-creation-backend-startup-focus`, `launch-agent-background-session-launch-parity`). Vitest reports them as environment teardown, not as failed tests. The same class showed up on the first full pass (4 errors) before the operation-key fix. They were not changed here.

`pnpm-lock.yaml` gained an `@pnpm/exe@12.14.0` hunk from the hook environment and was left unstaged.

## Left

Not pushed. The real-git fixtures stay red on this machine until the commit-msg hook allows the fixture author. The renderer teardown rejections are still reported at the end of the full suite.
