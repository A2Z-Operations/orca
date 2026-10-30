# PR ladder report

Prepared locally on current `upstream/main` (`e8e08036729`). Nothing was pushed. No issue and no pull request was opened on `stablyai/orca`. Every `pr/*` branch has its upstream tracking unset.

Author on every commit: Nachumi Eliyahu <nachumi@a2zoperations.com>. No AI trailers.

Draft bodies and this report live only on `pr-ladder/integrated` (force-added, because `docs/**` is gitignored). They are not part of any `pr/*` diff.

## Rebase / land order

Land onto `upstream/main` in this order. Each branch compiles and tests alone against `upstream/main`, so a later branch already contains the earlier steps it needs. After a previous PR merges, rebase the next branch and drop the commits that already landed.

1. `pr/claude-monitoring-pane-restart` — HEAD `85be7c39f85e`. Keep `e71e24465158` and `85be7c39f85`. No registry dependency. After this lands, drop `85be7c39f85`'s twin on the later branches (`54d7b14c686`, `81fde266a1b`, `add29910ad6`).
2. `pr/claude-pane-account-registry` — HEAD `5446d553722`. After 1, or beside 1. Keep `cb595fb45e0`, `81011fc7f5b`, `5446d553722`.
3. `pr/claude-session-mover` — HEAD `54d7b14c6863`. After 1 and 2. Drop `cb595fb45e0` and `90b651fb3db`. Drop the duplicate auto-switch help lines inside `e3e6b10031b`. Drop `54d7b14c686` once PR1's `85be7c39f85` has landed. Keep `367e93d8d83`, `ce070e32194`, `e3e6b10031b`, `27a69fd505a`. Keep the registry follow-ups `81011fc7f5b` and `5446d553722`, which are not in this branch's history. Keep the adoption-test line from `e71e24465158` (this branch's cherry-pick `90b651fb3db` does not have it).
4. `pr/claude-auth-proxy` — HEAD `81fde266a1b1`. After 3. Keep `991f86cc2b4`. Drop `078678aee0b` (same as mover `27a69fd505a`) and `81fde266a1b` (same as PR1 `85be7c39f85`).
5. `pr/claude-account-pool` — HEAD `add29910ad68`. After 4. Keep `82f9ce675b9`. Drop `a245581feee` and `add29910ad6`.
6. `pr/claude-durable-background-jobs` — HEAD `c1552b7eccf`. Independent of 2–5. Can land any time. Do not rebase it onto 2–5. After 1 lands, drop the adoption-test hunk in `structured-agent-session-create-adoption.test.ts`.
7. `pr/plugin-accounts-api` — HEAD `3733d18a3aeb`. After 2 only. Drop `cb595fb45e0`, `81011fc7f5b`, and `5446d553722`. Keep `3733d18a3ae`.

`27a69fd505a` (session mover), `078678aee0b` (auth proxy), and `a245581feee` (pool) are the same one-file patch. After the mover lands, drop the copies on the later branches.

## This Mac

- `corepack pnpm` is broken. Gates use `/opt/homebrew/bin/pnpm` through `PATH=/tmp/pnpm-wrap`, and `unset npm_execpath`.
- Real-git fixtures need `GIT_IDENTITY_ALLOW_OTHER=1` or they fail on the commit-msg identity hook. Known files: `src/shared/git-branch-cleanup-real-git.test.ts`, `src/main/ipc/pty/ipc/spawn-push-target-materialization-real-git.test.ts`, plus runtime interrupted-local-worktree-removal, runtime-failed-local-worktree-removal, runtime-repository-clone-host-dedupe, ephemeral-vm-provisioned-root-ref, runtime-git-stage-worktree-scope, and `orca-runtime.test.ts` when the gate selects them. They did not fail on the durable-jobs run. Gates pass `GIT_IDENTITY_ALLOW_OTHER=1`.
- Pre-existing macOS pty flakes under `vi.useFakeTimers()` / `vi.waitFor`. Do not product-fix. The durable-jobs run failed exactly these nine:
  - `src/main/ipc/pty-claude-agent-view-readiness.test.ts` — spawns a plain shell while reconciliation is pending
  - `src/main/ipc/pty/pty-runtime-hidden-at-spawn-mark.test.ts` — expected undefined to be defined
  - `src/main/ipc/pty-attach-view-joins-main-start.test.ts` — three cases (cold saved refusal, attaches to the terminal main starts, attaches when main's start carries no payload)
  - `src/main/ipc/pty/pty-launch-race-parity.test.ts` — producer registration exit
  - `src/main/ipc/pty/pty-hidden-at-spawn-mark.test.ts` — expected `vi.fn()` once, got 0
  - `src/main/ipc/pty-spawn-scaling.performance.test.ts` — N/10N tabs
  - `src/main/ipc/pty/pty-pane-materialization-race.test.ts` — expected called 1 time, got 0
- `pnpm-lock.yaml` gets rewritten by workspace-package builds and lint-staged. It is restored and not committed.
- Do not run two vitest or `check:changed` processes at once.

## Per-branch gates

### 1. pr/claude-monitoring-pane-restart

HEAD `85be7c39f85e` on `e71e24465158`. Feature commit is 6 files, +62/−3. The follow-up is 1 line in `agent-session-saved-roster.test.ts`. Tracking unset.

First gate on `e71e24465158` (`/tmp/pr1-check.log`, `--timeout=60`): `✗ 1 of 27 check(s) failed in 1811.0s: unit tests`. `CHECK:1`. Every other check passed. The 12 unit failures were: 4 cases of `agent-session-saved-roster.test.ts` (the snapshot now includes `mainAgentState`, and the assertion did not); 6 `wsl-host-agent-launch-paths.test.ts` cases because this Mac has `/usr/local/bin/claude`; 2 `profile-project-domain-transfer.test.ts` cases that timed out at 30s. The roster assertion was fixed in `85be7c39f85` and that file then passed 11/11. Re-run on `85be7c39f85` (`/tmp/pr1-check2.log`, `--timeout=60`): `✗ 1 of 27 check(s) failed in 1362.7s: unit tests`. `CHECK:1`. Every other check passed. The eight failures are six `wsl-host-agent-launch-paths.test.ts` cases (this Mac has `/usr/local/bin/claude`) and two `profile-project-domain-transfer.test.ts` timeouts at 30s. Neither file is in the diff. Draft: `pr-claude-monitoring-pane-restart.md`.

### 2. pr/claude-pane-account-registry

HEAD `5446d553722` on `81011fc7f5b` on `cb595fb45e0`. Diff vs `upstream/main`: 94 files, +3765/−165.

First `check:changed --base=upstream/main` (`/tmp/pr2-check.log`, 30 min step timeout):

`✗ 3 of 28 check(s) failed in 1802.3s: oxlint, flaky-test-pattern-ratchet, unit tests`

- oxlint: `anti-slop/no-object-parameters` on `updates?: object`. Fixed in `81011fc7f5b` by naming the settings type.
- flaky-test ratchet: a new `Date.now()` and an extra `new Date()` in fixtures. Fixed in the same commit.
- unit tests: `Timed out after 30 min`. No assertion failure was printed. Not a product failure.

Re-run started on this HEAD after the mid-turn gate: `GIT_IDENTITY_ALLOW_OTHER=1 node config/scripts/check-changed.mjs --base=upstream/main --maxWorkers=2 --timeout=120`, log `/tmp/pr2-check2.log`. Result not in yet. `ClaudePaneAccountSource` includes `'pool'` (`claude-pane-account-registry.ts`). Nothing on this branch writes `source: 'pool'`. That write arrives on the pool branch. Draft: `pr-claude-pane-account-registry.md`.

### 3. pr/claude-session-mover

HEAD `54d7b14c6863` on `27a69fd505a` on `e3e6b10031b` on `ce070e32194` on `367e93d8d83` on `90b651fb3db` on `cb595fb45e0`. Diff vs `upstream/main` before the lint commit: 162 files, +9995/−225. The lint commit is 1 file, +9/−3. Tracking unset. Author Nachumi.

First gate (`/tmp/pr3-check.log`, `--timeout=60`): `✗ 3 of 28 check(s) failed in 3602.4s: changed-code quality, runtime-electron-ratchet, unit tests`. Quality casts are fixed in `ce070e32194`. The Electron import is fixed in `e3e6b10031b` (reader injected from `src/main/host/electron-system-language.ts`, bound only from `src/main/index.ts`). Unit tests hit `Timed out after 60 min` while still printing stderr.

Re-run on `e3e6b10031b` (`/tmp/pr3-check2.log`, `GIT_IDENTITY_ALLOW_OTHER=1`, `--timeout=120`): `✗ 2 of 28 check(s) failed in 4848.9s: oxlint, unit tests`. `CHECK:1`. Passed: typecheck (20.5s), changed-code quality (20.5s), format, daemon-blocking, focus-read, host-list-render, flaky-test, layout-writer, main-sync-spawn, legacy-relay-fence, memo-translate, path-literal, repo-host-read, max-lines, runtime-electron, unproven-pty-retirement, ts-nocheck, workspace-record-read, rpc params catalog, worktree-id-composer, localization coverage, localization catalogs, test file runners, localization extraction, dead design-system classes, import boundaries.

Oxlint was `anti-slop/no-reflect-apply` on `Reflect.apply(listJobs, undefined, [root])`. Replaced in `27a69fd505a`. Anti-slop and default oxlint on that file: 0 errors. The full suite was not re-run after that commit. The same patch is `078678aee0b` and `a245581feee`.

Unit failures on the re-run, left as this Mac's list:

- `runtime-failed-local-worktree-removal.test.ts`, 15 cases. `git commit -qm seed` refused author `Worktree Removal <removal@example.invalid>` even though the gate process had `GIT_IDENTITY_ALLOW_OTHER=1`. The hook only sees the variable in the `git` process environment, and these tests build their own.
- Pty flakes: `pty-claude-agent-view-readiness.test.ts` (plain shell while reconciliation is pending); `pty-runtime-hidden-at-spawn-mark.test.ts` (expected undefined to be defined); three `pty-attach-view-joins-main-start.test.ts` cases; both `pty-launch-race-parity.test.ts` lanes; `pty-hidden-at-spawn-mark.test.ts` (expected `vi.fn()` once, got 0); `pty-spawn-scaling.performance.test.ts`; `pty-pane-materialization-race.test.ts` (expected 1 call, got 0).
- `wsl-host-agent-launch-paths.test.ts`, five cases. This Mac has `/usr/local/bin/claude`, so a fixture that expects a Windows-only refusal launches that binary instead. The test file is not in the diff. `spawn-preflight.ts` only gained the account pin.
- `structured-agent-session-at-rest-command-population.test.ts`: expected 4, got 3, on the N/10N bound. The test file is not in the diff.
- `profile-project-domain-transfer.test.ts`: timed out at 30s. The test file is not in the diff.

Draft: `pr-claude-session-mover.md`.

### 4. pr/claude-auth-proxy

HEAD `81fde266a1b1` on `078678aee0b` on `991f86cc2b4`. Diff vs `upstream/main`: 187 files, +12777/−235. Tip commit is the typed `listJobs` call (1 file, +9/−3). Proxy feature commit is 60 files, +2795/−29. Default `claudeAuthProxy: false` (`=== true`, so a missing field is off). One-arg `claudeLaunchPinsAccount(claudeAccountId)` stays.

Before `991f86cc2b4`: changed-code quality, Electron ratchet, oxfmt, typecheck node+web+cli, RPC catalog, and localization catalogs/coverage/extraction passed against `upstream/main`. Husky passed on both commits. Full `check:changed` has not been run. Oxlint default, anti-slop, and the casting config are clean on the hand-off file after `078678aee0be`. Draft: `pr-claude-auth-proxy.md`.

### 5. pr/claude-account-pool

HEAD `add29910ad68` on `a245581feee` on `82f9ce675b9`. Diff vs `upstream/main`: 211 files, +14333/−258. Pool feature commit is 62 files, +1647/−114. Default `claudeAccountPool: 'off'`. Membership is `=== 'on'`. Two-arg pin. `orca account moves` is on this branch. Husky passed. Full `check:changed` has not been run. Draft: `pr-claude-account-pool.md`.

### 6. pr/claude-durable-background-jobs

HEAD `c1552b7eccf`. 35 files, +2805/−6. `check:changed --base=upstream/main --maxWorkers=2`, log `/tmp/pr6-check2.log`:

`✗ 1 of 21 check(s) failed in 259.6s: unit tests`

`CHECK:1`. The other 20 checks passed, including typecheck, format, oxlint, changed-code quality, and the ratchets. The nine failures are the macOS pty flakes listed above. Real-git fixtures did not fail. An older overwritten log (`/tmp/pr6-check.log`) had casting findings that do not reproduce on this HEAD, and a facade `realpath` mismatch (`/tmp` vs `/private/tmp`) that was not confirmed on this run. Draft: `pr-claude-durable-background-jobs.md`.

### 7. pr/plugin-accounts-api

HEAD `3733d18a3aeb` on registry `5446d553722`. Diff vs `upstream/main`: 113 files, +4809/−178. Plugin commit is 19 files, +1044/−13. `accounts.read`, `accounts.listClaudeAccounts`, events `accounts.usage.changed` and `accounts.session.moved`. Host API minor 0→1. `events:subscribe` still expands only to `workspace:read` and `agent:read`. No mover, proxy, pool, or durable-job files. Husky passed. Full `check:changed` has not been run. Draft: `pr-plugin-accounts-api.md`.

## Overlaps to keep visible

- PR1, PR2, and PR6 all touch `structured-agent-session-create-adoption.test.ts` (`resolveCommand` returns `{ command: process.execPath, prefixArgs: [] }`). PR1's `e71e24465158` has one extra line that PR3's cherry-pick `90b651fb3db` does not. After PR1 lands, drop that hunk from PR2 and PR6, and keep PR1's line when rebasing PR3.
- Root help lists auto-switch on the registry (`5446d553722`) and again inside the mover's `e3e6b10031b`. After PR2 lands, drop the duplicate hunk from the mover commit.
- The hand-off note must not import `resources/durable-jobs/*.mjs`. It `existsSync`s the path. Missing file means no detached jobs.
- Locales: missing keys in non-English catalogs are allowed. Extra keys that are not in `en.json` fail. Pool keys were added to es/fr/ja/ko/pt/zh only for the six `accounts.claude.pool` strings. Do not copy those catalogs wholesale.
- Docs on each `pr/*` branch stop at that step. The pool branch's `docs/reference/claude-accounts.md` does not describe durable jobs.
