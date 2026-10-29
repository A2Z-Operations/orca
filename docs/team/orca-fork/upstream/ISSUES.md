# Upstream issues for the PR ladder

Do not post these. Task 13 is the text only. Upload videos with the `gh image` extension or by dragging the file onto the issue. Never commit the video.

Post issues 1–3 together. Post issues 4–7 only after 1–3 are merged, or at least acknowledged by a maintainer. One issue per pull request. The paste-ready body is under **Body** in each section. Leave the coordinator notes out of GitHub.

Searched 2026-10-29, read-only, against `stablyai/orca`:

- `gh issue list -R stablyai/orca --limit 30`
- `gh issue list --search` for `account switch`, `usage limit`, `claude account`, `session restart claude`, `auth proxy`, `background bash`
- `gh pr list --search` for `claude account`, `usage limit`, `restart session`
- Five issues that a merged PR closed, for tone: [#32355](https://github.com/stablyai/orca/issues/32355), [#34390](https://github.com/stablyai/orca/issues/34390), [#35217](https://github.com/stablyai/orca/issues/35217), [#30237](https://github.com/stablyai/orca/issues/30237), [#20434](https://github.com/stablyai/orca/issues/20434)

Those five lead with what the user was doing, then a numbered repro, then what should have happened, then the version. Bug form fields are Operating system, Orca version, Details. Feature form fields are Problem, Proposed solution, Alternatives. The bodies below follow that.

Stock behavior was checked on tag `v1.4.243` (`9548f132485`). None of `claude-pane-account-registry`, `claude-session-mover`, `claude-auth-proxy`, `claudeAccountPool`, or `durable-jobs` exist there. Usage polling starts from the desktop window (`src/main/startup/main-window-core-services.ts` calls `rateLimits.start`). `isClaudePaneMidTurn` is `agentType === 'claude' && state !== 'done'`.

## Duplicate pre-check

Nothing already open is this ladder. The closest items, and why these drafts stay separate:

| Existing | What it asks | Why this ladder does not reuse it |
| --- | --- | --- |
| [#34422](https://github.com/stablyai/orca/issues/34422), [#29999](https://github.com/stablyai/orca/issues/29999) | Make an account switch reach every running session without a restart, the way shared credentials did before v1.4.225. | Issue 4 is narrower and off by default. One pane's next request is billed to another account through a local proxy. Credentials stay in per-account homes. It does not bring back one shared login. |
| [#31476](https://github.com/stablyai/orca/issues/31476) | On a headless host, an external watcher calls `accounts.selectClaude` and wants running sessions to follow, plus a usage-limit event. | Issue 3 moves one session between turns before the limit, onto the account with the most room. It does not change what `accounts.selectClaude` does to every pane. |
| [#33551](https://github.com/stablyai/orca/issues/33551) | Always-restart skipped panes that were not on the previous selected account, and after an update none of the candidates restarted. | Issue 1 is the pane that is only monitoring a background task. The dialog already lists it and then waits forever, because monitoring counts as mid-turn. |
| [#34515](https://github.com/stablyai/orca/issues/34515), [PR #34516](https://github.com/stablyai/orca/pull/34516) | A queued restart stops a pane that still has subagents, an unfinished dispatch, or an unsent draft. | Issue 1 is the opposite stall (never restarts). Issue 3 waits up to 10 minutes while a background command is alive, then resumes. It does not claim to fix #34515. |
| [#34690](https://github.com/stablyai/orca/issues/34690) | A restart drops `--dangerously-skip-permissions`. | Out of scope. The resume in issue 3 must not be described as fixing permission flags. |
| [#19900](https://github.com/stablyai/orca/issues/19900), [#28683](https://github.com/stablyai/orca/issues/28683) | A switch does not reach a running session. Codex has a pane registry; Claude does not. #28683 asks for a per-agent "keep on this account" pin. | Issue 2 adds the Claude pane record and files usage on that account. It does not add a pin, and it does not by itself move the process. |
| [#34201](https://github.com/stablyai/orca/issues/34201) | The usage popover shows one account's numbers under another account's email (reported on 1.4.224). | Issue 2 is the missing pane record that lets a live reading land on the selected account. Link #34201. Do not close it from issue 2. |
| [#23414](https://github.com/stablyai/orca/issues/23414) | `orca account list` usage lags, and a pane stays "working" while only a background shell runs. | The second sentence is the same status issue 1 keys off. #23414 asks for fresher numbers and a calmer status. Issue 1 asks for the restart to proceed once the main agent is idle. |
| [#33138](https://github.com/stablyai/orca/issues/33138), [PR #33139](https://github.com/stablyai/orca/pull/33139) | `orca account usage` for scripts. | Not this ladder. Headless polling in issue 2 feeds Orca's own decision. It does not add that command. |
| [#35497](https://github.com/stablyai/orca/issues/35497) | Keep Claude's `rate_limit_event` instead of polling. | Not this ladder. Say so if a reviewer asks why usage still comes from the poller. |
| [#28044](https://github.com/stablyai/orca/pull/28044), [#33193](https://github.com/stablyai/orca/issues/33193), [#20512](https://github.com/stablyai/orca/issues/20512) | Switch the selected account before a limit (#28044), then switch back by priority (#33193), or fail over when rate-limited (#20512). | No eighth issue. #28044 is the next launch. Issue 3 is a session that is already running. Do not file the fork's auto-switch as a new issue while #28044 is open. |
| [#34488](https://github.com/stablyai/orca/issues/34488), [PR #34489](https://github.com/stablyai/orca/pull/34489) | Account switch skips Agent Teams panes and drops Teams mode. | Out of scope. |
| Plugin issues [#23903](https://github.com/stablyai/orca/issues/23903), [#23143](https://github.com/stablyai/orca/issues/23143), [#19809](https://github.com/stablyai/orca/issues/19809) | Task providers and status-bar slots. | Issue 7 is a read-only Claude account list and two events. No tokens. |

## Issue 1 — `pr/claude-monitoring-pane-restart`

**Title:** `[Bug]: A Claude pane that is only monitoring a background task never restarts on account switch`

**Video:** before `B1`, after `A1`.

### Body

### Operating system

macOS

### Orca version

1.4.243

### Details

**Short summary**

I switch Claude accounts while one pane is back at its prompt and only watching a background command. Orca restarts the idle panes and never restarts that one. It stays on the old account until I kill it. The switch dialog already says busy sessions wait for idle. This pane is idle. The main agent is done. Only the background watch is left.

**What happened**

Settings → AI Provider Accounts → **When you switch accounts while Claude is running** is **Always restart**. The idle pane restarts and continues on the new account. The monitoring pane stays **Working**. Its restart stays queued. Further prompts in that pane still bill the old account. After that account is out of usage, those prompts stop, even though the status bar shows the new account with room left.

On v1.4.243, `isClaudePaneMidTurn` in `src/renderer/src/lib/claude-session-account-move.ts` is true for every Claude pane whose `state` is not `done`. It never reads `mainAgent.state`. `pane-account-restart-readiness.ts` will not restart the pane while that function is true. A pane with `state: working`, `workingMode: monitoring`, and `mainAgent.state: done` therefore waits forever. The same skip showed up with several panes open: the idle ones restarted, the monitoring ones did not.

**How can we reproduce it?**

1. On Orca 1.4.243, sign in two Claude accounts under Settings → AI Provider Accounts.
2. Set **When you switch accounts while Claude is running** to **Always restart**.
3. Open a Claude terminal pane. Ask it to run `sleep 600` in the background and monitor it. Wait until Claude's prompt is back and the pane shows monitoring.
4. Open a second Claude pane and let it sit idle, with no background task.
5. Switch the active Claude account.

**Expected**

The idle pane restarts. The monitoring pane restarts too, once the main agent is back at the prompt, even though a background task is still running. A pane whose main agent is still working, blocked, or waiting on a question stays queued.

**Actual**

The idle pane restarts. The monitoring pane never does. It remains on the previous account.

**Environment**

- Orca 1.4.243, macOS, local workspace, Claude Code in a terminal pane.
- The same `isClaudePaneMidTurn` gate is shared by the desktop restart queue. This repro is the local macOS app. It does not cover SSH panes, which already have a separate path ([#31476](https://github.com/stablyai/orca/issues/31476)).

**Before video**

`B1`, under a minute. Setup off camera: step 3 and step 4 already done, Always restart already set.

1. Open the workspace. The first tab shows Claude's prompt and a background sleep still running. The second tab is idle.
2. Switch the Claude account from the status bar.
3. The viewer must see the idle tab restart, and the monitoring tab stay on the old conversation with its status still Working. No second restart starts.

Attach with `gh image` or drag-and-drop. Do not commit the file.

**Related**

[#23414](https://github.com/stablyai/orca/issues/23414) describes the "working while only a background shell runs" status. [#33551](https://github.com/stablyai/orca/issues/33551) is a different skip (panes that were not candidates). [#34515](https://github.com/stablyai/orca/issues/34515) is a queued restart that stops work still in progress.

## Issue 2 — `pr/claude-pane-account-registry`

**Title:** `[Bug]: Orca does not remember which Claude account a pane is on, so its usage is filed on the selected account`

**Video:** before `B2`, after `A2`.

### Body

### Operating system

macOS

### Orca version

1.4.243

### Details

**Short summary**

I keep two Claude panes on two accounts. Orca's selected account is a third fact, and it is the only one the usage UI trusts. Codex records which account each pane launched with. Claude does not. On a headless `orca serve` host, with no window open, Claude usage is not refreshed at all.

**What happened**

Each Claude process gets its account's `CLAUDE_CONFIG_DIR` at launch. Switching the selected account and choosing **Keep as is** leaves that process on the old account. Nothing in the tab, and no Claude equivalent of `~/.config/orca/codex-pane-accounts.json`, says so. A usage reading that the running pane prints is applied to whichever account is selected, not to the account the pane launched with. I then make the next decision from the wrong row.

On a machine that only runs `orca serve`, usage polling never starts. In v1.4.243 that start lives in `src/main/startup/main-window-core-services.ts`. `orca account list` keeps the last snapshot from a desktop session, or an empty one.

**How can we reproduce it?**

1. On Orca 1.4.243, add two managed Claude accounts, A and B. Leave A selected.
2. Start a Claude terminal pane. It launches on A.
3. Switch the selected account to B and choose **Keep as is**.
4. Look at the terminal tab and the status-bar Usage popover. Send one short message in the old pane so Claude prints a usage update.
5. On a second machine, or after quitting the window, run `orca serve` with no desktop window. Run `orca account list --json` once, use the Claude account, wait several minutes, and run it again.

**Expected**

The pane is still recorded as account A after the switch, including across an Orca restart (learned again from the session transcript if the process outlived the app). A's usage row is the one that moves when that pane reports usage. B stays the selected account and the status bar. On a headless host, `orca account list` refreshes Claude usage without anyone opening a window.

**Actual**

The tab does not name an account. The status bar follows B. The live reading from A's pane does not stay on A. The headless list does not refresh.

**Environment**

- Orca 1.4.243. Desktop steps on macOS. Headless step is `orca serve` with no window, which is the same gap on Linux and on an SSH host that has no desktop.

**Before video**

`B2`, under a minute. Setup off camera: the pane from step 2 is up, B is already selected, Keep as is was chosen.

1. Show the tab (no account on it) and the Usage popover on B.
2. Send `reply with one word` in the old pane.
3. Show the popover again: the selected account is still the row that changes, or A's row does not.
4. Cut to a terminal on the headless host: two `orca account list --json` snippets, minutes apart, with the same Claude usage numbers.

Attach with `gh image`. Do not commit the file.

**Related**

[#19900](https://github.com/stablyai/orca/issues/19900) already notes the missing Claude pane record. [#34201](https://github.com/stablyai/orca/issues/34201) is the popover showing one account's numbers under another email. [#28683](https://github.com/stablyai/orca/issues/28683) asks for a pin this issue does not add. [#33138](https://github.com/stablyai/orca/issues/33138) asks for `orca account usage`, which this issue does not add.

## Issue 3 — `pr/claude-session-mover`

**Title:** `[Feature]: Continue a running Claude session on another account before the usage limit`

**Video:** before `B3`. After is the M0 recording (the session continues in the same pane). The resume-without-proxy behavior is the hand-off note and the between-turn wait; M0 shows the end state with the proxy on, which is the recording this ladder already has.

### Body

### Problem or use case

Claude stops at the usage limit in the middle of a task. I switch accounts. Orca restarts the session, and the restart kills the background build the session was watching.

I have more than one Claude account so that moment does not end the day. On 1.4.243 the only control is **When you switch accounts while Claude is running**: Ask, Always restart, or Never restart. Restart continues the conversation by starting a new process. It does not wait for a background command to finish, and it does not tell the continued session what the restart ended. Never restart leaves the pane on the empty account until I notice.

**How can we reproduce it on 1.4.243?**

1. Sign in two Claude accounts. Set the running-session switch to **Always restart**.
2. In a Claude pane, start a build or a long command in the background (`sleep 600` writing a line a second to a file is enough).
3. Let that account hit its limit. The next turn stops with the usage-limit message.
4. Switch to the other account and let the restart proceed.

**Expected**

The same pane continues on the account with the most room left, between turns, before the account is hard-stopped.

- The lines I care about are 95% of the 5-hour window, and 90% of the weekly window and of the Fable weekly window. Only an account with clearly more room is a destination. If none is, nothing moves.
- On the desktop the default is to ask, and to do nothing until I set it to move. On a headless host, where nobody can answer, ask means move.
- If the main agent is still in a turn, wait.
- If a background command is still running, wait up to 10 minutes so it can finish. If the account is already at the limit, move now.
- After a resume, write one note into the pane: which account it left, which account it is on, which subagents the restart ended, and which background work was still running.
- Off means never do this.

**Actual**

The pane restarts as soon as I switch, or not at all. The background process dies with the old Claude process. The new session does not say what was lost. I re-run the build.

**Environment**

Orca 1.4.243, macOS, two managed Claude accounts, Claude Code in a terminal pane. The setting copy is **When you switch accounts while Claude is running**.

**Before video**

`B3`, under a minute. Setup off camera: the background command is running and the account is already at the limit.

1. Show the usage-limit line in the pane, and a terminal `tail` of the background log still growing.
2. Switch accounts and accept the restart.
3. The viewer must see the pane come back as a new process, and the log stop growing.

**Proposed solution**

A setting, **Move running sessions before a usage limit**, next to the existing running-session switch. Values: off, ask, move. CLI: `orca account session-mover --agent claude --off|--ask|--move`. Desktop ask shows a notice and does not move. Headless ask moves. A move resumes the same conversation in the same pane on the account with the most room.

**Alternatives**

- [#28044](https://github.com/stablyai/orca/pull/28044) switches the account used for the next launch. It does not continue a session that is already running. This issue is that session.
- [#31476](https://github.com/stablyai/orca/issues/31476) wants `accounts.selectClaude` to take running sessions with it. This issue does not change that RPC.
- [#34422](https://github.com/stablyai/orca/issues/34422) and [#29999](https://github.com/stablyai/orca/issues/29999) want no restart at all. A resume still restarts the process. Keeping the process is a separate issue, default off.
- Hand-off, Session History resume, and the existing restart all start a new process too, and only after I do it by hand.

## Issue 4 — `pr/claude-auth-proxy`

**Title:** `[Feature]: Move a running Claude session to another account without restarting its process`

**Video:** before `B4`. After is M0 (same recording as issue 3's after).

### Body

### Problem or use case

Continuing a Claude session on another account still means killing the process. The conversation can resume, but the process id changes, the prompt cache is cold, and every child of that process is gone. With a lot of panes open, a wave of restarts is the outage ([#34422](https://github.com/stablyai/orca/issues/34422)).

I want one pane's next request to bill a different account, and I want that process to stay up. I do not want the old shared-login behavior back. Each account should keep its own home.

**How can we reproduce it on 1.4.243?**

1. Note the pid of a running `claude` pane (`ps` on that tty).
2. Put a distinctive line in the scrollback.
3. Switch Claude accounts and restart running sessions.
4. Read the pid again.

**Expected**

The same pid is still there. The scrollback is still there. The next request is billed to the account that has room. A notice says the session continues without a restart. Children of that process are still running.

**Actual**

The pid changes. The pane redraws as a resumed or new session. Children are gone.

**Environment**

Orca 1.4.243, macOS, local Claude terminal pane, two managed accounts. A user-set `ANTHROPIC_BASE_URL` must keep working untouched. This is off unless I turn it on.

**Before video**

`B4`, under a minute. Can be filmed immediately after `B3` if that take did not already show the pid.

1. Show `ps` with the Claude pid and the distinctive scrollback line.
2. Switch accounts and restart.
3. The viewer must see a new pid and the same work gone.

**Proposed solution**

An opt-in setting, **Bill Claude through a local auth proxy**, default off. CLI: `orca account auth-proxy --agent claude --on|--off|--status`. When it is on, a pane can change the account it bills without a new process. When it is off, launches stay on `CLAUDE_CONFIG_DIR` only. If I have set `ANTHROPIC_BASE_URL` myself, leave it alone and say so once. `--status` prints the listener and does not change the setting.

**Alternatives**

[#29999](https://github.com/stablyai/orca/issues/29999) and [#34422](https://github.com/stablyai/orca/issues/34422) ask for every running session to follow a switch, via one shared login. This is per pane, off by default, and it does not merge credential files. [#25873](https://github.com/stablyai/orca/issues/25873) asks for a per-account proxy environment variable, which is a different proxy.

## Issue 5 — `pr/claude-account-pool`

**Title:** `[Feature]: Spread Claude sessions across accounts, and move one before an account fills up`

**Video:** before `B5`. After is M1 (five panes already spread, then one rebalance). M0 is the single-pane move those rebalances look like.

### Body

### Problem or use case

Every new Claude pane starts on the selected account. I open five of them in the morning and they all share one 5-hour window. The other accounts sit at zero until the first one is full and something restarts. Nothing on the tab tells me which account a pane is billing, and there is no list of the moves that already happened.

**How can we reproduce it on 1.4.243?**

1. Add two or more Claude accounts. Leave one selected. Confirm the others have more room left.
2. Open five Claude terminal panes, one after another.
3. Look at each pane's launch account (the `CLAUDE_CONFIG_DIR` it received) and at the status bar.

**Expected**

Each new pane starts on the signed-in account with the most room left. The selected account stays what the status bar shows. A pane that can move without a restart moves earlier, when another account has clearly more room, at most once every 15 minutes, and not in the middle of a burst of turns. The tab shows a short label for the account that pane bills. `orca account list` shows whether spreading is on and how many sessions each account has. `orca account moves` prints the time, the pane, from, to, why, and whether it resumed or kept the process.

**Actual**

All five panes launch on the selected account. The tab has no account label. There is no move history.

**Environment**

Orca 1.4.243, macOS, several managed Claude accounts. Default for this behavior should be off, so today's "always use the selected account" stays until I turn it on.

**Before video**

`B5`, under a minute. Setup off camera: several accounts, one of them clearly fuller, that fuller one selected.

1. Open the account list so the selected account and the roomier one are both visible.
2. Start two Claude panes (two is enough inside a minute; say on camera that the other three do the same).
3. The viewer must see both panes on the selected account, and no per-pane label.

**Proposed solution**

A setting, **Spread sessions across accounts**, default off. CLI: `orca account pool --agent claude --on|--off`. On: a new Orca-launched Claude session uses the account with the most room. Off: launches use the selected account. A running session that already goes through the auth proxy may move once to balance accounts, with the notice "<from> continues on <to> to balance your accounts." A typed `claude` in a shell keeps the account that shell already had.

**Alternatives**

[#9496](https://github.com/stablyai/orca/issues/9496) and [#30567](https://github.com/stablyai/orca/issues/30567) pin an account per project. [#33193](https://github.com/stablyai/orca/issues/33193) wants a hand-set priority and a switch back when the main account resets. This issue is "most room left", and it does not switch back.

## Issue 6 — `pr/claude-durable-background-jobs`

**Title:** `[Feature]: A background command Claude started should keep running when Claude restarts`

**Video:** before `B6`, after `A6`.

### Body

### Problem or use case

Claude's background bash is a child of the `claude` process. Any restart kills it. That includes the account-switch restart I already have on 1.4.243, and it includes a resume onto another account. The build I asked Claude to watch dies at the moment Orca tries to save the session. The resumed Claude does not know the command, the pid, or where the log went.

**How can we reproduce it on 1.4.243?**

1. In a Claude pane, ask it to run a background command that appends a timestamp to a file once a second, for ten minutes.
2. Confirm the file is growing and the pid's parent is the Claude process.
3. Switch Claude accounts and restart the session (or quit that Claude and `claude --resume` the same session).
4. Read the file and look for the pid.

**Expected**

The command keeps running after Claude's process is gone. The file keeps growing. I can list the job, read its log, and stop it from the machine that holds it: `orca job list`, `orca job logs --id <id>`, `orca job stop --id <id>`. The resumed session can read that same log. This is on for Claude launches. `ORCA_DURABLE_JOBS=0` turns it off.

It still has to be allowed by Claude's own permission check. An allow rule that matched the original command may not match the rewritten one, so Claude can prompt until I allow it. If detach fails, the command should say so and run in a way that still dies with Claude, rather than claiming it survived.

**Actual**

The timestamp file stops at the restart. The pid is gone. The resumed session has no job id to look up.

**Environment**

Orca 1.4.243, macOS, Claude Code terminal pane. The same parent-child relationship is what Linux, Windows, and a WSL guest hit. A fix has to name those, not only macOS: detach so the child's parent is pid 1 on macOS and Linux, a hidden PowerShell launch on Windows, and `setsid` inside a WSL guest.

**Before video**

`B6`, under a minute. Setup off camera: the background command is already appending to the file.

1. Show `tail -f` of the file and `ps` with the Claude parent.
2. Restart the Claude session from the account switch.
3. The viewer must see the tail stop and the child pid gone.

**Proposed solution**

When Claude is about to run a background bash from an Orca-managed session, run the real command outside Claude's process and let Claude's background task follow the log. Ship the helper with the app. Keep job files on the machine (`orca job list` and the related commands above).

**Alternatives**

Remembering the command and re-running it after resume runs it twice and loses the first process's output. Telling the user to run the build in a separate terminal works, and it is what I do today. It means the agent cannot start the job itself.

## Issue 7 — `pr/plugin-accounts-api`

**Title:** `[Feature]: Let a plugin read Claude account usage without reading credential files`

**Video:** before `B7`, after `A7`.

### Body

### Problem or use case

I want a small plugin that shows which Claude account has room and how many sessions are on it. The plugin API on 1.4.243 does not expose accounts. The only way to learn this is to read Orca's account homes or Claude's credential files. A plugin should not be handed tokens to draw a usage line.

**How can we reproduce it on 1.4.243?**

1. Open a stock 1.4.243 tree.
2. Search the plugin host for a Claude account list or a usage event (`accounts.read`, `listClaudeAccounts`, or similar).
3. There is no such call. The only `accounts.read` hit in the tree is an unrelated test sentence in the relay app.

**Expected**

A plugin can ask for each Claude account's id, label, usage windows (used percent, window, when it resets), and how many sessions are on it. It can subscribe to usage changes and to a session moving. The payload has no access token and no credential path.

**Actual**

No host call returns that. A plugin that needs it reads files it should not read.

**Environment**

Orca 1.4.243 plugin host. Desktop and headless, since the host is the runtime, not the window.

**Before video**

`B7`, under a minute.

1. Open the plugin host methods (source or the developer surface the app already shows).
2. The viewer must see the existing host calls and no Claude account or usage call.

**Proposed solution**

One read-only plugin capability, `accounts.read`: list the Claude accounts as above, plus events when usage changes and when a session moves. A short example plugin in the docs prints labels and percents and nothing else.

**Alternatives**

[#33138](https://github.com/stablyai/orca/issues/33138) is a CLI for humans and scripts. [#23143](https://github.com/stablyai/orca/issues/23143) and [#19809](https://github.com/stablyai/orca/issues/19809) are status-bar slots. [#23903](https://github.com/stablyai/orca/issues/23903) is a task-provider API. None of them is this list.

## Posting checklist

- [ ] Issues 1–3 posted together, each with its before video attached, not committed.
- [ ] Wait until 1–3 are merged or a maintainer has acknowledged them.
- [ ] Then post 4–7, each with its before video. M0 is the after attachment for 3 and 4. M1 is the after attachment for 5. A1, A2, A6, A7 are the other afters, attached when those PRs open.
- [ ] Linked issue on each PR is `Fixes #<the number above>`. Do not use `Refs`.
- [ ] Do not close #34422, #29999, #31476, #33551, #34515, #34201, #28044, or #33138 from these issues.
