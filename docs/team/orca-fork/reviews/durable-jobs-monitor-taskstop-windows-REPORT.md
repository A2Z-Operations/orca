# Durable jobs — Monitor, TaskStop, Windows/WSL

Date: 2026-10-29. Worktree off `blowzer/session-mover` (`a9d2f353274`). Not pushed.

Prior reports: `durable-background-jobs-REPORT.md`, `durable-background-jobs-FOLLOWUP.md`.

## Monitor

Left unre-written. The PreToolUse matcher stays `Bash` only.

On Claude Code 2.1.312 the tool name is `Monitor`. The input is `description`, `timeout_ms`, and `persistent`, plus exactly one of `command` or `ws`. `backgrounding` is `never`. A command watch streams each stdout line as a live session event and ends when the command exits, the timeout fires, TaskStop runs, or the session ends. A `ws` watch has no shell. Rewriting `command` to the waiter would turn the waiter's banner into fake monitor events, sandbox-check the waiter instead of the user command, and either kill the job at Claude's deadline or ignore the deadline the tool promised. A restarted session does not re-subscribe. Background Bash (a command plus an exit log) is the durable product. This was read from the 2.1.312 tool schema and bundle, not from a live Monitor call.

## Permission

The rewritten waiter is the only input that gets `permissionDecision: "allow"`, with reason "Orca rewrote this background command to the durable waiter." `updatedInput` is still the waiter command `orca-durable-job run --id dj_<16 hex>`, `run_in_background: true`.

The one-line settings allow pattern, already exported as `DURABLE_JOB_ALLOW_RULE`:

```
Bash(orca-durable-job run --id:*)
```

Claude Code 2.1.312 accepts `permissionDecision: "allow"` together with `updatedInput` when the hook matcher is the exact tool name `Bash`. A `throughFamilyOnly` matcher wipes `updatedInput` and ignores allow, so the matcher must stay `Bash`. The earlier follow-up left the field unset because that pair had not been re-proved after issues 81340 and 79321. The 2.1.312 bundle now keeps `updatedInput` when the decision is allow. This was not re-run inside a live Claude session. The prototype already showed `updatedInput` works when the field is absent.

## TaskStop

The waiter, after it has a job directory, handles `SIGTERM` and `SIGINT`. It writes `cancel` into the job dir, signals the recorded pid the same way `orca job stop` does, and exits 143 or 130. The detach helper stays signal-deaf and, if `cancel` exists, does not leave a new process running.

On macOS and Linux that signal is `process.kill(-pid, SIGTERM|SIGINT)`, then the pid itself if the group signal fails. Pid 1 and below are refused. `SIGHUP` and `SIGKILL` are not forwarded. Darwin tests cover all three: `SIGKILL` and `SIGHUP` leave the job running (then `stopJob` ends it); `SIGTERM` makes the waiter exit 143 and the job `lost`, because the group dies before `exit` is written. `orca job stop` remains the explicit path and uses that same signal.

On Windows the same stop plan is `taskkill.exe /PID <pid> /T /F` via async `spawn` + `unref` (not `spawnSync`). There is no negative process group. `/T` without `/F` is only `WM_CLOSE`, which console processes ignore. Not run on a Windows machine.

Residual: a Claude shutdown that delivers `SIGTERM` to background waiters, the same signal TaskStop uses, will now stop the job too. `SIGHUP` (session death of the waiter) and `SIGKILL` still leave it running. A setsid child is not in the waiter's group, so signaling Claude's session leader does not by itself signal the job.

## Windows detach

`planBackgroundBashRewrite` no longer returns null on `win32`. The product still stays off when `ORCA_DURABLE_JOBS=0`.

`detachLaunchPlan({ platform })` is what tests assert, per platform, without spawning:

- darwin and linux: `spawn('/bin/bash', ['-c', script], { detached: true })`, same as before. Node `detached` is `setsid`.
- win32: write `command.sh` (the user command) and `runner.sh` (cd, run that file, append the log, write `exit`). `launch.ps1` only runs `powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -File <launch.ps1>`, which runs `bash` on `runner.sh`. No `-ExecutionPolicy`, no `-EncodedCommand`, no `cmd.exe /c` of the user text. `detached: true` plus `windowsHide: true` is the breakaway (`CREATE_NEW_PROCESS_GROUP | DETACHED_PROCESS | CREATE_BREAKAWAY_FROM_JOB`). A Win32 Job Object is not created from PowerShell (`Add-Type` is an EDR trip). If `bash` is missing, the launcher writes exit 127.

The host injects the plugin for a Windows Claude launch. The waiter in `bin/` is a bash script (`exec node '<runner>' "$@"`) plus `orca-durable-job.cmd` for `PATHEXT`, not a symlink. `invokedDirectly()` still requires the real `durable-background-job.mjs` filename, so the launcher execs that file. macOS keeps the symlink. Live spawn tests stay `skipIf` the process is not that OS. This machine is darwin, so the Windows spawn was not executed.

## WSL

Inside a Linux guest (`WSL_DISTRO_NAME` or `WSL_INTEROP`), detach uses `setsid bash -c <script>` with Node `detached: false`. `setsid` without `--fork` execs bash and keeps the pid, so the recorded pid is the session leader. Node `detached` plus `setsid` would call `setsid()` twice and fail with `EPERM`. The detach helper waits until `/proc/<pid>/stat` shows the process group equals the pid (up to 1s) before it exits. If `/usr/bin/setsid` and `/bin/setsid` are missing, it falls back to Node `detached` bash. Not executed inside a guest.

The host no longer skips `opts.isWsl`. It publishes `claude-durable-jobs/<hash>/orca-durable-jobs-wsl`, whose `hooks.json` command is `node '<toLinuxPath(hook)>'` and whose matcher is still `Bash`. Scripts are not copied a second time. `bin-wsl/orca-durable-job` execs `node` on the linux path of the real runner (`/mnt/<drive>/...` on a Windows host). `PATH` gets that bin directory prepended and is not added to `WSLENV`. Default `appendWindowsPath` translates it into the guest. A distro with `appendWindowsPath=false` will not find the waiter. That is the same class of failure as the login-shell `PATH` note in the follow-up.

`addOrcaWslInteropEnv` now passes `CLAUDE_CODE_PLUGIN_DIRS` (`/pl`, or `/u` when the value already starts with `/`) and `ORCA_DURABLE_JOB_PLUGIN_DIR` (`/p` or `/u`) when those variables are set. Without that, `wsl.exe` never shows the guest the plugin dir. This file is outside the task's owned list. Task 5 owns the broader proxy/WSL work. The edit is additive and does not put `PATH` in `WSLENV`. UNC copies inside the guest stay with `wslHookRelayManager`.

## Layout

`durable-background-job-plan.mjs` holds the pure rewrite, launch plan, and stop plan so the runner stays under the `.mjs` line cap. It does not import `child_process` (the process-host baseline is unchanged). The plugin, the Rollup asset emit, and `extraResources` copy it next to the runner and the hook. The installed hook directory imports it by relative path.

## Checks

`/tmp/pnpm-bin/pnpm exec vitest run --config config/vitest.config.ts` on the durable-job tests, the WSL env tests, `src/cli/handlers/job.test.ts`, the session-move handoff test, and `config/scripts/electron-builder-config.test.mjs`: 94 passed, 1 skipped. `typecheck:node` passed. Not run: `typecheck:web`, `typecheck:cli`, a Windows host, a WSL guest, a live Claude session.

## Left

- Prove `permissionDecision: allow` plus `updatedInput` inside a live Claude 2.1.312 session.
- Run the powershell detach and `taskkill /T /F` on Windows, and `setsid` inside a WSL guest.
- Distros with `appendWindowsPath=false` still need a guest-visible waiter on `PATH`.
- A shutdown that `SIGTERM`s the waiter stops the job. `orca job stop` is the explicit stop. Monitor stays a live subscription.
