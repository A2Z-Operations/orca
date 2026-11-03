# Task 10 — full suites, typecheck, lint, build and sign `1.4.244-blowzer.2` (leader-run, 2026-10-28 21:03–21:13Z)

The Codex lane hit its usage limit (meni@sabrent.com, resets Nov 3) right after the Task 10 dispatch, so the leader ran the plan's seven steps as a script (`scratchpad/task10-build.sh`, log `task10.log`). Branch `blowzer/session-mover`, head `2ba5e240f5`, tree clean.

| Step | Result |
|---|---|
| 1 suites (plan line 3617) | `Test Files 11 failed / 1795 passed / 28 skipped (1834)`, `Tests 24 failed / 20621 passed / 1 expected fail / 802 skipped (21448)` — all 24 failures attributed below, none to the mover |
| 2 typecheck node / cli / web + verify:rpc-params-catalog + the three localization verifiers | all exit 0, 0 `error TS` |
| 3 oxlint ×2, oxfmt --check, max-lines ratchet on `blowzer/auto-switch...HEAD` | all exit 0 |
| 4 build:desktop, computer/keyboard/notification/process-footprint helpers, ensure:electron-runtime | all exit 0 |
| 5 electron-builder --mac --arm64, signed `Apple Development: nachumi Eliyahu (BDK84XWD78)`, ORCA_NO_PUBLISH=1 | exit 1 = the refused darwin/x64 pass (expected); arm64 artefacts complete |
| 6 verify | `codesign --verify --deep --strict` ok; plist `1.4.244-blowzer.2`; no `app-update.yml`; `dist/Orca-1.4.244-blowzer.2-arm64-mac.zip` 254,493,534 bytes, sha256 `1fdfaf15f77373d2c4aafa155ae2acadaf5eeca765de932403442c9f40039de8`; asar grep `claude-session-mover` / `setClaudeSessionMover` / `claudeAccountId` / `replacesPtyId` = true ×4 |
| 7 branch | 19 commits on top of `blowzer/auto-switch`, `no trailers`, already pushed (local = origin) |

## Attribution of the 24 suite failures (2026-10-28 21:5xZ, leader-verified)

| Group | Tests | Files | Proof it is not ours |
|---|---|---|---|
| This Mac's global `commit-msg` identity hook refuses the real-git fixtures' `git commit` as `Orca Test <…>` / `Test <…>` | 10 | `src/shared/git-branch-cleanup-real-git.test.ts` (7), `src/main/ipc/pty/ipc/spawn-push-target-materialization-real-git.test.ts` (2), `src/shared/git-change-list.test.ts` (1) | all pass with the hook's documented exception `GIT_IDENTITY_ALLOW_OTHER=1` (3 files / 14 tests) |
| macOS `$TMPDIR` is a `/var/folders/…` symlink; the test expects the canonical `/private/var/…` form | 4 | `src/main/orcad/orcad-forked-child-paths.test.ts` | passes with `TMPDIR=$(realpath $TMPDIR)/` (5/5) |
| Upstream's own failures at v1.4.243 in this environment | 10 (9 in isolation; one `pty-launch-race-parity` case is a load flake) | `src/main/ipc/pty-attach-view-joins-main-start.test.ts` (3), `pty-claude-agent-view-readiness.test.ts`, `pty-spawn-scaling.performance.test.ts`, `src/main/ipc/pty/pty-hidden-at-spawn-mark.test.ts`, `pty-launch-race-parity.test.ts`, `pty-pane-materialization-race.test.ts`, `pty-runtime-hidden-at-spawn-mark.test.ts` | the test files are byte-identical to a880c7b912; the same 9 fail identically on a clean worktree of a880c7b912 (no mover) AND of the pristine `v1.4.243` tag (7 files, 9 failed / 67 passed each time) |

The mover's own suites (claude-accounts 334, rate-limits 888, orcad 735, the 7 mover test files, CLI/RPC 107) are green; see the task reports.

# Task 11 — rehearsal, Studio half (21:2xZ)

- Installed under the stopped service: `new build: 1.4.244-blowzer.2 (current 1.4.244-blowzer.1)`, codesign ok, no app-update.yml, previous kept as `/Applications/Orca.app.bak-1.4.244-blowzer.1`, service live; from the MacBook `orca --environment macstudio status` → `state ready, reachable, appVersion 1.4.244-blowzer.2, remoteUpdateSupport.reason updater-unavailable`.
- `orca account session-mover --agent claude --move` (run on the Studio: the MacBook's CLI is still 1.4.231) → `Claude session-mover: move`; `--json` → `{"sessionMover":"move"}`; `orca account list` shows `auto-switch: on` and `session-mover: move`; JSON `sessionMoves: []`, `inactive: []`.
- NOT rehearsed: the move itself (plan steps 3–4). The Studio has ONE signed-in managed Claude account (sam@sabrent.com); the other five read `sign in again in Orca Settings > AI Provider Accounts`, so there is no second account to move to and nothing inactive to read. Owner step: re-sign-in the Studio accounts (from the MacBook once it runs 1.4.244-blowzer.2: Settings → AI Provider Accounts on the paired server, upstream #31461), then repeat steps 3–4.
- NOT done: the MacBook install (owner, plain terminal): `~/Documents/claude/BLOWzer/scripts/orca-fork/macbook-install.sh ~/Documents/claude/orca-fork/dist/Orca-1.4.244-blowzer.2-arm64-mac.zip`, then `orca account session-mover --agent claude --move`.
- Rollback: Studio `/Applications/Orca.app.bak-1.4.244-blowzer.1` (mover-less, auto-switch only) and `.bak-1.4.236-blowzer.1`; mover off = `orca account session-mover --agent claude --off`.
