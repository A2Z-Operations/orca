# Upstream Orca features, v1.4.236 to v1.4.243

Date: 2026-10-28.

Tag range: v1.4.236 through v1.4.243. Source: the eight GitHub release bodies of `stablyai/orca`, concatenated. v1.4.236 has no release page (`release not found`). Its changes are inside the v1.4.237 notes. The v1.4.237 changelog compares `v1.4.235...v1.4.237`.

Published times from the `published:` lines:

| Tag | Published |
|---|---|
| v1.4.236 | no release page |
| v1.4.237 | 2026-10-21T07:25:23Z |
| v1.4.238 | 2026-10-23T21:47:22Z |
| v1.4.239 | 2026-10-24T07:10:02Z |
| v1.4.240 | 2026-10-25T04:02:08Z |
| v1.4.241 | 2026-10-26T03:48:28Z |
| v1.4.242 | 2026-10-27T00:09:03Z |
| v1.4.243 | 2026-10-28T04:08:34Z |

This digest is for our fork (`A2Z-Operations/orca`, branch `blowzer/auto-switch`) on the MacBook desktop app and the Mac Studio `orca serve` runtime. The ranked list is the fifteen changes that should change how we work. The inventories under it list every release note in the categories the brief asked for. The notes do not mention a statusline change in this range. The only "rate limit" bullet is a CI wait for the mobile bundle (#31431), not a Claude or Codex usage policy.

## What matters to us

### Ranked

1. Account-switch restarts put Claude back in the folder it was started in, leave a node or python program alone, and no longer let hidden Claude panes count against the eight-session limit.
   PRs: #33659, #30328, #34403, #34214, #33793, #31945, #31994, #33527.
   Touches: accounts & usage, terminals & chats, headless Studio runtime.
   What to do: adopt. Retest the session mover and the auto-switch restart dialog on the next merge. The v1.4.242 dialog also offers System-default-folder sessions and groups them into old account, others, and ones it cannot move.

2. Claude weekly usage no longer jumps back to an idle session's old value.
   PRs: #32249.
   Touches: accounts & usage.
   What to do: adopt. Our switch lines read these windows. Recheck the 5-hour and weekly readings after the merge so a stale idle session cannot move the line.

3. A lapsed Claude access token shows as waiting for Claude, not signed out, and an Enterprise seat with no 5-hour or weekly window shows its monthly spend cap.
   PRs: #33542, #33655.
   Touches: accounts & usage.
   What to do: adopt. Do not treat "waiting" as signed out when the mover picks an account.

4. A paired desktop can add Claude and Codex accounts on a supported remote server. Credentials stay on the server.
   PRs: #31461.
   Touches: accounts & usage, headless Studio runtime, CLI.
   What to do: try, after the Studio runtime is on v1.4.238 or newer. Windows servers and older hosts still show `orca account add`. Remote re-authentication of an existing account is outside this change.

5. Worker heartbeats can be turned off or given a new interval, and settled workers stop polling for slash commands.
   PRs: #34070, #34071, #34404, #34342.
   Touches: orchestration.
   What to do: adopt the polling stop. Leave heartbeats at 5 minutes, which stays the default. Settings apply to newly dispatched workers only. Workers already running keep their brief, and older hosts keep 5 minutes.

6. A worker started on another server finds its coordinator from the caller, and a new `orca orchestration check --wait` can start while an older wait is still running.
   PRs: #33744, #33013.
   Touches: orchestration, headless Studio runtime, CLI.
   What to do: adopt. This is the MacBook-to-Studio dispatch path. Update both sides before relying on it.

7. macOS `orca serve` stays out of the Dock, a supervised serve can update when its profile path is spelled differently, and serve uses the app's bundled browser driver.
   PRs: #33878, #34570, #34111, #34150.
   Touches: headless Studio runtime, browser.
   What to do: adopt on the next Studio rebuild. Our updater kill switch still refuses a stock update. The browser-driver install matters when an agent drives the Studio browser.

8. A headless host cannot share artifacts or skills yet. Installing Orca skills on a paired server is a separate, shipped path.
   PRs: #33754, #31867, #31688, #31918.
   Touches: headless Studio runtime, CLI.
   What to do: nothing to enable. Do not expect artifact or skill sharing aimed at the headless serve. Use the paired-server installer when both sides are updated.

9. Quitting Claude or Codex in a terminal can continue that conversation in Chat while the terminal tab stays open, and a chat will not write a conversation a terminal is still running.
   PRs: #33759, #30930, #33954.
   Touches: terminals & chats, headless Studio runtime.
   What to do: try. v1.4.243 starts new terminals on a fresh terminal host so this handoff applies. Terminals already open stay on the previous host until closed. This is not an account switch.

10. A resumed Claude session keeps its effort level and launch flags, and a restored host pane resumes the saved session instead of replaying the launch command.
    PRs: #33765, #33776, #33523, #33286, #34054, #30982, #31231.
    Touches: terminals & chats, accounts & usage.
    What to do: adopt. After an account-switch restart, confirm effort, flags, and the saved session come back. #31231 keeps Claude's rewound context across an Orca rollback.

11. A paired server keeps workspace tabs across a desktop restart, and tabs it closed stay closed.
    PRs: #33926, #33702, #33972, #33949, #34082.
    Touches: headless Studio runtime, terminals & chats.
    What to do: adopt once both machines are on v1.4.242 or newer. A MacBook restart should not rebuild or resurrect the Studio's tabs.

12. Orca offers to resume interrupted chats after a paired or managed server restarts or updates.
    PRs: #28978.
    Touches: terminals & chats, headless Studio runtime.
    What to do: try. The v1.4.241 notes say the offer needs a server already running that release.

13. Layout groundwork stays switched off. In a switch-on build, main would own pane create, restore, split, and terminal questions, and the window would only attach.
    PRs: every layout-owner pull request in the inventory below, from #31187 through #32002.
    Touches: terminals & chats, headless Studio runtime.
    What to do: nothing. Do not build the session mover on this API. The release notes call it dark, disabled, or switch-on only. v1.4.240 through v1.4.243 add no further layout-groundwork block.

14. Codex usage still shows while its session index is rebuilding, fork-copied token events count once, and the active account row shows live usage, including System default.
    PRs: #33636, #33478, #20842.
    Touches: accounts & usage.
    What to do: try on the Studio Codex fleet. The notes do not say this changes Claude's windows.

15. Automations stop guessing an ambiguous legacy host, survive the daylight-saving repeated hour, explain a stuck Codex hook review, and count as done when the agent reports finishing.
    PRs: #31234, #19086, #20179, #33638, #34096, #34525, #34044.
    Touches: automations, headless Studio runtime.
    What to do: adopt. #34525 runs desktop automations for a project on an SSH or WSL host's server instead of rejecting every run. #34044 moves an SSH host's enabled automations onto its Orca server so the host can connect. Our automations are on the Studio serve, not WSL.

### Accounts, switching, usage, and Claude or Codex resume

The notes below are the release bullets. "Unclear" marks a test title whose user-facing rule is not spelled out.

- Add Claude and Codex accounts on supported remote servers from a paired desktop. #31461 (v1.4.238).
- Restart WSL Claude panes after an account switch. #31945 (v1.4.238). We do not run WSL.
- Allow independent hidden account restarts to progress. #31994 (v1.4.239).
- Keep Claude weekly usage from jumping back to an idle session's old value. #32249 (v1.4.239).
- Read WSL Claude transcripts through linked folders, so chats from Orca-managed Claude accounts load on mobile. #33172 (v1.4.241).
- Write folder trust into the managed Codex account home the launch uses. #33377 (v1.4.241).
- Apply global `~/.codex/rules` in Orca-managed Codex homes. #33493 (v1.4.241).
- Index a new WSL Codex account home before bringing history into it. #33630 (v1.4.241).
- Read the sign-in link Codex prints on stderr when adding a Codex account. #29811 (v1.4.241).
- Keep the old Codex login until re-authentication finishes, and relabel swapped account homes. #33568 (v1.4.241).
- Keep the selected Antigravity account after agy refreshes its token. #33656 (v1.4.241).
- Resume Claude in the folder it was started in after an account-switch restart. #33659 (v1.4.241).
- Leave your node or python program alone after a Claude account switch. #30328 (v1.4.241). Author in the notes: adifsgaid, first contribution in this release.
- Share folders Claude created in an account folder before its first setup. #33479 (v1.4.241).
- Show an idle Claude account whose access token lapsed as waiting for Claude, not signed out. #33542 (v1.4.241).
- Show a Claude Enterprise seat's monthly spend cap when it has no 5-hour or weekly window. #33655 (v1.4.241).
- Count fork-copied Codex token events once in usage. #33478 (v1.4.241).
- Show Codex usage while Codex's session index is stuck rebuilding. #33636 (v1.4.241).
- List Claude sessions stored under a `CLAUDE_CONFIG_DIR` set only in the login shell. #33506 (v1.4.241).
- Keep Codex automation and agent-created threads in Agent Session History. #33477 (v1.4.241).
- Remove the usage-limit Continue button that could hit the same limit again. #33392 (v1.4.242).
- Offer to restart System default Claude sessions signed in to the old account when switching accounts. #33793 (v1.4.242). Compatibility note: the dialog groups sessions into those on the old account, others, and ones it cannot move.
- Resume Claude sessions at their own effort level. #33765 (v1.4.242).
- Keep a background agent launch's flags when it is resumed. #33776 (v1.4.242).
- Resume a Codex thread with the permission it was last given, not Orca's launch flag. #33460 (v1.4.242).
- List Claude sessions from a wrapper script's or launch setting's `CLAUDE_CONFIG_DIR` in Agent Session History. #33751 (v1.4.242).
- List OpenCode sessions from Orca-managed data accounts, and resume them under the account that owns them. #33658, #33753 (v1.4.242).
- Write usage cache files readable only by you. #31027 (v1.4.242).
- Keep resumed Claude chats ready to receive messages after settings updates. #30982 (v1.4.237).
- Keep Claude's rewound context intact after rolling back Orca. #31231 (v1.4.237).
- Resume Claude panes whose environment scrubbing removed their pane identity. #33286 (v1.4.240).
- Resume an agent from the folder it ran in, not the pane's starting folder. #33527 (v1.4.241).
- Keep launch flags on a woken agent's record so a restart restores them. #33523 (v1.4.241).
- Follow Claude sessions continued into a daemon job. #33605 (v1.4.241).
- Do not resume an agent whose terminal is still running. #33380 (v1.4.241).
- Resume a restored host pane's agent from its saved session instead of replaying the launch command. #34054 (v1.4.243).
- Keep account-switch restarts of hidden Claude panes from counting against the eight-session limit. #34403 (v1.4.243).
- Restart panes in the right workspace when switching accounts and IDs repeat across hosts. #34214 (v1.4.243).
- Show live Codex usage on the active account row, including System default. #20842 (v1.4.243).
- List an idle Claude chat's slash commands from the account it will start on. #34429 (v1.4.243).
- Share one capped Codex process per account for resting chats' skill checks. #34349 (v1.4.243).
- Translate Claude account labels in switch toasts and dialogs. #34470 (v1.4.243).
- Keep your configured Codex command when restarting Codex before it records a session. #33629 (v1.4.243).
- Let you answer a startup prompt, such as a passphrase, while a saved agent terminal restores. #30978 (v1.4.243).
- The notes name a test, "cover the workspace-folder fallback for account-restart resume cwd" (#34203, v1.4.243). The fallback rule itself is unclear from the release line.
- Other agents' usage reads, not Claude or Codex policy: Cursor Unified Ultra quotas #31978, OpenCode quota failures shown as usage limits #31937, Antigravity usage command #33289, backoff when that read opens a browser sign-in #33297, Kimi Code 2.x usage #33290, Antigravity error text #34106, unidentified Antigravity login #34159, no-quota Antigravity login #34163, Antigravity account saved without an ID token #33580. Daily aggregate WSL usage snapshot on Windows #31406. A refactor titled "group native chat context usage" #34595 does not describe a behavior change.

No `orca account` subcommand is added in these eight releases. `orca account add` is named only as the guidance Windows servers and older hosts still show (#31461).

### Headless `orca serve`, paired servers, and orchestration

- Restore voice dictation on headless `orca serve` hosts. Installed-app serve on Linux and macOS can use the bundled on-device recognizer. Windows, managed SSH, and WSL use cloud models. #31217 (v1.4.237).
- `orca speech openai-key status`, `set`, and `clear` configure the host key. `set` reads stdin. #31230 (v1.4.237).
- Create and edit notes on headless hosts. #31291 (v1.4.237).
- Restart the macOS serve supervisor from the updated app, and prepare its code copy in one step. #31200, #31303 (v1.4.237).
- Reconnect hidden terminal tabs to sessions that survived a restart. #31254 (v1.4.237).
- Preserve in-app browser logins when a WSL or managed SSH host pairs again. #29610 (v1.4.237).
- Refuse new terminal creation while a server update is stopping the server. #29834 (v1.4.237).
- Keep the enrolled pairing across a managed server's update, rollback, and recovery. #31684 (v1.4.238).
- Prevent new terminals during a server stop and protect rollback and restart transitions. #31418 (v1.4.238).
- Honor "only when desktop is away" on headless `orca serve`. #31956 (v1.4.238).
- Keep a Codex chat on screen when Codex shows its idle title on a headless host. #31460 (v1.4.238).
- A workspace created on a paired server shows one set of default tabs when the same path exists on another host. #32080 (v1.4.238).
- Ship computer use with the server and say when it is unavailable. #31958 (v1.4.238).
- Warn about agents that cannot wake on a windowless server only when the workspace has sleeping agents. #31607 (v1.4.238).
- Keep a paired server's SSH access link across its restarts, and let it relink. #33001 (v1.4.239).
- Negotiate agent launches with paired runtimes, and apply paired host preferences to launch menus. #32029, #31971 (v1.4.239). Plus-menu quick launch on a paired host uses the desktop's launch settings. #32050 (v1.4.239).
- A slept server run opens its own tab from a paired desktop. #32132 (v1.4.239).
- Explain when headless terminal creation cannot find a workspace. #33264 (v1.4.240).
- Keep slow remote connections open when a wake probe is missed, and show one reconnect notice per server. #33071, #33095 (v1.4.240).
- Start a split on the paired server even when it follows immediately after opening a tab. #33078 (v1.4.240).
- Let paired hosts plan terminal-agent launches from the composer. #32192 (v1.4.240).
- Upload chat attachments picked or dropped in a web client to the paired server. #33060 (v1.4.240).
- Keep one paired runtime's updates from dropping another runtime's terminals in a shared workspace. #33414 (v1.4.241).
- Drop a paired server's old workspace rows when it relists them under new project ids. #33396 (v1.4.241).
- Adding a project on a paired server's SSH host is not supported yet. #33284 (v1.4.241).
- Fix `orca agent hooks` on headless Orca servers. #33700 (v1.4.241).
- Drive Android emulators from headless `orca serve` hosts. #33701 (v1.4.241). We do not use this.
- Start Claude Agent Teams teammates on headless Linux servers. #33389 (v1.4.241). The Studio is macOS.
- Launch Claude Agent Teams on Orca servers with the `orca` command they install. #34116 (v1.4.243).
- Point idle headless terminals at their mail. #33258 (v1.4.241).
- Let a new `orca orchestration check --wait` start while an old one is still waiting. #33013 (v1.4.241).
- Wake an agent for new mail even while it still holds an unacknowledged batch. #33639 (v1.4.241).
- Submit mail pointers to Cursor CLI instead of leaving them in the composer. #33347 (v1.4.241).
- Hold mail pointers while the agent shows an open dialog, and while the composer has an unsent draft. #33366, #33429 (v1.4.241).
- Fail a Codex worker's dispatch when its session cannot reconnect. #33543 (v1.4.241).
- Let worker-start reuse an idle native-install Claude terminal. #33544 (v1.4.241).
- Start a Claude worker on its composer when its terminal title is turned off. #33384 (v1.4.241).
- Paste CLI prompts as one block for every recognized agent, not just Claude and Codex. #33571 (v1.4.241).
- Alert the orchestration coordinator when a chat worker errors. #31941 (v1.4.240).
- Let a worker start helpers on the Run it works for. #29205 (v1.4.239, maintenance list).
- Reject ask waits above the documented 30-minute maximum. #32044 (v1.4.239).
- Reject task messages for another implicit Run. #32037 (v1.4.239).
- Refuse sends to a Run whose home is another computer. #33005 (v1.4.239).
- A connector backlog cannot fill orchestration's receipt ledger. #32130 (v1.4.239, experimental groundwork block).
- Find a worker's coordinator from the caller, so starting a worker on another server works. #33744 (v1.4.242).
- Stop workers from taking over the Run they work for. #29008 (v1.4.242).
- Teach workers to acknowledge and drain mail batches so newer messages are not hidden. #26768 (v1.4.242).
- Keep a worker's finished report when a late startup step fails. #26762 (v1.4.242).
- Keep paging forward through a worker transcript after a page fills. #32894 (v1.4.242).
- Send launch prompts and worker tasks through the retrying start so a first failed start does not lose them. #33832 (v1.4.242).
- Explain that a headless host cannot share artifacts or skills yet. #33754 (v1.4.242).
- Keep macOS `orca serve` out of the Dock, and let Linux servers opt in to the GPU. #33878 (v1.4.242).
- Show a server added with `orca environment add` in every window right away. #33930 (v1.4.242).
- Refuse a second Orca server on a host cloned with the same machine id, and say how to fix it. #33775 (v1.4.242).
- Keep a paired server's workspace tabs across desktop restarts. #33926 (v1.4.242).
- Stop closed tabs coming back after a restart on a host moved to its managed server. #33702 (v1.4.242).
- Keep a pane moved into a new tab in its new tab on paired servers. #33027 (v1.4.242). Moving a pane into a new tab needs the server on this release. On older servers the move stays in this window only.
- Continue remote Claude terminal conversations in Chat on paired servers. #33954 (v1.4.242). On older servers, Continue in Chat UI shows disabled with an update hint.
- Add a Settings switch to turn worker heartbeats off. #34070 (v1.4.243).
- Choose how often workers send heartbeats. #34071 (v1.4.243). Default remains every 5 minutes. Changes apply to newly dispatched workers. Older hosts keep 5 minutes.
- Point dispatched workers at the orchestration skill, and stop their heartbeats before they report done. #34404 (v1.4.243).
- Stop settled workers polling for slash commands. The notes say this kept about 100 hidden Codex processes busy on Windows. #34342 (v1.4.243).
- Let a sleeping chat's background commands send orchestration mail as that chat. #34049 (v1.4.243).
- Start a worker in a new worktree from anywhere when you name the repo. #34388 (v1.4.243).
- Press Enter on a prompt Orca already pasted, even if the sending script disconnects. #34373 (v1.4.243).
- Stop calling a worker's prompt "submitted" when Orca could not see the worker start. #21453 (v1.4.243).
- Keep a record in each Run of what `orca orchestration reset --tasks` cleared. #28823 (v1.4.243).
- Target the calling terminal's own workspace in folder projects from the CLI. #33703 (v1.4.243).
- Let a supervised `orca serve` on macOS update when its profile path is spelled differently. #34570 (v1.4.243).
- Use the app's bundled browser driver for `orca serve`, and install that driver alongside the local serve server. #34111, #34150 (v1.4.243).
- Run desktop automations for projects on an SSH or WSL host's server instead of having every run rejected. #34525 (v1.4.243).
- Recover saved servers when a crash left the saved-server file empty. #33864 (v1.4.242).

### Automations

- Refuse ambiguous legacy automations instead of guessing which host should run them. #31234 (v1.4.237).
- Refresh automation run history before opening a run. #32788 (v1.4.239).
- Share the idle agent-turn completion rule. #32114 (v1.4.239). The notes call this a refactor.
- List a web client's paired server once in automations. #33019 (v1.4.240).
- Keep Codex automation and agent-created threads in Agent Session History. #33477 (v1.4.241).
- Keep automation schedules from skipping dates around daylight saving changes. #19086 (v1.4.242).
- Move cron and hourly automations past the repeated hour when clocks fall back. #20179 (v1.4.242).
- Move an SSH host's enabled automations to its Orca server so the host can connect. #34044 (v1.4.243).
- Run desktop automations for projects on an SSH or WSL host's server. #34525 (v1.4.243).
- Start a WSL host's distro when one of its automations is due. #33839 (v1.4.243).
- Say why an automation is stuck on Codex's hook review, keep it scheduled, and stop stuck tabs piling up. #33638 (v1.4.243).
- Mark an automation done when its agent reports finishing, even if the screen never looks idle. #34096 (v1.4.243).

### Layout groundwork (switched off)

v1.4.237 says the layout-owner work "remains behind disabled build switches and is not enabled in this release." The block title is "Layout groundwork (disabled)."

- Main answers terminal questions from its own layout (A1, dark). #31187.
- A CLI or phone file on a layout-owner server opens in the tab group a paired desktop shows (switch-on builds only). #31264.
- A CLI send, wait, or read starts a saved pane that has no terminal yet (dark). #31307.
- The window shows tab, title, move, and divider changes only from main's update (dark). #31257.
- Phones see main's terminal and editor rows (A2, dark). #31276.
- A paired desktop shows the held-terminal banner and Reopen for a server's held terminals (switch-on builds only). #31275.
- Pin why main's pane list republish waits for a microtask (switch-on builds only). #31333.
- Pin the layout-owner save format for downgrade (dark, test). #31341.
- Main starts every split and new pane, the window only attaches. The bullet itself says "Layout groundwork (switched off)." #31258.
- A server with no window answers its first terminal create, not "handle stale" (switch-on builds only). #31391.
- Main shows live terminals that lost their tab, at the same moments the window did (dark). #31430.

v1.4.238 says "Layout-owner and sidebar changes listed below remain disabled." The block title is "Layout & sidebar groundwork (disabled)."

- A running agent's resume note is not a sleep, so switch-on builds report it connected (dark). #31485.
- A paired desktop shows a server's browser tab without opening a second page (dark). #31509.
- Phones get main's tab order, groups, and names after every layout change (dark). #31529.
- Sidebar: land the switch-on fixes from the flip branch on main, switch still off. #31466.
- Editor tabs main-first: the window asks main for every editor tab change and draws only main's update (dark). #31438.
- Sidebar P2: main publishes without waiting on git, and every source announces its changes (inert). #31513.
- Main closes, renames, sleeps, and starts new tabs' terminals itself, with or without a window (dark). #31571.
- Keep each host's activity, PR lane, and retention apart for a same-id workspace (dark, sidebar). #31517.
- One lifecycle line per workspace in main, with in-progress hints (switch-gated, sidebar). #31553.
- Main starts and restores every pane, and the window only attaches and paints the host's history. The bullet says "Layout groundwork (switched off)." #31567.
- Browser, chat, and simulator tabs main-first (dark). #31516.
- A phone keeps a desktop's untitled markdown tab read-only (dark). #31667.
- Main titles agent tabs and applies phone tab moves itself (dark). #31812.
- Main tells the window whether its start resumed a pane's agent, so the restored banner and reopen count come back. The bullet says "Layout groundwork (switched off)." #31908.
- A phone's tab move is always the server's own. No ghost editor tabs after restart. #31925.
- A paired desktop keeps the tabs it created in a server workspace drawn from the server's layout (switch-on builds only). #31853.
- A browser tab opened in a server workspace drawn from the server's layout stays open (switch-on builds only). #31898.
- A paired desktop's tab moves, splits, resizes, props, and renames in a server workspace go to the server's layout (switch-on builds only). #31714.
- A paired desktop's pane drag-out, handle-less split, and default-tabs mark reach a server's own layout (dark, stacked on #31714). #31869.
- A phone's new terminal lands after the tab it names (dark). #31924.
- A server-hosted browser tab opened in a server workspace drawn from frames survives other changes to that workspace (switch-on builds only). #31920.
- A paired desktop hands its editor tabs to the server before drawing a server workspace from the server's layout (switch-on builds only). #32088.
- A chat started in a server workspace drawn from the server's layout stays where you opened it (switch-on builds only). #32003.

v1.4.239, inside "Experimental groundwork (disabled by default)":

- Every question about which pane holds a terminal asks main's layout. The bullet says "Layout groundwork (switched off)." #32002.

v1.4.240, v1.4.241, v1.4.242, and v1.4.243 have no layout-groundwork block. v1.4.242 test lines #33919, #33923, and #33934 only speed up layout tests. They do not say the switch is on.

Related, and not inside the disabled block, so whether it is the same groundwork is unclear: "Main runs workspace sleep; the window follows (P3b)" #31564 (v1.4.239, product list).

### Other bullets that say session or restart

Product notes not already listed above:

- List session tabs in the same order as the desktop tab bar. #31269 (v1.4.237).
- Show the session title beside tabs when the phone is in landscape. #30879 (v1.4.237).
- Avoid an unnecessary reload of remote files after each restart. #31196 (v1.4.237).
- Keep scoped Session History working with very large transcript collections. #30905 (v1.4.237).
- Include sessions saved under a symlinked workspace's real path in Workspace history. #31244 (v1.4.237).
- Keep Session History checking totals fixed throughout a scan, and show per-agent reading progress. #30949, #30954 (v1.4.238).
- Mount sessions with saved preferences. #31443 (v1.4.238). The notes do not say which sessions.
- Prevent stale terminal sizing from affecting a newer phone session. #31432 (v1.4.238).
- Settle a restored remote pane whose host session already exited. #31968 (v1.4.238).
- Speed up session updates by indexing stable layout records. #31935 (v1.4.238). This is an index, not the switched-off layout owner.
- File watching rides out a slow system instead of restarting. #32397 (v1.4.239).
- Scope launch-session verdicts to managed environments. #32047 (v1.4.239).
- Targeted resume of a recorded agent session, sharing an in-flight claim with pane resume. #31718 (v1.4.239).
- End a resume claim when the hook store reports it, not at the next claim. #32120 (v1.4.239). The bullet does not contain the word session. It is the follow-up to #31718.
- Include undated Cursor sessions in time filters. #31991 (v1.4.239).
- Restart initial agent-detection probes when their results are invalidated. #32558 (v1.4.240).
- Keep Codex status tied to the main task through `/side` chats after restart. #33275 (v1.4.240).
- Keep a running Codex turn visible on paired and mobile views while `/side` is shown. #33308 (v1.4.240).
- Keep a cold-restored terminal's agent session without showing an old Done status. #33302 (v1.4.240).
- Attribute shared Hermes gateway events to the correct session pane. #33288 (v1.4.240).
- Let branded Pi forks reach launch readiness by setting their initial session title. #28317 (v1.4.240).
- Avoid republishing session tabs on every Codex thread-name spinner tick. #33291 (v1.4.240).
- Restart shell panes in split agent tabs as shells. #32418 (v1.4.240).
- Keep search highlights visible in long session excerpts. #33220 (v1.4.240).
- Group Copilot sessions under their workspace in AI Vault. #31160 (v1.4.240).
- Show workspace names in the resume dialog while workspaces load. #33038 (v1.4.240).
- Save chat renames as the chat's name, so Session History keeps them after the tab closes. #31602 (v1.4.241).
- Offer to resume interrupted chats after a paired or managed server restarts or updates. #28978 (v1.4.241).
- Reconnect an OMP chat when OMP drops its session. #33359 (v1.4.241).
- Keep agent status on a terminal moved into a new tab after a restart. #33601 (v1.4.241).
- Keep Pi in-process subagent sessions from taking over the lead pane. #33595 (v1.4.241).
- Resume Hermes panes after a restart, on the pane's own session. #33514 (v1.4.241).
- Keep a resumed Kimi pane resumable across the next Orca restart. #33489 (v1.4.241).
- Migrate resumed Windows Codex sessions whose transcript path has a `\\?\` prefix. #33558 (v1.4.241).
- Keep Working and Needs You in a phone's session tabs on Windows agents that never set a title. #33614 (v1.4.241).
- Bound folder permission checks while creating terminal sessions. #33643 (v1.4.241).
- Bring saved SSH port forwards back after a restart that reconnects through the host's Orca server. #33388 (v1.4.241).
- New terminals start on a fresh terminal host so that release's terminal fixes apply. Already-open terminals stay on the previous host until closed. #33705 (v1.4.241) and again #34627 (v1.4.243).
- Delete a server-hosted session on the server that owns it. #33906 (v1.4.242).
- Resume a server session whose workspace was deleted, and show previews for remote search hits. #33965 (v1.4.242).
- Stop new terminals inheriting Claude Code's nested-session variables when Orca was started from Claude Code. #10188 (v1.4.242).
- Track terminals and agent sessions on Macs set to other languages and regions. #33898 (v1.4.242).
- Stop a server's idle session-history helper after a minute. WSL hosts get 3 idle minutes and SSH hosts get 10. #33845, #33897 (v1.4.242).
- Keep a WSL host's bridge port across app restarts so it is not re-paired. #33109 (v1.4.242).
- Show a toast when Force Reload is canceled because the session could not be saved. #33941 (v1.4.242).
- Recognize a hand-typed Claude at its startup dialogs. #33826 (v1.4.242).
- Show Claude and Codex panes as waiting while the folder-trust dialog is open. #33804 (v1.4.242).
- Keep MiMo's login and sessions while Orca adds its status plugin. #33668 (v1.4.242).
- List a chat once when Pi and OMP share a sessions folder. #33647 (v1.4.242).
- Pass slash commands an agent says it handles through to the session. #34048 (v1.4.243).
- Keep OMP session titles when a turn finishes, and recognize OMP and Pi tabs by renamed session titles. #34266, #34292 (v1.4.243).
- Stop showing a permission prompt for Pi and OMP sessions named "action required." #34294 (v1.4.243).
- Keep saved sessions for servers that are still saved but hidden from the server list. #34134 (v1.4.243).
- Add Quit and Stop All Sessions to the app menu and tray. #32153 (v1.4.243).
- Keep a renamed tab's name on the phone after the host restarts. #33743 (v1.4.243).
- Resume history sessions from the phone with desktop's resume and host rules. #33943 (v1.4.243).
- Leave Agent Session History on the phone when you resume a session from it. #34485 (v1.4.243).
- Keep an Annotate session going when the page loads an iframe. #24032 (v1.4.243).
- Restart a WSL host's server that vanished after a cold start. #33147 (v1.4.243).
- Close WSL host channels cleanly so a leftover session does not keep the distro running. #34307 (v1.4.243).
- Keep an SSH host's server removed after Stop and remove, across reloads and restarts. #34107 (v1.4.243).

Maintenance lines that only use the words session or restart, with no product change described for us: #31313, #31909, #31923, #30751, #32086, #32149, #32063, #32911, #33048, #33067, #33100, #33121, #33129, #33142, #33189, #33301, #33303, #33324, #33586, #33669, #33939, #34356, #34449. #33067 is a test that stops restarted serve hosts with SIGTERM so the PTY daemon survives.

## Everything else, by release

Items already listed above are not repeated here. Pure CI, docs, and translation chores are skipped unless they change the CLI or serve.

### v1.4.237

Published 2026-10-21. Title in the notes: "100,000 stars. Thank you!"

The short version, verbatim:

- **More done from your phone:** Create and edit notes, save Markdown on headless hosts, follow relative file links, and see embedded images. Buffered terminal drafts can now survive workspace navigation, too.
- **Chats you can come back to:** Codex chats reopen correctly after undo, Claude keeps its rewound context across Orca rollbacks, and screenshots stay with the conversation. Codex’s skill picker now reflects the skills Codex actually loaded.
- **Your work stays protected:** Discard pauses autosave of the same file across workspaces. Read-only Markdown and CSV views protect your unsaved edits, and new, unstaged Markdown documents open straight into the rich editor.
- **Voice beyond the desktop:** Phone dictation works again through headless `orca serve` hosts, with a CLI command to configure the host’s OpenAI key.
- **Smoother remote work:** Reconnect hidden terminal tabs after a restart, keep browser logins when hosts pair again, and search SSH configurations with thousands of hosts without freezing the interface.
- **Small details, better flow:** Phone tabs follow desktop order, landscape layouts show the session title, keyboard controls keep their height, and worktree safety sweeps skip unchanged workspaces.

Other notable items:

- Use Codex's own loaded-skill catalog in chat. Desktop selections identify the exact skill file when names overlap. #30937.
- Reopen Codex chats after undo with the correct conversation history. #31041.
- Show prompts sent mid-turn and `!` commands where Claude actually received them. #31204.
- Keep screenshots dragged into a chat for the lifetime of that chat. #30419.
- Show Working only while Claude, Pi, or ACP is handling work, while keeping Claude chat workers running. #30577.
- Show sleeping native-chat workspaces as asleep. #28457.
- Clarify how to continue conversations between chat and terminal agents. #31402.
- Open new, unstaged Markdown from Source Control in the rich editor. #31399.
- Pause autosave across workspaces during Discard, and stop read-only Markdown or CSV tabs from overwriting unsaved edits. #31413.
- Skip unchanged worktrees during background safety sweeps. #31253.
- Start agent terminals at their first real size without the previous 12-frame wait. #30442.
- Attach to the successful connection when terminal reconnect attempts overlap. #30448.
- Keep the SSH Hosts list searchable with configurations containing 13,000 hosts, and use that picker across host lists. #31405, #31426.
- Give history searches through SSH-connected Orca servers the full all-hosts scan budget, and label the source host. #31226, #31261.
- Open PR, GitLab, and project actions on the host that owns the item when projects share a path. #31252, #31271, #31263, #31290.
- Reject workspace parents that would create a nesting loop. #29340.
- Set `ORCA_WORKSPACE_ID` is not in this release. It lands in v1.4.238.
- Compatibility: exact Codex skill-file selection needs a supporting host. Phone selections and older hosts keep plain-text skill names. Explicit `--surface` needs an updated execution host.

### v1.4.238

Published 2026-10-23. Title: "More connected work, safer edits."

The short version, verbatim:

- **Your edits stay together:** Tabs of the same file share unsaved text across workspaces. Conflict review sees that live text, workspace deletion lists unsaved files, and stale Markdown or notebook edits no longer overwrite newer work.
- **Chats that keep up:** Codex and Pi show turns made outside the chat. Long pastes can become text attachments, Codex questions get answer cards, and OMP gains image sending and actionable plan-review cards.
- **More control over agents:** Pick chat or terminal when creating a workspace, set that choice for your default agent, add Claude and Codex accounts on supported remote servers, and install shared skills for 11 more agents.
- **A more capable browser:** A workspace-aware new tab, address-bar suggestions, remembered site permissions, per-site appearance and zoom, and page-loading progress on desktop and phone.
- **A smoother phone experience:** See agent activity in tabs, rename with a double-tap, scroll back through earlier chat messages, select terminal text more naturally, and return to your terminal reading position after resuming.
- **Better visibility and recovery:** Inspect local terminals in Resource Manager, use plain SSH when a host’s move to an Orca server is blocked, and keep pairings through managed-server updates and recovery.
- **Everyday polish:** Brazilian Portuguese, language selection during onboarding, searchable release builds, clearer history-scan progress, and **Resolve with AI** for paused merges, rebases and cherry-picks—even after file conflicts are fixed.

Other notable items:

- Show turns made outside Orca in an existing Codex chat and an existing Pi chat. #30883, #31618.
- Attach long pastes as text files and flag oversized messages before sending. #30398.
- Codex async questions show an answer card on desktop and phone. #31652.
- Keep newer agent versions and eligible prereleases available for chat. #30393.
- Choose chat or terminal in Create worktree, Create folder, and continuation pickers, and set the default agent to open as a chat or a terminal. #31189, #31590.
- Install shared skills for 11 more agents and stop Qoder listing skills twice. #31657.
- Renaming a terminal no longer hides its running agent. #31428.
- New tab page, address-bar suggestions, per-site permission prompts, per-site appearance and zoom, and a load line on the address bar. #31656, #31604, #31158, #31621, #31597.
- Tabs of the same file share one record of unsaved edits. Conflict review can show that live text. Deleting a workspace lists unsaved files. #31974, #31990, #31641.
- Offer Resolve with AI for a paused merge, rebase, and cherry-pick. #28569.
- Inspect local terminals in Resource Manager's PTYs view and end a selected terminal after host verification. Older hosts refuse unchecked termination. #31593.
- Set `ORCA_WORKSPACE_ID` in every terminal Orca starts, including WSL. #31608, #31668.
- Name what blocks an SSH host's move, offer Move anyway, and open a plain SSH terminal when the move is blocked. #31638, #31716.
- Share this host: only offer addresses the server actually answers. #31447.
- A managed host's "no desktop is sharing its browser" error names the browser routing setting too. #31444.
- Project search works for projects with hundreds of worktrees. #31603.
- Repair only the damaged parts of a profile instead of rolling back the whole profile. #30931.
- HTML preview by default was added and then reverted. #31575, #31893.
- Opt-in launch cancel, approval wait, and process fence on the shared agent writer. The compatibility note says the new optional agent-write controls have no existing callers enabled. #32092.
- Connector configuration is off by default (`experimentalConnectors`). #31757.
- Opening HTML in preview by default was reverted for this release.

### v1.4.239

Published 2026-10-24. Title: "Your workspace, working together." The notes say two releases that day and point at v1.4.238 as well.

The short version, verbatim:

- **Skills, ready wherever you work:** Install Orca’s skills in one click from setup screens, and install or update them on paired servers and SSH hosts with Orca’s own installer.
- **A browser that fits your projects:** Choose shared, per-repo or per-workspace profiles for new tabs. Keep local app logins separate, use a familiar page context menu, and get clearer explanations when a page cannot load.
- **More fluid agent conversations:** Split into a fresh chat beside your current one, continue with a terminal agent from the pane header, and keep queued messages and multiple image attachments intact.
- **Safer edits, quieter background work:** Shared file views stay current after undo and discard. Non-UTF-8 files ask before conversion, file watching recovers after slowdowns, and Orca watches fewer unrelated files.
- **Remote work with a way back:** Recover supported managed SSH servers from a stale lock in Settings, restore terminals after password sign-in, and keep a paired server’s SSH access link through restarts.
- **Better from your phone:** Tapping a notification opens the agent that sent it, agent chat tabs can start dictation, terminal copy commands reach the phone clipboard, and Android scrolling keeps the keyboard out of the way.
- **Everyday polish, across languages:** Better Korean input, Bengali and other Indic terminal rendering, more complete translations, Jira user pickers, and PR comment links that jump straight to the editor.

Other notable items:

- Update Orca's skills with Orca's own installer instead of npx skills, including on paired servers and SSH hosts, and one click on every setup screen. #31688, #31867, #31918. A bundled planner and installer was added earlier and "not wired in yet" (#31662), then these three wire the installer in.
- Chat agents are offered wherever their chat program runs, not only where their CLI is installed. #28709.
- Store each agent's permission itself. Terminals and new chats read it. #31315.
- Explain agent startup failures in plain words. #31932.
- Pair structured launches with the CLI runtime. #32061.
- Per-repo or per-workspace browser profile for new tabs. Shared remains the default. Paired-server pages use the server's own profiles. #32039.
- Chrome-style page context menu and DevTools window shortcuts. #31821.
- Say why a page failed to load and reload it when it can. #31847.
- Open links beside their pane. #31844.
- Split into a fresh chat beside the current conversation, and add terminal-style pane header actions. #28950, #28968.
- Keep queued messages in the chat's own record. #30418.
- A nested `claude -p` no longer takes over its parent pane's status. #31780.
- Show task names for Codex subagents. #32243.
- Recover server for a managed host refused on a stale lock. #32951. The notes also add `--reclaim-stale-lock` for a lock no start can judge after a reboot on a shared home (#32915). Which command owns that flag is unclear.
- Restored SSH terminals recover after password sign-in. #32275.
- Cmd/Ctrl+click opens the clicked path on a paired server when more paths follow. #32411. v1.4.240 reverts the related "open the file link in the workspace it was clicked in" change (#32320 reverted by #33304).
- The browser client advertises the desktop's chat capabilities, so its host opens chats. #32253.
- Open PR comment file:line locations in the editor. #32031.
- Every view of a shared file stays current after undo or discard. Non-UTF-8 files ask before converting. #32413.
- Watch only the files Orca needs in its settings folder and `.git`. #32410.
- Copy OSC 52 terminal writes, such as Claude Code's `/btw` copy, to the phone clipboard. #32042.
- Empty-group launch actions and the child-workspace status toggle were reverted before release. #32182 reverted by #32838, and #32224 reverted by #32842.
- Connector start, follow-ups, pending prompts, and cancel stay behind `experimentalConnectors`. #31805, #31806, #32160, #32961. Reopen a closed or exited agent on its next message is in that same disabled block (B2c, #32119).

### v1.4.240

Published 2026-10-25. Title: "A more dependable workspace."

The short version, verbatim:

- **Conversations that stay with you:** Claude chats now show turns made outside Orca. Retained messages return after reconnect without reopening the chat, and crash recovery no longer guesses that a sent message was undelivered.
- **A browser with a better memory:** Search your browsing history, reopen pages, remove unwanted suggestions, and clear history with Undo. Pages can also use files you pick, save or drop through File System Access.
- **Remote work with fewer interruptions:** Slow connections survive missed wake probes, reconnect notices explain what is happening, SSH terminals wait for sign-in, and new splits stay on the paired server.
- **Agent status you can trust:** Completed Codex subagents stop showing as Working, running main tasks stay visible through `/side` conversations, and Codex MCP tools that require approval get an approval card.
- **More room for your workflow:** Save more than 40 quick commands, find a worktree’s detected dev-server ports with `orca ports`, and reclaim old dependency installs and build output from development worktrees.
- **Polish where it counts:** Lean and Zig highlighting, clearer session-search excerpts, smoother Mac trackpad scrolling in terminal apps, and better protection for unmerged branches and worktrees shared between Windows and WSL.

Other notable items:

- Show turns made outside Orca in an existing Claude chat. #31615.
- Show retained chat messages after reconnect without reopening the chat. #32255.
- Keep sent messages from being falsely marked undelivered after a crash. #30580.
- Show approval cards for Codex MCP tools that require permission. General MCP forms and URL verification are not part of this change. #33310.
- Record Stop immediately and settle subagents when their exit is confirmed. #28051.
- Clear stale Working status for completed Codex subagents. #32937.
- Remove Claude teammates stopped with TaskStop from the sidebar. #32048.
- Keep agent questions visible when a stale program report says Working. #32156.
- Preserve running-agent hook status through idle title repaints. #32195.
- Prevent Claude agent-hook runs from creating phantom subagent rows. #33298.
- Searchable browsing history, removable suggestions, and File System Access for picked, saved, or dropped files. #31846, #32970.
- Refresh browser profiles changed outside the window without a reload. #32723.
- Keep a closed host page from lingering as a window-saved browser tab. #33266.
- Wait for SSH sign-in before starting a terminal opened during authentication. #33072.
- Keep keys typed before a pane's terminal is ready. #33281.
- Report when a terminal has stopped accepting input instead of claiming delivery. #33269.
- Stop paired desktops from republishing mirrored editor tabs. #33259.
- Preserve unmerged branches even when they have no net file changes. #32181.
- Protect worktrees created by the other Git installation on Windows or WSL from pruning. #33103.
- Use the paired server's own repository ID when an SSH row shares its path. #33257.
- Reclaim old dependency installs and generated output across sibling worktrees, manual and automatic, with a default 30-day cutoff. Selected, invoking, and excluded worktrees stay protected. #32331, #33277. The command named in the notes is `pnpm reclaim-space`, not an `orca` command.
- Save quick-command lists with more than 40 entries. #32972.
- Keep Mac trackpad flicks continuous in full-screen terminal apps. #33313.
- History opens from the page menu, or Cmd+Y on macOS and Ctrl+H on Linux and Windows.

### v1.4.241

Published 2026-10-26. Title: "Chats and a browser that behave the way you expect."

The short version, verbatim:

- **Chats that follow your settings:** New chats use each agent’s permission from Settings → Agents, renamed chats keep their names in Session History, and a chat won’t write a conversation a terminal is still running.
- **A browser closer to Chrome:** Dock DevTools inside the pane, mute tabs playing sound, see a link’s URL on hover, and use Orca shortcuts and mouse back/forward inside pages.
- **Watch agents browse:** A cursor and badge show where an agent is clicking or typing, chat jumps you to the page, and links from terminals and chat open beside their source.
- **SSH with fewer dead ends:** Saved port forwards return after a restart and explain failures, certificate-only hosts connect through your system `ssh`, and managed servers update without closing terminals.
- **Agents that start and resume reliably:** Hermes and Kimi panes resume after a restart, Kiro reports status on its V3 engine, and keys typed while an agent starts are kept as a draft.
- **Polish where it counts:** Pick a font for chat, zoom with Cmd/Ctrl + `+` on non-US keyboards, open cloud-only files from macOS terminals, and get steadier Windows terminals and pasting.

Other notable items:

- Start new chats with each agent's permission from Settings, Agents. Settings, Chat no longer has its own permission dropdown. Existing chats keep their saved permission. #32334.
- Dock DevTools inside the browser pane. #33003.
- Speaker icon and tab mute, hovered-link URL bubble, and Orca shortcuts plus mouse back and forward inside pages. #32981, #32978, #31859.
- Show agent browsing live, with a jump to the page from chat. Open browser links beside their source. #33075, #32907.
- Ask before sites use the local network. #33399.
- Keep keys typed into a starting agent pane as an unsubmitted draft. #33315.
- Make flagged `--command` agent launches wait for the agent's screen to be ready. #33466.
- Skip Codex's startup update prompt when Orca launches Codex. #33355.
- Show Needs You while a Claude MCP elicitation dialog is open. #33517.
- Refuse model picks on OpenCode 2.0.14, 2.0.15, 2.0.17, and 2.0.18, which leave the first message unsent when a model is picked. #33436.
- Pre-trust the folder for Kimi Code so its trust menu does not swallow the prompt. #33411.
- Report Kiro status on Kiro's V3 engine. #33660.
- Add Update and Update anyway for a managed SSH server, keeping its running terminals. #33397.
- Show saved SSH port forwards that could not start, with the reason. #33450.
- Retry over system ssh when the built-in client shares no algorithm with the host. #33680.
- Let macOS terminal shells download cloud-only files. #33623.
- Keep desktop terminal history after a phone opens the terminal. #33537.
- Reopen a slept agent whose tab is gone in a fresh tab instead of stranding it. #33598.
- Keep Orca CLI commands working in sandboxes that deny chmod. #33662. Which commands is unclear.
- Custom font family setting for chat. #33687.
- The macOS terminal host was built on a patched Node to recover stalled workers, then returned to official Node, keeping stall telemetry. #29133, #33688.
- Honour Claude Code's rejected `ANTHROPIC_API_KEY` setting in chats. #33346.

### v1.4.242

Published 2026-10-27. Title: "Lighter on memory, Claude subagents a click away, and remote servers that remember."

The short version, verbatim:

- **Open Claude subagents from the sidebar:** Click a Claude subagent row in the sidebar or dashboard to open its transcript in the same terminal, then click the parent to go back. An eye marks the one you’re viewing.
- **Chats that ask first:** Codex chats in Ask mode now ask before editing your workspace, remote Claude terminals on paired servers can continue in Chat, and chats that can’t start tell you why.
- **Agents resume as you left them:** Resumed Claude sessions keep their effort level and launch flags, Codex keeps the permission you last gave it, and Session History finds chats in more folders and on servers.
- **Remote servers that remember:** Paired servers keep your tabs across restarts, closed tabs stay closed, WSL hosts stop re-pairing after each restart, and SSH failures say what actually went wrong.
- **Lighter on memory:** Terminals use far less idle CPU, the terminal host uses less memory once it next restarts, WSL connections need much less memory, and the resource panel now matches Activity Monitor on macOS.
- **Fixes from the community:** Spaced Windows launcher paths, Korean input, DST in automations, focus-follows-mouse, tab dragging and Linux packages all work better.

Other notable items:

- Open a Claude subagent's view from the sidebar or dashboard. On by default with Claude status hooks. Orca adds one shortcut, the first free of Ctrl+Alt+G, H, or V, to `keybindings.json` in each Claude folder it uses. Turn it off in Settings, Agents, Claude subagent navigation. Sessions already running need a fresh launch. #33322. v1.4.243 removes the eye icon (#34558). The viewed row then uses the normal current-row highlight.
- Ask before Codex workspace edits in Ask mode. Approve for me and Full access are unchanged. Chats on a paired server keep the old behavior until that server is updated. #31299.
- Say why Claude refused to start a chat, including Full access while running as root. #33812.
- Show a start failure after one try when the agent's answer can never succeed on a retry. #33685.
- Make Stop pause Codex goal work. #33631.
- Keep agents you set separately when you pick a permission for all agents. #33018.
- Detect Grok CLI installed only in `~/.grok/bin`. #25324.
- Let Codex's stricter Windows sandbox read Orca's managed Codex folder. #33748.
- Stop a Codex run inside a Claude background job from labelling the Claude pane as Codex. #24641.
- Inspect idle local shell panes less often, and cap the terminal host's short-lived memory. #33829, #33837. The memory cap applies once the terminal host next restarts.
- Start every terminal through one path, so simultaneous starts from the window and the CLI or phone share one result. #32076.
- Open another client's terminal under its own tab instead of a second copy. #33978.
- Answer terminal queries in output sent just as a paired terminal is paused, so fish does not freeze. #33749.
- Stop several macOS terminals opened at once from waiting 3 seconds for a shell. #33833.
- Repaint Codex and Claude Code over the skipped-hidden-output notice. #33835.
- Show what SSH said when Connect never reaches the host, and say why an SSH host failed in the Add project host picker. #33928, #33992.
- Add a per-host Reconnect on launch toggle for SSH hosts. #33935.
- Keep remote file drops out of git. #33831.
- Show Activity Monitor's memory footprint on macOS in the resource panel, and count the terminal host. #33901.
- Refuse to delete or edit a workspace or setup whose id exists on two machines unless the machine is named. #33818.
- Forget each restored workspace's last machine once that machine answers. #33863.
- List a host's terminal agents again when it comes back. #33816.
- Warn once, not every 30 seconds, when Linux will not keep the laptop awake for agents. #24839, #33841.
- Connect to WSL host servers through bash instead of Node, using far less memory. This needs no server update. #33820.

### v1.4.243

Published 2026-10-28. Title: "Chrome extensions in Orca's browser, iPhone Duo support, and Convert a terminal agent session live into a chat ui."

The short version, verbatim:

- **Chrome extensions (experimental):** Add extensions from the Chrome Web Store with **Add to Orca**, so password managers like Bitwarden and 1Password can fill logins in Orca’s browser. Off by default.
- **Convert a terminal agent session live into a chat ui:** Once you quit Claude or Codex in a terminal, the same conversation can continue in Chat while the terminal tab stays open. Claude chats also keep their saved approval choice across model changes, and closing a chat that’s still working asks first.
- **Worktrees sooner after a restart:** Local worktrees load before terminals restore, and the sidebar says discovery is still running instead of showing an empty list.
- **Steadier terminals:** Windows terminals keep their history through width changes, slept terminals wake in the folder you left, macOS’s built-in bash keeps command tracking in order after a DEBUG trap change, and copying from pi on a remote host reaches your clipboard.
- **Orchestration:** Choose the worker heartbeat interval or turn heartbeats off, and reduce CPU use by stopping settled workers from polling for commands.
- **Polish where it counts:** Compact native-style menus, VS Code–style Markdown highlighting with sticky headings, and update checks through your Settings proxy.
- **Fixes from the community:** Quit and Stop All Sessions, math in chats, Copy Remote URL with line ranges, IME highlighting in terminals, fnm on Windows, and Japanese and Chinese translations all work better.

Other notable items:

- Install Chrome extensions from the Chrome Web Store (experimental, off by default). Turn on Settings, Experimental, Browser extensions, then restart. Extensions run in local browser profiles only. Ad blockers install but do not block yet. Some extensions, such as Tampermonkey, do not work. #30940.
- Import cookies without signing the browser out of sites. #34113.
- Scroll off-screen elements into view before agent clicks and hovers. #34262.
- Deliver agent clicks and keys to pages that loaded while their pane was hidden. #34291.
- Paste the local clipboard into streamed browser pages, and copy or cut back to the local clipboard. #34269, #34290.
- Type text that starts with a dash literally in browser commands. #34289.
- Continue a conversation in Chat once its terminal agent has exited, while the terminal tab stays open. #33759.
- Keep a Claude chat's saved approval choice across model changes. #34031.
- Ask before closing a chat that is still working. #34236.
- Hand off a chat tab's work to another agent from its right-click menu. #34504.
- Stop hidden chats re-rendering on every tab change. #34020.
- Keep the Codex app's bundled plugins available in Orca-managed Codex homes. #33621.
- Tell agents about Orca's public-link publishing only when it is turned on. #34547.
- Show local worktrees at startup before terminals restore, and say while discovery is still running. #34331.
- Wake a slept terminal in the folder you left it in. #34172.
- Stop a woken terminal's prompt showing twice after a relaunch. #34060.
- Keep Windows terminal history intact when the width changes. #34061.
- Copy from pi's full-screen view on a remote host to your own clipboard. #34102.
- Keep keys typed into a brand-new WSL or paired-server terminal before its shell starts. #33859.
- Keep a background tab whose program exited restorable, instead of treating it as closed by you. #34083.
- Keep WSL terminal tabs and their history when the distro shuts down or crashes. #34095.
- Open, edit, and save host files outside workspaces from a paired desktop. #33958, #34119.
- Send update checks through the proxy set in Orca's Settings. #34276.
- Pin fallback updates to one release so a download cannot look for a file in a newer one. #34076.
- Stop macOS port scans from piling up stuck processes and freezing the Ports panel. #32045.
- Show servers started in a symlinked workspace under that workspace in Ports. #33730.
- Let End in the Resource Manager stop terminals that have no tab. #34040.
- Read macOS memory footprints with a small bundled helper instead of top. #34053.
- Make context and tab menus compact and native-style. #34543.
- The server build uses Node 24 and the notes say it preserves older host compatibility. #34177. What "older host compatibility" covers is not spelled out beyond that line.
- Same-machine folders with matching Git remotes in separate projects was reverted before release. #32272 reverted by #34662.
- Sizing tabs to their titles was reverted later in this release. #34025 reverted by #34506.
- Slack and Discord connector work in the maintenance list is groundwork. The notes do not say it is on for users.

## CLI changes

Every `orca` command or flag the eight releases name. Where the notes do not name the parent command, that is marked unclear.

- `orca speech openai-key status`, `orca speech openai-key set`, `orca speech openai-key clear`. `set` reads the key from stdin. Headless dictation. #31230 (v1.4.237).
- `orca agent launch --surface chat` or `--surface terminal`, and the same `--surface` on agent-backed `orca worktree create`. Omitting `--surface` keeps existing defaults. An explicit value needs an updated execution host. #31191 (v1.4.237).
- `orca account add` is not new. Windows servers and older hosts still show it instead of the paired-desktop Add Account flow. #31461 (v1.4.238).
- `--reclaim-stale-lock` for a lock no start can judge after a reboot on a shared home. #32915 (v1.4.239). The parent command is unclear. The user-facing recovery in the same release is Settings, Recover server, for a supported managed Linux SSH host.
- `orca ports`, with workspace selection and JSON output. Native folder workspaces require `--all` to list the host's listeners. Direct SSH hosts do not support detection yet. #33016, #33055 (v1.4.240).
- `orca orchestration check --wait` may start while an older wait is still waiting. #33013 (v1.4.241).
- Flagged `--command` agent launches wait for the agent's screen to be ready. #33466 (v1.4.241). The notes say "flagged `--command`" and do not restate the full command. It sits in the agent-launch section.
- `orca agent hooks` works on headless Orca servers. #33700 (v1.4.241). This is a fix, not a new command.
- `orca terminal list` and `orca terminal show` include a terminal's orphaned state in plain output. #33910 (v1.4.242).
- Empty `--terminal` and `--from` handles are rejected instead of falling back to defaults. #16745 (v1.4.242). Which commands take them is unclear from the bullet. Our orchestration calls use `--from`.
- Browser fill and select commands accept an empty `--value`. #16030 (v1.4.242). The bullet does not print the full command names.
- `orca terminal read --screen` is taught to agents, and two `orca --help` lines are fixed. #15893 (v1.4.242).
- The split `--direction` wording in the CLI guide agents read is corrected. #9038 (v1.4.242). The guide change is docs. The flag itself is not described as new.
- `orca environment add` shows the new server in every window right away. #33930 (v1.4.242). Behavior change, not a new flag.
- `orca set media --reduced-motion`, and unknown values are rejected. #34253 (v1.4.243).
- `orca wait --timeout` is passed through to the browser driver. #34283 (v1.4.243).
- Browser commands type text that starts with a dash literally. #34289 (v1.4.243). Which type command is unclear.
- `orca orchestration reset --tasks` keeps a record in each Run of what it cleared. #28823 (v1.4.243).
- The CLI targets the calling terminal's own workspace in folder projects. #33703 (v1.4.243). No new flag is named.
- Docs say `terminal send --text` writes control bytes verbatim. #14037 (v1.4.243). The bullet writes `terminal send --text`, not a longer command line.
- `--resize-at` resizes a PTY mid-capture. #33781 (v1.4.242, under tests and tools). The notes do not say this is a user `orca` command. Unclear.
- `pnpm check:changed` becomes the single pre-handoff check. #33432 (v1.4.241). This is a repo script, not an `orca` command.
- `pnpm reclaim-space` reclaims old worktree installs. #32331 (v1.4.240). Not an `orca` command.

No release in this range adds `orca account auto-switch`, `orca account use`, or a statusline flag.

## Open upstream items we track

Read on 2026-10-28 from GitHub. Nothing was opened, edited, or commented on.

- PR #28044, open. Title: "feat(claude-accounts): switch accounts before a usage limit." https://github.com/stablyai/orca/pull/28044
- PR #29060, open. Title: "feat(claude-accounts): turn on account auto-switch for a remote server's accounts." https://github.com/stablyai/orca/pull/29060
- PR #28684, open. Title: "feat(accounts): keep a Claude or Codex agent on its account." https://github.com/stablyai/orca/pull/28684
- Issue #20512, open. Title: "[Feature]: Automatic account failover on rate limit for managed Claude/Codex subscription accounts." https://github.com/stablyai/orca/issues/20512
- On issue #20512, maintainer AmethystLiang wrote "Looking into this" on 2026-10-28 (comment time 2026-10-28T05:47:03Z). The comment body is that phrase plus an eyes emoji.

These four are not in the v1.4.236 to v1.4.243 release notes. The shipped account-switch restart fixes in v1.4.241 through v1.4.243 are separate pull requests, listed above. They do not close automatic failover.
