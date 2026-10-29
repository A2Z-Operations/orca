# Fork cleanup for an upstream contribution

Date: 2026-10-29. Branch: `nachumi-a2zoperations/fork-cleanup-upstream-defaults`. Not pushed.

Pure commits on top of `50ebcd65388` (`blowzer/session-mover` at the start of this rebase):

- `600e94be552` Make the account work contribution-ready
- `d98e72be5a9` Restore stock updates and drop the private team notes
- this report

`blowzer/session-mover` fast-forwards to this report when its worktree is still clean at `50ebcd65388`. Fork releases are `blowzer/fork-only` merged on top of that pure tip.

## Fork-only branch

`blowzer/fork-only` is this report plus two commits:

1. Keep self-built apps off the stock update feed. `ORCA_NO_PUBLISH=1` sets `publish: null`. The updater stays off when `ORCA_UPDATER_DISABLED=1`, or when a packaged app has no `app-update.yml`. That module does not import Electron. It treats `versions.electron` plus `defaultApp !== true` as packaged, and reads `resourcesPath` only when the process has it. The 33 private team notes that `d98e72be5a9` dropped are added back. `docs/team/orca-fork/reviews/mover-observability-REPORT.md` stays.
2. Turn the fork account defaults back on. Auth proxy, account pool, and auto-switch default on. Session mover defaults to `move`. An absent auth-proxy setting stays on (`!== false`). The router test expects a loopback proxy URL in that case.

Pool membership is still `=== 'on'`, so an absent pool value is off on both branches. An absent mover value is still `ask`. Headless `ask` still moves. `claude-session-mover.ts` is unchanged.

## Upstream defaults

On this branch, `default-global-settings.ts` sets `claudeAutoSwitchEnabled: false`, `claudeSessionMover: 'ask'`, `claudeAuthProxy: false`, and `claudeAccountPool: 'off'`. `claudeAuthProxyEnabled` is `=== true`, so an absent value is off. CLI notes say Default off, Default ask, Default off, and Default off. The router test expects no `ANTHROPIC_BASE_URL` when the setting is absent.

## Ratchets

`node config/scripts/check-runtime-electron-ratchet.mjs` on this commit's tree: nothing reachable imports electron.

System language no longer imports Electron. `SystemLanguageReader` lives in `src/main/i18n/system-language.ts`. No reader caches a null snapshot, so browser preferences fall through to the browser-fallback locale. A reader that returns null is not cached. `src/main/host/electron-system-language.ts` installs `app.getPreferredSystemLanguages()` from `initializeMainProcessI18nAndMenu` before `ensureMainI18n`. Plain-node hosts never import that file.

`node config/scripts/check-process-host-imports.mjs`: ok, 109 legacy direct importers remain. The durable-job scripts moved from `src/main/claude/` to `resources/durable-jobs/`, and the baseline line for `durable-background-job.mjs` was removed. That is a shrink, not a bump. System node still runs the userData copy, which cannot resolve `@orca/process-host`. The CLI looks up `resourcesPath` through a `NodeJS.Process` intersection because the CLI tsconfig does not include Electron's process type.

## Locales

`en.json` gained 44 keys since tag `v1.4.243` (this programme plus the recent-moves keys from `50ebcd65388`). es, fr, ja, ko, pt, and zh each contain all 44. `node config/scripts/verify-localization-catalog.mjs` exits 0. Pre-existing gaps stay unfilled: es 321, fr 321, ja 272, ko 321, pt 333, zh 320. The Japanese hand-off sentence does not use the generic-term family that the catalog rejects.

## Docs

`docs/reference/claude-accounts.md` covers accounts, auto-switch, the session mover, the auth proxy, the pool, and durable jobs, including the 5-hour 95% line and the weekly and Fable-weekly 90% lines, failure modes, and the CLI. `docs/site/content/docs/agents/claude-code.mdx` links it. Fumadocs cannot point outside `content/docs`, so the link is the GitHub blob for `docs/reference/claude-accounts.md`. That page and the link do not name the fork.

## Gate

`pnpm run check:changed -- --base=43998ad6815 --maxWorkers=2` ran on the tree that became `600e94be552` and `d98e72be5a9`, before the rebase onto `50ebcd65388`. The rebase only merged locale JSON. Format, oxlint, typecheck, the ratchets, and the localization catalog produced no failures.

With `GIT_IDENTITY_ALLOW_OTHER=1`, unit tests were the only red check. Three tests failed:

- `src/main/runtime/runtime-failed-local-worktree-removal.test.ts`, "never deletes a worktree Git registers at the path since, even on the same branch". The removal record stays, with "A different checkout is now at …". The same assertion fails in isolation on clean `50ebcd65388`. It is not this diff. The sibling case that uses `git init` instead of `git worktree add` passes.
- `tests/e2e/helpers/persisted-profile-state.unit.test.ts`, two cases, sqlite `unable to open database file` (errcode 14) under the full related run. Both passed in a 9-file rerun. Load flake.

Without that environment variable, real-git fixtures fail because this Mac's `commit-msg` hook rejects any author other than Nachumi Eliyahu. Upstream CI does not have that hook. `default-global-settings.ts` pulls a wide related graph, so the failures are wider than the two files named in the task. They pass when `GIT_IDENTITY_ALLOW_OTHER=1`.

The two named fixtures:

- `src/shared/git-branch-cleanup-real-git.test.ts`
- `src/main/ipc/pty/ipc/spawn-push-target-materialization-real-git.test.ts`

Also in that related run, for the same hook: `runtime-interrupted-local-worktree-removal.test.ts`, `runtime-failed-local-worktree-removal.test.ts`, `runtime-repository-clone-host-dedupe.test.ts`, `ephemeral-vm-provisioned-root-ref.test.ts`, `runtime-git-stage-worktree-scope.test.ts`, and `orca-runtime.test.ts`.

Focused vitest before the split (plugin, runner, hand-off, host env, CLI job, electron-builder config, system language, auth proxy, auto-switch policy) passed. `typecheck:node`, `typecheck:web`, and `typecheck:cli` exited 0 on that tree. On `blowzer/fork-only`, updater-disabled (4), the auth-proxy router (5), and the electron-builder config (24, 1 skipped) passed, and the runtime-electron ratchet still passed.

## Seams

Task 8's observability commit stays: recent-moves UI, stats, locale keys, and `mover-observability-REPORT.md`. The other 33 `docs/team` files from `43998ad6815` are untracked on this branch and tracked again on `blowzer/fork-only`.

`git rm --cached` was limited to those 33 paths. It was not `git rm -r docs/team`.
