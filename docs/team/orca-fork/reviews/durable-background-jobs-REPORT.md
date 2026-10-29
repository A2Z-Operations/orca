# Durable background jobs

Date: 2026-10-29. Claude Code **2.1.312**. Host: this MacBook. Branch: `nachumi-a2zoperations/durable-bg-jobs-survive` (off `blowzer/session-mover`).

Implementation commit: `db81938beb56c9251ef752551527e186a2318495`.

## Recommendation

Option A. A Claude Code PreToolUse command hook rewrites `Bash` when `run_in_background` is true. The command Claude actually runs is a waiter. The waiter starts the user's shell in a new session and tails a log file. The shell is reparented to pid 1, so killing Claude does not kill it.

Option B, a new orcad `orca job` RPC, is not in this prototype. The registry is a directory of files. The same machine can list those jobs after resume without a protocol bump. A daemon RPC is the follow-up if a remote client has to see the jobs.

`orca terminal create` is the wrong owner. That path is a visible PTY, and the session mover stops the old PTY by id. The descendant sweep walks ancestry and process group. A pid-1 session leader is outside that sweep.

## What landed

- `src/main/claude/durable-background-job.mjs` — job directory, detach, follow, list, stop. Job ids are `dj_` plus 16 hex characters. On macOS the default root is `~/Library/Application Support/orca/durable-jobs/<id>`. `ORCA_DURABLE_JOB_ROOT` overrides it. `ORCA_DURABLE_JOBS=0` makes the planner return null.
- `src/main/claude/durable-background-job-hook.mjs` — reads the hook event on stdin, writes `request.json` only, prints `hookSpecificOutput.updatedInput`. It does not set `permissionDecision`. The job starts only if Claude then runs the rewritten command.
- `src/main/claude/durable-background-job-plugin.ts` — copies those two scripts into `<userData>/claude-durable-jobs/<content-hash>/orca-durable-jobs` and writes `hooks/hooks.json` (PreToolUse, matcher `Bash`, timeout 15). A failure to write returns undefined.
- PTY host env appends that plugin dir to `CLAUDE_CODE_PLUGIN_DIRS` only for a Claude launch that is not Windows, not WSL, and not `ORCA_DURABLE_JOBS=0`. The spawn path adds a second `--plugin-dir` when there is no remote connection. Non-Claude launches only strip a stale `ORCA_DURABLE_JOB_PLUGIN_DIR`.
- Local `orca job list|status|logs|stop|start`. The CLI dynamically imports the `.mjs` runner. It does not call the runtime client. The installed `/Applications/Orca.app` binary does not grow this command until this branch is built.

The rewritten command is `node <runner> run --id <id>`. The waiter's first stdout line is `orca-durable-job id=… log=…`. It then copies the log and exits with the job's code. Claude's own background bookkeeping consumes that stream. The user's command is stored as `command.sh` and run as `bash command.sh`, so an `exit` inside the command still writes the exit file.

The hook's shebang is `#!/usr/bin/env node`. `updatedInput` quotes `process.execPath` of that node. It does not quote Electron's exec path.

## Evidence

Unit tests, after the realpath fix for macOS `/var` versus `/private/var`:

- `src/main/claude/durable-background-job.test.ts` — 14 passed, including rewrite shape, no `permissionDecision`, foreground no-op, `ORCA_DURABLE_JOBS=0`, win32 no-op, and a POSIX case whose bash is PPID 1 and PGID == pid, stays PPID 1 after the waiter is SIGKILLed, then `stopJob`.
- `src/main/ipc/pty/host-env/durable-background-job.test.ts` — 7 passed. Claude launches install the plugin. Codex, WSL, `ORCA_DURABLE_JOBS=0`, and an unwritable user-data path do not.
- `src/cli/handlers/job.test.ts` — 3 passed.
- `src/cli/handler-group-manifest.test.ts` — 6 passed.

30 tests, 4 files. Typecheck of `config/tsconfig.node.json` and `config/tsconfig.tc.cli.json` exited 0. This environment's `corepack pnpm` shim is broken (`MODULE_NOT_FOUND` / `ENOEXEC` on the 12.14.0 shim). The runs used `node` on `/Users/nachumieliyahu/Library/pnpm/.tools/pnpm/12.14.0/node_modules/pnpm/bin/pnpm.mjs`.

Live Claude Code 2.1.312, `--dangerously-skip-permissions`, `--permission-mode bypassPermissions`, `--plugin-dir` pointed at a temp copy of the plugin, `ORCA_DURABLE_JOB_ROOT` under `/tmp/orca-durable-e2e`. No `CLAUDE_CONFIG_DIR` override. cwd was a temp directory, not this repo.

Smoke (`sleep 20 && echo SMOKE_OK`, session `ea5a0baa-7220-4cf1-bb9b-c1d753014a1e`, job `dj_3fa863d93f2edf42`). Debug log shows the plugin hook returning `updatedInput`, and Claude's tool result still saying the command was running in the background (`bwm7ft6o8`). Claude's task file ended with:

```
orca-durable-job id=dj_3fa863d93f2edf42 log=/tmp/orca-durable-e2e/jobs/dj_3fa863d93f2edf42/output.log
SMOKE_OK

[exited with code 0]
```

The job's own `exit` file was `0`. So Claude's background task bookkeeping accepts the waiter: it tails stdout and records the waiter's exit code.

Two-minute proof (`sleep 120 && echo DURABLE_OK_TOKEN`, session `e35bc66f-cd50-4124-bffe-4a80cc1ce07a`, job `dj_f3e8c73dafaf1d14`):

| UTC | What |
| --- | --- |
| 10:10:33 | `meta.json` pid 60512. `ps` showed PPID 1, PGID 60512, session 0, state `Ss` (session leader). |
| 10:10:36 | Stream contained `LAUNCHED`. Claude pid 59913 was SIGTERM'd and exited. |
| 10:10:38 | pid 60512 still PPID 1, same PGID. |
| 10:12:35 | `output.log` was `DURABLE_OK_TOKEN`, `exit` was `0`, the process was gone. |

`claude -p --resume e35bc66f-cd50-4124-bffe-4a80cc1ce07a` from the same cwd, same plugin dir, replied with exactly:

```
dj_f3e8c73dafaf1d14
DURABLE_OK_TOKEN
```

The id is in the session transcript as PreToolUse `hook_additional_context`, not only in the job directory. The model found it there and read the log after the restart. Resume cost on this run was about $0.06. The first smoke loaded the user's MCP servers and was much more expensive; the proof used `--strict-mcp-config` with an empty MCP file.

Claude is not a subreaper for this job on this Mac. The detached bash's parent was pid 1 while Claude was still alive, and it stayed pid 1 after Claude exited.

## Trade-offs

**Sandbox and permissions.** The hook does not allow the tool. Claude applies permission checks to the updated input, so an allow rule like `Bash(sleep *)` does not match the node waiter and can prompt. The prototype skipped permissions on purpose. Orca sessions that are not in bypass mode will prompt until the waiter command is allowed. The hook runs outside the tool sandbox. The job is spawned by the waiter, which runs inside Claude's bash, so a macOS seatbelt on that bash can still wrap the child. This proof did not turn Claude's sandbox on (no sandbox key in `~/.claude/settings.json`). Survival here is escaping the process tree. If `setsid` or the detach spawn fails, the waiter prints `detach failed, running in this process` and runs the command inline. That fallback dies with Claude.

**cwd and env.** The waiter records `ORCA_DURABLE_JOB_CWD` as its own cwd at execution, which is Claude's tool cwd. The hook also stores an absolute hook-time cwd and `session_id` on `request.json` when Claude sends them. The proof cwd was `/private/tmp/orca-durable-e2e/proof-work`. The environment is not written to disk. The detached process inherits the waiter's environment at spawn. `request.json` holds the command text, description, timestamps, optional session id, and optional cwd.

**Windows and WSL.** Out of scope. The planner returns null on `win32`. The plugin is not injected for `win32`, `opts.isWsl`, or `ORCA_DURABLE_JOBS=0`. The runner throws on Windows. No WSL detach path was attempted.

**Cleanup.** A hook that writes `request.json` and then never runs (the user denies the tool) leaves a `pending` directory. Exited jobs stay on disk. There is no TTL. Each plugin build uses a content hash, so old copies under `claude-durable-jobs/` are left behind. `orca job stop <id>` signals the negative pid (the job's process group) and refuses pid <= 1. A kill that lands before the exit file is written leaves state `lost`, which the unit test observes. Nothing in this change sweeps orphans.

**Session-mover hand-off.** Not edited here. That note is the other brief. `formatSurvivingJobNote` is the text to append, after filtering `listJobs()` to the dying session's id (stored on `request.json`):

- `No detached Orca jobs were still running.`
- `Detached Orca jobs still running after this restart: dj_… log=…; …`

The mover's current sentence says the restart ended background jobs. That stays true for ordinary children and for the Monitor tool. It is false for bash commands this hook detached. The hand-off worker should call `formatSurvivingJobNote` rather than hard-coding the old sentence.

**TaskStop and Monitor.** The waiter is the process Claude tracks. The job has its own process group, and the waiter does not forward signals, so TaskStop on the background task stops the tail and leaves the job running. Stop it with `orca job stop <id>`. The Monitor tool is not rewritten. Those tasks still die with Claude.

**Packaged app.** `ensureDurableBackgroundJobPlugin` reads the `.mjs` sources from the repo layout. If those files are absent, injection is skipped and Claude's background jobs behave as they do today. Shipping this in `/Applications/Orca.app` means the installer has to include the two scripts, or the plugin writer has to be pointed at them.

## Left

Wire `formatSurvivingJobNote` into the mover hand-off (separate task). Decide whether TaskStop should grow a real stop path. Add a sweeper for `pending` requests and old hash plugin dirs. Cover the Monitor tool, Windows, and WSL only if those hosts need the same guarantee. A daemon RPC is optional and was not required to resume on this Mac.
