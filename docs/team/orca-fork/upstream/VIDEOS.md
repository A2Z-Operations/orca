# Video shot list

Do not record these as part of Task 13. Do not commit the files. Each take is at most 60 seconds. Setup happens before the recording starts. Attach with the `gh image` extension, or drag the file onto the issue or PR. The pull request template forbids putting the file in the diff.

Stock takes use Orca **1.4.243** (tag `v1.4.243`), unmodified. After takes use the fork build that contains that PR and nothing later, except M0 and M1, which are recorded once on the full fork and reused.

| Id | Take | Attached to | Build |
| --- | --- | --- | --- |
| B1 | Monitoring pane skipped on account switch | Issue 1, PR 1 before | Stock 1.4.243 |
| B2 | No pane account, usage follows the selected account | Issue 2, PR 2 before | Stock 1.4.243 |
| B3 | Limit stops the turn; restart kills the background log | Issue 3, PR 3 before | Stock 1.4.243 |
| B4 | Restart changes the Claude pid | Issue 4, PR 4 before | Stock 1.4.243 |
| B5 | New panes all launch on the selected account | Issue 5, PR 5 before | Stock 1.4.243 |
| B6 | Background command dies with Claude | Issue 6, PR 6 before | Stock 1.4.243 |
| B7 | Plugin host has no account list | Issue 7, PR 7 before | Stock 1.4.243 |
| A1 | Monitoring pane restarts once the main agent is idle | PR 1 after | PR 1 branch only |
| A2 | The pane's own account keeps the usage reading | PR 2 after | PR 2 branch, or later |
| M0 | Proxy move, same process, same scrollback | PR 3 after and PR 4 after | Full fork, proxy on |
| M1 | Five pooled panes, then one rebalance | PR 5 after | Full fork, pool and proxy on |
| A6 | Background log keeps growing across a resume | PR 6 after | PR 6 branch, or full fork |
| A7 | Example plugin prints labels and percents | PR 7 after | PR 7 branch |

M0 and M1 are the after footage for PRs 3, 4, and 5. Record each once. PR 3 gets M0 (the session continues in the same pane). PR 4 gets the same M0 (the process does not restart). PR 5 gets M1. M0 is also the shape of the move inside M1, so a reviewer of PR 5 who wants the single-pane case watches M0.

Film in this order: B1 through B7 on one stock install, then A1, then A2, then M0, then M1, then A6, then A7. B3 and B4 are the same moment; film B4's pid read in the same minute as B3 if the first take did not already show `ps`.

Shared prep, off camera, before any stock take:

- Two Claude accounts signed in. Call them A (nearly full, or already at the limit for B3) and B (room left). Do not show email addresses if the take will be public. Crop the account menu to the display names.
- A local git workspace. Claude Code in a terminal pane, not native chat. Native chat is not what these PRs move.
- A second terminal somewhere the viewer can read, for `ps` and `tail`. The Orca terminal is fine if the font is large enough.

## B1 — before, issue 1

**Open:** the stock app, two Claude tabs. Tab 1 has Claude's prompt back and a background `sleep 600` still running (pane shows monitoring). Tab 2 is idle at Claude's prompt. Running-session switch is **Always restart**.

**Type:** nothing in the panes. Use the status-bar account control and switch from A to B.

**Viewer must see:** tab 2 restarts onto B. Tab 1 stays put, status still Working, old scrollback intact. Wait until the end of the minute so it is obvious the second restart is not coming.

**Do not:** turn on any fork build. Do not crop away the Working state.

## B2 — before, issue 2

**Open:** stock app. One Claude pane that launched on A. Selected account is already B, and the earlier switch was **Keep as is**. Usage popover closed.

**Type:** in the Claude pane, `reply with one word`. Then open the Usage popover.

**Viewer must see:** the tab has no account label. The popover is B's. The reading that just updated is not filed on A.

**Then, still inside the minute:** cut, or a second short clip if the cut will not fit, to a headless `orca serve` with no window. Show `orca account list --json` and a second run whose Claude `usedPercent` did not move. If the two runs cannot fit, drop the desktop beat before you drop this one, and say in the PR that the desktop beat is the popover.

## B3 — before, issue 3

**Open:** stock app. One Claude pane already showing the usage-limit message. A side terminal `tail -f` on a file the background command is still appending to.

**Type:** switch to B and confirm **Restart session**.

**Viewer must see:** the limit message, the tail still moving, then the pane restarting, then the tail stopped.

## B4 — before, issue 4

**Open:** same layout as B3, plus `ps` showing the Claude pid, and one distinctive word already in the scrollback (`lighthouse` is enough).

**Type:** switch accounts and restart, if B3 did not already do it. Otherwise this take is only the before-and-after pid.

**Viewer must see:** the pid before, the word `lighthouse`, the pid after. The second pid is different. The word is gone or the pane has clearly redrawn.

If B3 already showed both the dead log and the new pid, do not record B4. Attach B3 to issue 4 as well and write that in the PR.

## B5 — before, issue 5

**Open:** stock account list or the account menu, with A selected and B having more room. No Claude panes yet.

**Type:** start two Claude panes. Say, once, that the other three do the same. Two launches fit in a minute. Five do not.

**Viewer must see:** both panes come up on A (the selected account), even though B has more room. No account chip on the tabs.

## B6 — before, issue 6

**Open:** stock app. Claude already running a background command that appends a timestamp every second. Side-by-side: `tail -f` of that file, and `ps` showing the command's parent is the Claude pid.

**Type:** restart the session from the account-switch dialog.

**Viewer must see:** timestamps arriving, then the restart, then the tail frozen and the child pid gone.

This is the same death as B3, filmed so the parent pid is readable. Skip B6 and point PR 6 at B3 only if B3 already shows the parent pid and the frozen tail. Prefer a dedicated B6. The reviewer of the jobs PR should not have to infer the process tree from the usage-limit story.

## B7 — before, issue 7

**Open:** the stock 1.4.243 source, `src/main/plugins/plugin-host-methods.ts`, in an editor with the font large enough to read the method names. Or the in-app plugin developer surface, if it lists host calls.

**Type:** nothing, or a find for `account` that lands on no Claude usage method.

**Viewer must see:** the host calls that exist, and no list of Claude accounts, no usage windows, and no session-moved event.

## A1 — after, PR 1

Record this on `pr/claude-monitoring-pane-restart`, not on the full fork. The full fork waits up to 10 minutes while a background command is alive, which looks exactly like this bug.

**Open:** that branch's build. Same two panes as B1. Running-session switch **Always restart**. Session mover off, if the branch even has the setting. It should not.

**Type:** switch accounts.

**Viewer must see:** the idle pane restarts, and the monitoring pane restarts too, while its background sleep is still the thing it was watching. The main agent was already at the prompt before the switch. A pane left genuinely mid-turn (a question dialog open) must not appear in this take.

## A2 — after, PR 2

The tab chip is PR 5. Do not wait for a chip in this take.

**Open:** PR 2's build, or any later build. One Claude pane launched on A. Selected account B. **Keep as is** so the pane was not restarted.

**Type:** `reply with one word` in the pane. Open the usage UI for A, not the status bar's selected account.

**Viewer must see:** A's numbers move because of that pane. B stays the selected account on the status bar.

**Headless beat, if it fits:** `orca serve` with no window, mover or pool left at the default that turns polling on, two `orca account list --json` runs. The second Claude usage snapshot changed, or a fresh fetch time did. If it does not fit, record it as its own 30 second clip and still call it A2. The cap is per take.

## M0 — after for PR 3 and PR 4

One recording. Proxy on, session mover set to **move**, pool off so the reason is the usage line and not a rebalance. Prep the billed account up against the move line before the recording. Do not edit the policy constants in the build you record. If the line will not trip, do not fake the notice with a caption.

**Open:** one Claude pane. The word `lighthouse` is already in the scrollback. A side `ps` shows the pid. `orca account moves` has been run once so the viewer knows the shape of an empty or older list.

**Type:** nothing, if the move fires on its own within the minute. Start the recording when the next usage refresh is about to be evaluated, not while waiting for a window to fill.

**Viewer must see, in this order:**

1. The notice that the session continues on the other account **without a restart**. The text is "{{from}} is near its usage limit. The session continues on {{to}} without a restart."
2. The same pane, same scrollback, `lighthouse` still on screen. No shell prompt in between. No `claude --resume` flash.
3. `ps` still showing the same pid.
4. `orca account moves` printing one new line: same pty id, strategy `proxy`, from the full account, to the one with room.

If step 4 falls past 60 seconds, stop the pane recording at step 3 and attach a separate 15 second terminal clip. Label both M0.

This is the after video on PR 3 and on PR 4. PR 3's resume path (process replaced, hand-off note in the pane) is real, and it is not this clip. If a reviewer asks for the resume, record an extra take with the proxy off: the pane gets one note naming the account it left, the subagents the restart ended, and the background work that was still running. That extra take is not M0 and is not required to open the PR. Say in the PR body that M0 is the proxy end state.

## M1 — after for PR 5

One recording. It doubles, with M0, as the after set for PRs 3–5. M1 itself is attached to PR 5.

Prep, off camera, before the minute starts:

- Pool on, proxy on, mover on **move**.
- Five Claude panes already open. They already sit on more than one account, because the pool placed them. The tab chip shows a short label on each.
- One pane's account is full enough, and another account is empty enough, that one rebalance is due. That pane's last turn ended more than two minutes ago. Its rebalance cooldown is clear.
- Do not launch the five panes on camera. Five launches do not fit in 60 seconds, and the decision is visible without them.

**Open:** the workspace with the five tabs visible, chips readable. `orca account list` visible in a side terminal, `pool: on`, session counts not all on one account.

**Type:** nothing. Start when the rebalance is about to be decided.

**Viewer must see:**

1. Five panes, five chips, counts spread across accounts.
2. One notice: "<from> continues on <to> to balance your accounts."
3. That pane's chip changes to the destination. The other four chips stay.
4. The scrollback of the moved pane does not reset. Same process, same as M0.
5. `orca account moves` shows one new line for that pane, reason rebalance, strategy proxy, same pty id.

If the notice and the `account moves` line cannot both fit, keep the notice and the chip change. Attach the command output as a second clip under 15 seconds, still part of M1.

## A6 — after, PR 6

**Open:** a build that has durable jobs. A background command is already appending a timestamp every second. Side terminal: `tail -f` the file, and `orca job list` showing the id.

**Type:** restart the Claude session (account switch with the proxy off, so the process is actually replaced, or `claude --resume`). Then `orca job logs --id <id>` for a couple of lines.

**Viewer must see:** the Claude pane restart, the timestamps keep arriving through the restart, and `orca job logs` prints lines from after the restart. The job id is the same one `orca job list` showed before.

Do not use a command that finishes during the take. A ten-minute sleeper that only writes timestamps is the right fixture.

## A7 — after, PR 7

**Open:** the example plugin from PR 7, already installed in this build, and two Claude accounts that have usage numbers.

**Type:** whatever the example's docs say to load it. One command.

**Viewer must see:** printed labels, a used percent, and a session count. Scroll the output slowly enough to see there is no token, no `sk-ant`, and no credential path. If the example can also show a move, skip that. M0 already covers the move. This take is only the read.

## What the viewer must never see

- Account emails, if the video will be public. Crop to the short label.
- Credential files, proxy tokens, or `Authorization` headers. M0 may show `ANTHROPIC_BASE_URL` host and port. It must not show a bearer token. Prefer the pid and `orca account moves` over `ps -E`.
- A build where the policy percentages were hand-edited.
- The monitoring-pane fix filmed on the full fork with the mover's background wait left on. That is A1's trap.
