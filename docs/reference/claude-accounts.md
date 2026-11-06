# Claude accounts

Orca can keep more than one Claude account on a machine, start a session on a chosen account, and move work before a usage limit. Automatic switch, the session mover's automatic move, the auth proxy, and the account pool are off until you turn them on. The session mover's default is **ask**. On a headless host, **ask** acts as **move**, because nobody can answer a prompt.

## Accounts

`orca account add` runs `claude login` in the terminal and registers the account with the local runtime. `orca account list` prints the accounts on this machine. `--agent` defaults to `claude`. Adding a second account is a second sign-in; a private browser window keeps the first login in place.

The selected account is what a new Claude launch uses when the pool is off. System Default is the login already in `~/.claude`, not a copy Orca made.

## Usage lines

Automatic switch and the session mover share the same lines:

- 5-hour window: 95%
- weekly window: 90%
- Fable weekly window: 90%

Orca only moves or switches toward an account that has clearly more room left.

## Automatic switch

Setting: **Settings → Accounts → Claude → Switch accounts before a usage limit**. Default **off**.

CLI:

```sh
orca account auto-switch --agent claude --on
orca account auto-switch --agent claude --off
orca account auto-switch --agent claude --status
```

`--status` changes nothing. It prints the setting, the selected account, and how many accounts have a usage reading and how many are at a line.

When the selected account passes a line, the next Claude you start uses the account with the most room left. Sessions that are already running are not moved by this setting. They follow **When you switch accounts while Claude is running** (ask, always restart, or never restart), the same as a switch by hand.

`--environment <selector>` writes the setting on that paired Orca server. The server then rotates its own accounts.

## Session mover

Setting: **Settings → Accounts → Claude → Move running sessions before a usage limit**. Default **ask**.

| Value  | Desktop                                                               | Headless        |
| ------ | --------------------------------------------------------------------- | --------------- |
| `off`  | Never move a running session                                          | Never           |
| `ask`  | Show a notice. Do not move until the setting is `move`                | Treat as `move` |
| `move` | Between turns, resume the same pane on the account with the most room | Same            |

CLI:

```sh
orca account session-mover --agent claude --off
orca account session-mover --agent claude --ask
orca account session-mover --agent claude --move
orca account session-mover --agent claude --status
orca account moves
orca account moves --json
orca account moves --log --since 2026-11-05T06:00:00Z
```

`--status` prints the setting, live sessions by strategy, the last decisions counted by reason, and model flips.

A session that stays records why: `under-line`, `no-target` (no account has more room), `cooldown`, `failed-recently`, `prompt-cache` (a proxy session whose turn just ended), `no-usage`, `off`, or `pinned`. A wait is `wait:mid-turn`, `wait:no-status`, or `wait:background-work`.

`--log` reads the durable account log, `account-moves.log` in the Orca logs folder (ndjson, rotated at 10 MB, three files kept). It holds every change of a pane's decision, every settled move, each model flip, and auth-proxy requests on an unknown slot and upstream errors (status, method, path, account). It never holds tokens, headers, or bodies. Repeated proxy rows fold for a minute and carry a count.

Settings › Accounts › Claude › Recent moves shows the same history as a table: when, the session's tab and workspace, the account, the model on a flip, the decision in words, and whether it went through the proxy or a restart. Stays from one tick fold into one line. Filters: All, Moves, Flips, Stays, a search box, and the Accounts strip above the table (each account's 5-hour, weekly, and Fable usage). "Load older" reads the log.

`orca account moves` reads `claude.sessionMoves` from the runtime that owns the sessions. Each line is the time, the pane (or the pty when the pane key is absent), from, to, the reason, and the strategy (`resume` or `proxy`). A host that predates strategies prints `-`.

A move resumes the conversation in the same pane, or keeps the process and changes the account through the auth proxy when that proxy is on. The hand-off note tells the continued session what changed: which account it left, which subagents the restart ended, and which background work was still running.

Failure: the notice names the account and the detail (`accounts.claude.sessionMover.failedBody`). A session whose account is no longer saved, or a WSL account asked to run where WSL cannot, asks you to choose another account. The mover does not invent a destination when no other account has more room.

## Auth proxy

Setting: **Settings → Accounts → Claude → Bill Claude through a local auth proxy**. Default **off**. An absent value is off. Only an explicit on turns it on.

CLI:

```sh
orca account auth-proxy --agent claude --on
orca account auth-proxy --agent claude --off
orca account auth-proxy --agent claude --status
```

On: each Claude pane talks to a loopback proxy. The proxy sets the bearer for the account assigned to that pane, so a later request can use another account without restarting the process. Off: launches use `CLAUDE_CONFIG_DIR` only.

A user-set `ANTHROPIC_BASE_URL` is left unchanged. Orca does not replace that URL with the proxy, and it says so once. `--status` prints the live listener (port, slot, account, requests in the last hour, last error) and does not change the setting. A `!` marks requests from an unknown slot and an upstream error within the last hour; the Settings row shows the same two facts and turns amber.

Restart: pane rows and the listener's port are kept in `claude-pane-accounts.json` under the app data folder. When Orca restarts while a Claude pane keeps running, the listener asks for its previous port and re-registers the slot that pane still carries, so the pane keeps billing through the proxy and the next move needs no restart. If the port is taken, the pane resumes on its next move instead.

## Account pool

Setting: **Settings → Accounts → Claude → Spread sessions across accounts**. Default **off**.

CLI:

```sh
orca account pool --agent claude --on
orca account pool --agent claude --off
```

On: a new Claude session starts on the signed-in account with the most room left. Off: launches use the selected account. `orca account list` shows `pool: on|off` and a session count on each account. The selected account stays what non-pooled launches and the status bar show. `orca account pool --agent claude --status` prints the live sessions billed to each account.

## Usage readings

```sh
orca account usage --agent claude
orca account usage --agent claude --json
```

Each managed account's last reading: 5-hour, weekly, and Fable-weekly percent, how old it is, and whether it is the selected account's reading or the inactive-account cache. It does not start a fetch.

## Model policy and fixed-model sessions

A session launched with `--model` or `ANTHROPIC_MODEL` keeps its model. `orca account model-policy --agent claude --set covers-explicit=on` (Settings: "Also switch sessions launched with a fixed model", setting `claudeModelPolicyCoversExplicit`, default off) lets the policy switch such a session too when it runs Fable or Opus, and take over one that recorded no model. Another model, such as Sonnet, is never switched.

## Durable background jobs

A Claude background bash command dies when Claude's process dies. Orca's durable-job plugin rewrites that tool call so the command keeps running across a session restart.

Orca copies three scripts into the app user-data directory and points Claude at that plugin on a Claude launch. The hook runs before `Bash`. It only rewrites a call whose `run_in_background` is true. The command Claude then runs is a waiter. The waiter starts the shell in a new session and tails a log. On macOS and Linux the shell's parent becomes pid 1. On Windows the launch is a hidden PowerShell script. A WSL guest uses `setsid` inside the guest. `ORCA_DURABLE_JOBS=0` turns the rewrite off and Orca does not inject the plugin.

The scripts live in `resources/durable-jobs/` and are shipped beside the app, not inside the archive, because system node runs the copy. That copy has no workspace packages.

Jobs are files under the durable-job root (`~/Library/Application Support/orca/durable-jobs` on macOS, `~/.orca/durable-jobs` elsewhere, or `ORCA_DURABLE_JOB_ROOT`). Ids look like `dj_` plus 16 hex characters.

CLI, on the machine that holds the files:

```sh
orca job list
orca job status --id <id>
orca job logs --id <id>
orca job stop --id <id>
orca job start --id <id>
```

Failure modes:

- The hook does not grant permission. Claude still checks the rewritten command. An allow rule that matched the original shell may not match the waiter, so Claude can prompt until the waiter is allowed.
- If detach fails on macOS or Linux, the waiter says so and runs the command in its own process. That fallback dies with Claude.
- A denied tool can leave a pending job directory. Exited jobs stay on disk until they age out.
- `orca job stop` signals the job's process group and refuses pid 1 and below. A stop that lands before the exit file is written leaves the job lost.
- The environment is the waiter's environment at spawn. It is not written next to the command. The command text is.

## Where this is idle

| Setting          | Default                | Headless                         |
| ---------------- | ---------------------- | -------------------------------- |
| Automatic switch | off                    | off                              |
| Session mover    | ask                    | ask acts as move                 |
| Auth proxy       | off                    | off                              |
| Account pool     | off                    | off                              |
| Durable jobs     | on for Claude launches | on, unless `ORCA_DURABLE_JOBS=0` |
