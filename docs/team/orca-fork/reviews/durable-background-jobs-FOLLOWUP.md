# Durable background jobs — follow-up

Date: 2026-10-29. Branch: `nachumi-a2zoperations/durable-jobs-followup-fixes` (off `blowzer/session-mover`, HEAD at start `f3dbe7880c`). Prototype: `db81938beb`. Hand-off note: `89e8db05f0`. Prior report: `docs/team/orca-fork/reviews/durable-background-jobs-REPORT.md`.

`corepack pnpm` on this machine still fails with `MODULE_NOT_FOUND` for the 12.14.0 shim. Commands used `node` on `/Users/nachumieliyahu/Library/pnpm/.tools/pnpm/12.14.0/node_modules/pnpm/bin/pnpm.mjs` (a `/tmp/pnpm-bin/pnpm` wrapper so nested `pnpm run` scripts resolve).

## 1. Pane launch test

The product stays on unless `ORCA_DURABLE_JOBS=0`, Windows, or WSL. The assertion "starts the host's planned command once…" in `src/main/ipc/pty/pty-agent-pane-launch.test.ts` sets `ORCA_DURABLE_JOBS=0` for that test and restores the previous value in `onTestFinished`. The spawned command stays `claude`. The file's other nine tests passed with injection left on.

The brief named three other files and said they fail on the base for environment reasons. Re-run on this worktree (same vitest command, `ORCA_BACKGROUND_LAUNCH=1`):

| File                                                    | Result                    | Failure                                                                                                                         |
| ------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `src/main/ipc/pty-attach-view-joins-main-start.test.ts` | 3 failed                  | `providerSpawn` called 0 times (`vi.waitFor` timeout)                                                                           |
| `src/main/ipc/pty-claude-agent-view-readiness.test.ts`  | 1 failed                  | spawn `env` stayed undefined. The next assertion is about `ORCA_CLAUDE_AGENT_VIEW_PLUGIN`, not the durable-job plugin           |
| `src/main/ipc/pty-spawn-scaling.performance.test.ts`    | 1 failed, the rest passed | provider called 0 times on "N/10N tabs". A passing case logged `terminal_split_source_not_found` from `savePtySpawnPaneBinding` |

None of the failure text mentions `orca-durable-jobs`, `--plugin-dir`, or the waiter. Those three files were not edited. The brief said "four other" and named these three. No fourth file was named.

## 2. Hand-off

`deliverClaudeSessionMoveHandoff` lists jobs from `jobRoot` (default `jobRoot()`, which tests must override) and keeps entries whose `request.json` `sessionId` matches the dying session. `buildClaudeSessionMoveHandoffNote` passes that list to `formatSurvivingJobNote`. The English sentence is now "The restart ended subagents of the previous process ({{known}})." The same `accounts.claude.sessionMover.handoff.ended` key is updated in `en.json`. That key exists only in `en.json`. Other locales use the code fallback, which matches. Running jobs are named `id log=<path>`. Exited and other-session jobs are omitted. No running jobs produces "No detached Orca jobs were still running."

## 3. Packaging

The agent-view plugin is inlined as a string because the app loads it. Claude executes the durable-job hook and waiter as real `node` files, so they have to be copied out of the bundle.

- `config/build-plugins/durable-job-scripts.ts` emits both scripts as Rollup assets `durable-jobs/<name>` next to the main bundle.
- `commonExtraResources` copies `src/main/claude/durable-background-job.mjs` and `durable-background-job-hook.mjs` to `durable-jobs/` for mac, linux, and win. That is what `/Applications/Orca.app` ships. `build:desktop` does not run electron-builder, so the app bundle's `Resources/durable-jobs/` is proved by `config/scripts/electron-builder-config.test.mjs` ("ships the durable-job scripts in every platform extraResources"), not by a packed `.app`.
- `durableJobScriptPaths` looks, in order, at `process.resourcesPath/durable-jobs`, `import.meta.dirname/durable-jobs`, `import.meta.dirname` (vitest and source), then the usual source fallbacks.

`pnpm run build:desktop` typechecked (3,230 files, no type errors) and electron-vite wrote:

```
out/main/durable-jobs/durable-background-job.mjs
out/main/durable-jobs/durable-background-job-hook.mjs
```

`cmp` against `src/main/claude/` was byte-identical, including the `#!/usr/bin/env node` shebang. The command then exited 1 in `build:mobile-web`: 604 resolve errors for `react-native-web` and `expo-router`. That step does not package the desktop scripts. This worktree's mobile deps are missing. The desktop emit had already landed. After the emit plugin moved to `config/build-plugins/durable-job-scripts.ts`, `node config/scripts/run-electron-vite-build.mjs` exited 0 and `cmp` was byte-identical again (hook 917 bytes, runner 16,838 bytes).

## 4. Permissions

The detach fallback used to call `spawnSync`. That counted as a new main-thread launch under `config/main-sync-spawn-baseline.txt`, and the copied script cannot import `@orca/process-host`. The fallback now `spawn`s bash and exits with the child's status, so the process still is the job and the ratchet stays at its previous 57 uses. The waiter command is exactly `orca-durable-job run --id dj_<16 hex>`. It prefix-matches one allow rule:

```
Bash(orca-durable-job run --id:*)
```

Exported as `DURABLE_JOB_ALLOW_RULE`. The hook still does not set `permissionDecision`. `ensureDurableBackgroundJobPlugin` symlinks `<userData>/claude-durable-jobs/bin/orca-durable-job` at the current hash's runner. A Claude launch that installs the plugin prepends that `bin` directory to `PATH`. Launches that do not inject strip a stale copy of that directory. `additionalContext` tells the model to read the log with `orca-durable-job logs --id <id>`. A command that already contains `orca-durable-job` or `durable-background-job.mjs` is not rewritten.

Claude Code's hooks docs describe `permissionDecision: "allow"` together with `updatedInput`. GitHub issue [#81340](https://github.com/anthropics/claude-code/issues/81340) (Claude Code 2.1.220) reports that combination silently drops `updatedInput` and runs the original command. It was closed on 2026-08-15 as a duplicate of [#79321](https://github.com/anthropics/claude-code/issues/79321). This follow-up did not re-prove that pair on 2.1.312. The prototype on 2.1.312 showed `updatedInput` works when `permissionDecision` is absent. Non-bypass sessions need the allow rule above. A login shell that rebuilds `PATH` and drops the inherited entry will not find `orca-durable-job`. Profiles that keep `$PATH` are fine. A missing waiter fails the tool visibly.

## 5. Sweeper

`sweepDurableJobs` runs at desktop `initializeReadyRuntimeServices` and at the start of `startOrcadRuntime`, through `sweepDurableJobResidueAtStartup`. The helper no-ops when `VITEST=true`. The desktop call site also skips the call in Vitest, so `app.getPath('userData')` is not evaluated against a mock that has no `getPath`. A test boot does not delete `~/Library/Application Support/orca/durable-jobs`. Failures are logged and do not throw.

Rules, using `>` so an entry at exactly the limit stays:

- `pending`: age from `createdAt` when that parses, otherwise `request.json` mtime. Older than 1 hour is removed.
- `exited`: age is the `exit` file mtime, not `createdAt`. Older than 7 days is removed.
- `running` and `lost` stay.
- Plugin dirs under `<userData>/claude-durable-jobs/` whose names are 20 hex digits and are not the hash of the scripts on disk are removed. `bin/` and the current hash stay. Unreadable scripts skip the plugin sweep.

The job root is `ORCA_DURABLE_JOB_ROOT` or the platform default. It is not `userData`. Plugin copies live under `userData`.

## Tests

`ORCA_BACKGROUND_LAUNCH=1` and the vitest config `config/vitest.config.ts`:

- `src/main/claude/durable-background-job.test.ts` — 18 passed. Rewrite command is exactly `orca-durable-job run --id dj_0123456789abcdef`, `permissionDecision` stays unset, re-entry on `orca-durable-job` returns null, sweep cases for pending, exited, running, lost, and a non-job directory.
- `src/main/claude/durable-background-job-plugin.test.ts` — 4 passed. Resources path wins, empty resources fall through to source, old hash dirs go, current hash and `bin` stay, unreadable scripts delete nothing.
- `src/main/ipc/pty/host-env/durable-background-job.test.ts` — 7 passed. Claude launches prepend the waiter `bin` and the symlink points at the runner. Codex, WSL, and `ORCA_DURABLE_JOBS=0` do not.
- `src/main/claude-accounts/claude-session-move-handoff-note.test.ts` — 9 passed.
- `src/main/claude-accounts/claude-session-move-handoff.test.ts` — 1 passed. Temp `jobRoot`: one running job for the dying session is pasted, the other session's running job and the dying session's exited job are not.
- `src/main/ipc/pty/pty-agent-pane-launch.test.ts` — 10 passed.
- `src/main/startup/codex-hook-startup-wiring.test.ts` — 3 passed after the Vitest `getPath` gate.
- `config/scripts/electron-builder-config.test.mjs` — the new extraResources assertion passed.

Together, the seven vitest files above are 52 passed.

`src/main/claude/durable-background-job.mjs` keeps `node:child_process` because system node runs the copied script. It is listed in `config/process-host-direct-import-baseline.txt`. The import was already in the prototype. The shrink-only ratchet flags any production file that is not on that list. `spawnSync` is gone, so `check:main-sync-spawn-ratchet` stays at 57 uses in 43 files.

The detach tests still read `Date.now()` (ignored: a real child is not on the fake clock) and sleep through one `yieldMs` helper. With `ORCA_CODE_QUALITY_BASE=HEAD`, `check:flaky-test-pattern-ratchet` is clean. A direct run against `origin/main` still dies with `spawnSync git ENOBUFS` because that diff is 32,221 files.

`en-runtime-required.json` gained the ten `accounts.claude.sessionMover.handoff.*` strings, including the rewritten `ended` sentence. Seven older entries that the generator would drop stayed. The coverage check calls those extras harmless. No other English string changed.

`pnpm check:changed --maxWorkers=2` with no base compares this fork to `origin/main`. The follow-up gate is `node config/scripts/check-changed.mjs --base=HEAD --maxWorkers=2`. The first run, before the fixes above, failed five checks: flaky-test patterns, sync-spawn, runtime-electron, localization, and unit tests. The second run (20 files, 27 checks, 1359.9s) failed two. Flaky-test, sync-spawn, and localization passed. `runtime-electron-ratchet` still names `src/main/i18n/system-language.ts` and `src/main/updater/updater-disabled.ts`. Both files are unchanged versus HEAD, and the ratchet's baseline is zero. Unit tests: 11 failed, none in the durable-job files, and `app.getPath` is gone. The three environment-only PTY files in section 1 failed again, with the same "provider called 0 times" / "env undefined" assertions in `pty-runtime-hidden-at-spawn-mark`, `pty-launch-race-parity`, `pty-hidden-at-spawn-mark`, and `pty-pane-materialization-race`. `config/scripts/main-entry-facade.test.ts` compared `/tmp` with `/private/tmp`. `tests/tools/branch-line-total-renderer.test.mjs` could not commit as `Test <test@example.com>` because the global commit-msg hook requires Nachumi's identity. None of those files are in this diff.
