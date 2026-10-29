# Brief: Claude account switch / session mover leave "monitoring" sessions behind

Repo: this worktree (`A2Z-Operations/orca`, branch `blowzer/session-mover`). Commit as
`Nachumi Eliyahu <nachumi@a2zoperations.com>` only, no Co-Authored-By or AI trailers.

## Bug (observed 2026-10-29 on the MacBook, 1.4.244-blowzer.2)

After "Switched to <account> → Restart session(s)", four Claude sessions restarted and
three never did. The three all have this hook status (agent-hooks/last-status.json):
`payload.state = "working"`, `payload.workingMode = "monitoring"`,
`payload.mainAgent.state = "done"`, `claudeRunningNonAgentTask = true`. The main agent is
idle at its prompt; only a background shell/monitor keeps the pane in `monitoring`.

Two gates treat anything other than `'done'` as mid-turn, so these sessions wait forever:

1. `src/renderer/src/lib/claude-session-account-move.ts` → `isClaudePaneMidTurn`
   (`entry.state !== 'done'`). Used by pane-account-restart-readiness.ts and
   codex-detached-pane-restart.ts.
2. `src/main/claude-accounts/claude-session-mover-policy.ts` ~line 130
   (`inputs.paneState !== 'done'` → `wait: mid-turn`). `paneState` comes from
   `collectClaudeMoverSessions` in claude-session-mover-sessions.ts, which maps
   `AgentHookStatusChangeEntry.state` (server-types.ts:61, carries only `state`).

## Required change

Define "mid-turn" as: the MAIN agent is not done. A pane whose `mainAgent.state === 'done'`
is restartable even when the pane-level state is `working` with `workingMode === 'monitoring'`.
Keep `working`, `blocked`, `waiting` (permission prompt / question) as mid-turn when
`mainAgent` is absent or not done.

- Renderer: change `isClaudePaneMidTurn` to
  `entry.agentType === 'claude' && (entry.mainAgent ? entry.mainAgent.state !== 'done' : entry.state !== 'done')`.
  Extend the test in `claude-session-account-move.test.ts` (`describe('isClaudePaneMidTurn')`)
  with a pane `{state:'working', workingMode:'monitoring', mainAgent:{state:'done'}}` → false,
  and `{state:'working', mainAgent:{state:'working'}}` → true.
- Main (mover): give the mover the same view. Either add an optional `mainAgentState`
  to `AgentHookStatusChangeEntry` filled by `getStatusChangeSnapshot()` in
  server-listeners.ts:303 from the payload's `mainAgent`, or resolve it per pane via
  `getStatusSnapshotForPane`. Then in `collectClaudeMoverSessions` set
  `paneState` to the main agent's state when present. Add a policy test in
  `claude-session-mover-policy.test.ts` (monitoring + main done → not `wait:mid-turn`)
  and a sessions/lifecycle test showing the view carries the main-agent state.
- Do not change what counts as mid-turn for Codex.

## Verification

`npx vitest run src/renderer/src/lib/claude-session-account-move.test.ts src/main/claude-accounts` and
`npx tsc --noEmit -p tsconfig.web.json` / `tsconfig.node.json` (whichever the repo uses; see package.json).
Report: files changed, test output, commit hash. Do not push.
