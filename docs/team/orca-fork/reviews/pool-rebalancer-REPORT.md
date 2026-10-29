# Pool rebalancer — early proxy moves

Date: 2026-10-29. Branch: `nachumi-a2zoperations/pool-rebalancer`, on top of `f050bb3b07a` (the phase-2 briefs commit, whose parent is `blowzer/session-mover` at `a9d2f353274`). Not pushed.

## What it does

`decideClaudeSessionMove` takes `pool: { enabled, spreadLine }` and `turnEndedAt`. When the pool is on and this session is a proxy session (`spreadLine`), it may move before the 95/90 lines. The move happens when the session's own headroom is strictly less than the best other account's headroom minus `CLAUDE_POOL_REBALANCE_GAP_PTS` (25), and that best headroom is at least `CLAUDE_POOL_REBALANCE_MIN_TARGET_HEADROOM` (30). Headroom is the same `claudeAutoSwitchHeadroom` number the hard line uses (nearest window: line minus used percent).

`enabled` is `getSettings().claudeAccountPool === 'on'`. `spreadLine` is true only when the pane registry has a `proxySlot` and the proxy move strategy is installed. A resume-strategy session leaves `spreadLine` false and keeps the 95/90 lines. A pinned session is not rebalanced. A session already over the hard line, or at the limit, takes the existing path and the decision has no `reason: 'rebalance'`.

The rebalancer waits `CLAUDE_POOL_REBALANCE_COOLDOWN_MS` (15 minutes) per pane, measured from the last move. A failed move still uses the one-minute failure hold. The existing target claim (60 seconds) and 5-point debit still run, so one tick cannot put every pane on the same account. After the claim window, the debit keeps ranking the target as if those turns had already been spent.

A proxy flip costs one cache miss. A pane whose hook status says the last turn ended under `CLAUDE_POOL_REBALANCE_QUIET_MS` (2 minutes) stays, unless it is already over the hard line. A pane that is not `done` is not rebalanced either, including when `allowMidTurn` would let a hard-line proxy move proceed. A done pane with no `turnEndedAt` may rebalance. That stamp is copied onto `AgentHookStatusChangeEntry` the same way `mainAgentState` is, and the session view carries it into the decision.

A rebalance is recorded as reason `rebalance` on the mover's decision list (in flight and after it settles). The notice kind stays `moved`, with `balance: true` and `restartless: true` when the pty id did not change. Desktop copy is `accounts.claude.sessionMover.rebalanceBody`: "{{from}} continues on {{to}} to balance your accounts." Orcad uses the same sentence without the i18n key. An `ask` setting asks first and sets `balance` on that notice too.

## Seams

Task 1 owns `claudeAccountPool` on the settings type, the default, and launch selection. This change does not edit those files. The mover deps intersect `claudeAccountPool?: 'off' | 'on'` onto `getSettings()`. Absent means off, so nothing rebalances until Task 1 writes the setting and turns it on. The name matches the plan (`'off' | 'on'`).

Task 3 owns the settings row, CLI, badge, and the seven locales. English is in `en.json`. The other catalogs do not have `sessionMover` entries today; they fall back to the inline default, as they do for `movedRestartlessBody`. `verify:localization-extraction` exited 0.

The auth proxy itself is unchanged. A rebalance calls the existing proxy strategy, which flips the slot and keeps the pty.

Hard-line proxy moves keep the 5-minute session cooldown, and a session at 100% still skips that cooldown. The 15-minute window applies to rebalance only, so a pane that just spread can still leave an account that then crosses 95%.

## Tests

`~/.n-orca/bin/pnpm exec vitest run --config config/vitest.config.ts` (pnpm 12.14.0). `corepack pnpm` cannot find `pnpm.cjs` on this Mac, the same failure the proxy report hit.

- `claude-session-mover-policy.test.ts` — gap, best-account floor of 30, pool off, resume (`spreadLine` false), pinned, live turn, two-minute quiet, missing `turnEndedAt`, hard line during the quiet window, 15-minute rebalance cooldown, 5-minute hard-line cooldown, limit bypass, failure hold, claimed target, debit that closes the gap, stale candidate read, no read during the quiet window.
- `claude-session-mover.test.ts` — resume and pool-off stay on the old lines; a proxy session rebalances, keeps the pty, and the notice is `balance`; `ask` asks and does not flip; the quiet window then the move.
- `claude-session-mover-lifecycle.test.ts` — three panes on account b at 60%, c at 5%. One pane moves per 60-second target claim. After the third move all three are on c. Another 15 minutes produces no further move and every decision is `stay`. The resume strategy is not called.
- `claude-session-mover-sessions.test.ts` — `turnEndedAt` is carried from the hook status.
- `server-turn-ended-at.test.ts` — a relay end of 42 is on the status-change snapshot, not only the stored row.

5 files, 56 tests, passed.

`pnpm run typecheck:node` exited 0. Web and cli typecheck were not run; the TypeScript edits are in the node project. `oxlint` on the edited sources reported 0 warnings.

## Not covered

No live five-account run. The pool setting cannot be turned on from Settings or the CLI until Task 1 and Task 3 land, so a packaged build of this branch alone will not rebalance. Windows, WSL, and SSH hosts are unchanged. The proxy still does not retry upstream or buffer bodies; that is Task 7.
