# Mover and pool observability

Date: 2026-10-29. Branch: `nachumi-a2zoperations/mover-observability`. Feature commit: `3729f98115c`. Not pushed.

## What it does

`orca account moves` is unchanged in text. Settings → Accounts → Claude now has "Recent moves" with those same rows. An older host that omits `sessionMoves` hides the block. An empty list prints `No Claude session moves.` The block stays visible for a remote account scope, because it only reads the host's list.

Each mover notice (moved, ask, skipped, failed) also sends that list to the phone. The title is the translated "Recent moves". The body is the CLI lines, newest first. `attentionKey` is `claude-recent-moves`, so a burst replaces one stream item instead of stacking a banner per pane. `paneKey` is set when the notice has one, so the phone opens that pane. An empty list sends nothing. The desktop OS banner is still the existing sentence, and it still stays quiet when notifications are off or the notice is `skipped`. The phone list is sent anyway.

On orcad, that list replaces the old one-line English sentence. The desktop path sends the list in addition to the OS banner.

## Stats

`userData/orca-stats.json` keeps schema version 1. Aggregates gain `claudeSessionMoves`: `{ resume, proxy, rebalances, failures }`. A file from before this field, or one that only stored some of the counters, keeps the counters it had and fills the rest with zero. A landed move increments `resume` or `proxy`. A rebalance also increments `rebalances`. A failure increments `failures` only. Ask, skipped, stay, and wait are not counted. The event type is `claude_session_move` with `meta.strategy` and `meta.outcome` of `moved`, `rebalance`, or `failed`. `StatsSummary` is unchanged, so the existing stats IPC does not grow a field.

Strategy is the pane's: `proxy` when the record has a proxy slot, otherwise `resume`. Task 3 still owns that field on the decision. This task only counts it.

## Seams

Stay and wait rows show in Settings and in `orca account moves`. They do not push a phone notification by themselves. A push happens only when a notice fires, and the body is the whole live list, including those stay rows.

A restart move stores the decision under the new pty id. The list includes that row when the pane-account registry already has the new pty, which spawn does before `move()` resolves. A test double that returns a new pty id without recording it will see an empty list for that pane.

The phone body is the CLI list. The desktop OS copy stays the human sentence.

`main-process-account-services.ts` and `orcad-account-services.ts` are touched only inside `onNotice`. Move decisions are unchanged.

Task 10 owns the fork electron ratchet. `pnpm check:changed --base=HEAD` still fails it for `src/main/i18n/system-language.ts` and `src/main/updater/updater-disabled.ts`. Those files are not in this commit. The same run's related suite also failed 6 tests because this machine's `commit-msg` hook refuses fixture authors (`Test <test@example.com>`, `Orca Test <test@orca.invalid>`). That is the machine-only real-git fixture failure Task 10 already calls out. It is not a failure in these files.

## Files

- Shared line: `src/shared/claude-session-move-line.ts` (CLI and the two new surfaces)
- Settings: `claude-recent-moves.tsx`, one line in `accounts-pane-claude-section.tsx`, search keywords in `accounts-claude-search.ts`
- Phone: `claude-session-move-mobile-notice.ts`, wired from both account-service `onNotice` handlers
- Notices carry optional `paneKey` and `moves`. The mover attaches `moves` from the live registry before history or evaluation publish.
- Stats: `src/main/stats/types.ts`, `stats-file-loader.ts`, `collector.ts`. The recorder lives in `claude-session-move-stats.ts` so the collector does not import claude-accounts. Desktop observers and `startOrcadStats` install it. Orcad cleanup clears the recorder after the agent-stats feed stops and before the flush.
- Locales: `recentMoves`, `recentMovesDescription`, `recentMovesEmpty`, and search keywords `move`, `session`, `strategy`, `rebalance` in en, es, fr, ja, ko, pt, zh.

## Tests

Targeted vitest (`node …/pnpm/12.14.0/bin/pnpm.mjs exec vitest run --config config/vitest.config.ts`; `corepack pnpm` looks for a missing `pnpm.cjs`):

- `account-moves.test.ts` (4)
- `AccountsPane.test.tsx` (14), including the remote-scope row that matches the CLI line
- `claude-session-mover.test.ts` (14), including a failed-then-retried resume and a proxy rebalance
- `claude-session-mover-lifecycle.test.ts` (13)
- `claude-session-move-mobile-notice.test.ts` (2)
- `claude-session-move-stats.test.ts` (2)
- `orcad-account-services.test.ts` (5)

54 tests, all passed. The Settings check is `renderToStaticMarkup`, not a live Electron window. It covers an older host (no heading), an empty list, and one proxy row on a remote scope.

`pnpm tc:node`, `pnpm tc:web`, and `pnpm tc:cli` exited 0. `verify-localization-catalog` and `verify-localization-extraction` exited 0. lint-staged (oxlint, ast-grep, oxfmt) passed on the 29 files. Changed-code quality in `check:changed` reported 0 new findings after the stats test stopped using type assertions.
