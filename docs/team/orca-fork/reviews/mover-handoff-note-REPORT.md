# Mover handoff note

Date: 2026-10-29. Branch: `nachumi-a2zoperations/mover-handoff-note`. Not pushed.

Implementation commit: `89e8db05f0a2d8f8a619fda72476dd6ba64b1e17`

## What shipped

After a successful `claude --resume` move, Orca writes one message into the new PTY:

> Orca moved this session from \<from email\> to \<to email\> because \<detail\>. The restart ended any background jobs and subagents of the previous process (\<what the pre-move hook row knew\>). Re-run what is still needed, then continue.

The detail is the same window string the ask notice uses (`session 96%`). The known-work list is, in order: `monitoring` when that was the working mode; `a background task was still running` when `claudeRunningNonAgentTask` was true; then subagents as `agentType id (state)`, idle last, 12 at most, then `and N more`. An empty list says `none reported`.

The move still settles as moved when the note is not sent. A spawn failure does not write.

## Readiness

The pane is already `done` on the resumed session id before the restart, so that row is not readiness. Before spawn, the strategy records the highest `receivedAt` on the pane. It writes only after the hook server has both:

- a provider-session identity for that pane and the resumed session id, and
- a non-`providerSessionOnly` row with `state === 'done'`, `receivedAt` strictly above the baseline, and `providerSession.id` equal to the resumed session id.

`providerSessionOnly` rows, including a launch resume seed, do not count.

## Fallback

Polls every 250ms for up to 30s. A visible screen whose last line is a shell prompt (`$`, `#`, or a `%` that is not a percentage, or OSC 133 A without Claude's composer marker) is never written, even when the hooks say ready. With no hook-ready row, the note is written only when the visible screen matches the Claude composer scanner (`\x1b[?2031h` then `❯` + NBSP). An empty or ambiguous screen is left alone. A missing screen does not block a hook-ready write, so a hidden headless PTY still gets the note.

The write is one `RuntimePtyController.write` of a bracketed paste plus `\r`, `inputKind: 'orchestration'`, on the new PTY id. `write` returning false leaves the note unsent. There is no retry.

## Where the facts come from

`evaluateClaudeMoverSessions` captures the pre-move snapshot (`workingMode`, `subagents`) plus `AgentHookServer.getClaudeRunningNonAgentTask`. That boolean stays off the IPC status payload. The capture is passed on the move request and copied onto the `moved` outcome as `endedWork`, with `handoffNote: 'sent' | 'unsent'`.

No new setting. Desktop and orcad both go through `createProviderClaudeSessionMover`, which now passes the hook server and `translateMain`. Headless `ask` still acts as `move`. The English catalog keys live under `accounts.claude.sessionMover.handoff`. `translateMain` returns the raw fallback before i18n init, and the note builder fills `{{placeholders}}` itself.

## Checks

`pnpm tc:node` passed.

`pnpm exec vitest run --config config/vitest.config.ts` on:

- `src/main/claude-accounts/claude-session-move-handoff-note.test.ts`
- `src/main/claude-accounts/claude-session-mover-lifecycle.test.ts`
- `src/main/claude-accounts/claude-session-move-strategy.test.ts`
- `src/main/claude-accounts/claude-session-mover.test.ts`

31 tests passed. The lifecycle test covers a failed spawn (no write), a pre-move `done` row and a `providerSessionOnly` row (no write), one write after a newer `done` row, a shell veto, a composer timeout write, and an ambiguous screen left unsent. `oxlint` on the touched TypeScript files reported no errors.

`corepack pnpm` in this environment could not start (missing `pnpm.cjs`). The runs above used the installed pnpm 12.14.0 binary.
