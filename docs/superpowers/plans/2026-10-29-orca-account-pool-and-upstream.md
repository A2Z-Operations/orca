# Orca Phase 2 Plan — Account Pool, Hardening, and Upstream Contribution

> **For agentic workers:** one Task per worker, dispatched through Orca orchestration
> (`orca orchestration worker-start --spec "$(cat brief)" --worktree new-top-level --repo id:24b6c6da-158a-46b6-b708-add4558d36c9 --name <task> --base-branch blowzer/session-mover --agent grok`).
> Commit as `Nachumi Eliyahu <nachumi@a2zoperations.com>` only, no AI trailers. Never push, never post
> to `stablyai/orca`. The leader merges each branch into `blowzer/session-mover`, runs the gates, and
> cuts builds. Adapt and report instead of asking; the leader's reviewer judges.

**Where we are (2026-10-29, fork head `a9d2f353274`, build `1.4.244-blowzer.4`):** auto-switch, session
mover (resume strategy), monitoring-pane fix, quiet wait, hand-off note, durable background jobs, and
the **auth proxy** (restart-free moves) are built, merged, unit-tested and packaged. Not yet: installed on
either Mac, live-verified, pooled, cross-host, localized, or shaped for upstream.

**Goal of this phase:** (A) a user with N Claude accounts never hits a limit and never sees a restart
— Orca spreads and moves sessions across the pool silently; (B) every piece is production-hard on
macOS, Linux, Windows/WSL and SSH hosts; (C) the work reaches `stablyai/orca` as a ladder of small,
issue-linked PRs with videos, in the maintainers' own house style.

**Toolchain for every command:** `export N_PREFIX=$HOME/.n-orca PATH=$HOME/.n-orca/bin:$PATH; cd ~/Documents/claude/orca-fork`.
Tests: `corepack pnpm exec vitest run --config config/vitest.config.ts <paths>` (bare `npx vitest` cannot
resolve `@/…`). Typecheck: `corepack pnpm run typecheck:node|web|cli`. Full gate before a build:
`corepack pnpm run check:changed --base=origin/blowzer/session-mover` (known env-only failures: real-git
fixtures refused by the global commit-msg hook; `runtime-electron-ratchet` is fork-caused and is fixed in
Task 10). `docs/team` is gitignored in the fork → `git add -f`. Husky pre-commit needs a fresh
`pnpm install`; docs-only commits may use `--no-verify`.

**Reports from phase 1 every worker must read first:** `docs/team/orca-fork/reviews/token-swap-EXPERIMENT.md`,
`proxy-swap-EXPERIMENT.md`, `proxy-strategy-REPORT.md`, `mover-quiet-wait-REPORT.md`,
`mover-handoff-note-REPORT.md`, `durable-background-jobs-REPORT.md` + `-FOLLOWUP.md`, and the design spec
`docs/superpowers/specs/2026-10-19-orca-session-mover-design.md` (BLOWzer repo).

---

## Milestones

| # | Milestone | Build | Owner steps |
|---|---|---|---|
| M0 | `.4` installed on both Macs, live proxy move witnessed | 1.4.244-blowzer.4 | MacBook swap, Studio SSH approval, Studio re-sign-ins |
| M1 | Account pool (Tasks 1–4) | `.5` | Watch five sessions spread + rebalance |
| M2 | Hardening (Tasks 5–9) | `.6` | Studio = SSH host test |
| M3 | Upstream-ready (Tasks 10–14) | — | Approve each issue + PR before posting |
| M4 | PR ladder posted and shepherded (Task 15) | — | GitHub account used for posting |

---

## M0 — Install and witness (owner + leader, no worker)

- [ ] Owner, plain terminal: `~/Documents/claude/BLOWzer/scripts/orca-fork/macbook-install.sh`, then
      `orca account session-mover --agent claude --move` and `orca account list` must show
      `auto-switch: on`, `session-mover: move`, `auth-proxy: on`.
- [ ] Owner: approve the Studio upload (the three `ssh macstudio …` lines of `rebuild.sh`'s
      `install-studio` block with the `.4` zip), or run `rebuild.sh`-style install from a plain terminal.
- [ ] Owner: Settings → AI Provider Accounts on the Studio → sign in the five lapsed accounts; prune the
      duplicate rows on the MacBook (`nachumi_e@me.com` ×4, `sam@sabrent.com` ×2, `nachumi770@gmail.com` ×3).
- [ ] Leader: follow `proxy-strategy-REPORT.md` "How to verify by hand": new pane → `ps -E` shows
      `ANTHROPIC_BASE_URL=http://127.0.0.1:<port>/p/<slot>/`; `orca account session-mover --agent claude --move`;
      drive one account to its line (or temporarily lower the lines via a dev flag if one exists — do not
      edit policy constants in a build) and watch `orca account list` show the move with the **same pty id**,
      and the pane keep its context. Record a screen video (QuickTime) — this is the upstream demo.
- [ ] Leader: STATUS.md + vault entry "M0 witnessed on <date>".

---

## M1 — Account pool

### Task 1: Pool policy — choose the account with the most headroom at launch

**Files:** `src/main/claude-accounts/claude-account-selection.ts` (selected-account resolution),
`claude-account-auto-switch-policy.ts` (`claudeAutoSwitchHeadroom`, lines 95/90/90),
`claude-profile-router.ts` (`launchEnv`/`launchEnvFor`), `src/main/ipc/pty/runtime/spawn-claude-auth.ts`
(where a spawn picks its account), `src/shared/claude-account-switch-settings.ts`,
`default-global-settings.ts`, `managed-account-types.ts`.

- [ ] New pure module `claude-account-pool-policy.ts`: `chooseClaudePoolAccount({ accounts, usage, now, pinnedCounts, assignedCounts })`
      → the account with the greatest headroom (min over 5h / weekly / Fable-weekly windows, same
      `claudeAutoSwitchHeadroom` maths), tie-break by fewest assigned sessions, then by stable order.
      Candidates must be signed-in, fresh usage (reuse `isFresh`), not in a failure hold. A stale
      candidate counts as "unknown" and is skipped unless every candidate is stale (then fall back to the
      selected account). Export `CLAUDE_POOL_MIN_HEADROOM_PTS = 10`.
- [ ] Setting `claudeAccountPool?: 'off' | 'on'` (absent = off). When on, every Orca-made Claude launch
      (new pane, worker-start, resume by the mover, mobile cold restore) asks the pool policy instead of
      the selected account. A pane launched by hand (`claude` typed in a shell) stays pinned to its
      folder as today. The "selected account" remains what new **non-pooled** launches and the status
      bar show.
- [ ] Registry: every pooled launch records `source: 'pool'` and the assignment in
      `claude-pane-account-registry.ts`; `assignedCounts` come from `listClaudePaneAccounts()`.
- [ ] Tests: headroom choice, tie-break, stale skipping, all-stale fallback, pinned exclusion, min
      headroom, and a launch-path test proving `CLAUDE_CONFIG_DIR` follows the pool choice.

### Task 2: Pool rebalancer — early proxy moves to even out the pool

**Files:** `claude-session-mover-policy.ts` (`decideClaudeSessionMove`), `-evaluation.ts`, `-history.ts`,
`claude-session-move-strategy.ts` (`proxy` strategy), `claude-auth-proxy/*`.

- [ ] Add a second decision input `pool: { enabled, spreadLine }`: when the pool is on and the session
      runs through the proxy (registry has a slot), move it **before** the 95/90 lines when
      `ownHeadroom < bestCandidateHeadroom - CLAUDE_POOL_REBALANCE_GAP_PTS (default 25)` and
      `bestCandidateHeadroom >= 30`. Resume-strategy sessions keep the old lines (a restart is not cheap).
- [ ] Rate-limit the rebalancer: at most one proxy move per pane per `CLAUDE_POOL_REBALANCE_COOLDOWN_MS`
      (15 min), and the existing target claims/debit so five panes do not pile onto one account in a
      tick. New reason `'rebalance'` in `ClaudeSessionMoveReason`, decisions list, notices
      ("… continues on <to> to balance your accounts").
- [ ] Prompt-cache awareness: a proxy flip costs one cache miss. Do not rebalance a pane whose last
      turn ended < 2 min ago (likely mid-conversation burst) unless over the hard line. Read
      `turnEndedAt` from the hook status entry (extend `AgentHookStatusChangeEntry` like
      `mainAgentState` was).
- [ ] Tests for every branch above, plus a lifecycle test: three panes on A at 60/60/60, B at 5 → one
      pane moves per cooldown until the gap closes.

### Task 3: Pool surface — setting, CLI, account list, status bar badge

**Files:** `src/cli/specs/account.ts`, `src/cli/handlers/account-session-mover.ts` (template),
`account-list-format.ts`, `src/shared/rpc-contract/accounts-params.ts` + generated catalog,
`src/main/runtime/rpc/methods/accounts.ts`, `runtime-account-controller.ts`,
`src/renderer/src/components/settings/claude-session-mover-setting.tsx` (template),
`accounts-pane-claude-section.tsx`, `src/renderer/src/components/status-bar/ClaudeSwitcherMenu.tsx`,
terminal tab title/badge components (find where the Codex pane account badge is drawn — grep
`codex-pane-accounts`, `CodexRestartChip`).

- [ ] `orca account pool --agent claude --on|--off [--environment]`; `orca account list` prints
      `pool: on|off` and, per account, `sessions: <assigned count>`; `orca account moves` (new)
      prints the mover's last decisions with time, pane, from → to, reason, strategy (resume|proxy).
- [ ] Settings row "Spread sessions across accounts" next to the mover row, same component pattern.
- [ ] **Per-pane account badge**: a small chip in the terminal tab header showing the assigned
      account's short label, updated on every move (renderer subscribes to the registry snapshot
      already exposed for `account list`; add an RPC/IPC event `claudeAccounts:paneAssigned`). Follow
      `docs/STYLEGUIDE.md` tokens and shadcn primitives.
- [ ] All seven locales (`en, es, fr, ja, ko, pt, zh`) for every new string, through the project's
      localization scripts (`config/scripts/*localization*.mjs`); `verify-localization-catalogs` and
      `-extraction` must exit 0.
- [ ] Tests: CLI handler tests (mirror `account-session-mover.test.ts`), RPC method tests, a
      fixture screenshot of the badge (`pnpm fixtures:shot`).

### Task 4: Pool build and rehearsal → `1.4.244-blowzer.5`

- [ ] Leader: merge Tasks 1–3, gates, `build5.sh` (copy of the scratch build script with the version
      bumped), install both Macs, then: pool on, open five panes → `orca account list` shows them
      spread by headroom; push one account up → one pane rebalances through the proxy with the same
      pty id; `orca account moves` lists it. Video #2.

---

## M2 — Hardening

### Task 5: Proxy on SSH execution hosts and WSL

**Files:** `src/main/orcad/orcad-account-services.ts` (returns null on WSL today), `orcad-entry.ts`,
`claude-auth-proxy-host.ts`, `src/main/runtime` SSH execution-host plumbing (find how orcad on a
remote host starts services; grep `executionHost`, `ssh`), `claude-profile-router.ts` remote branches.

- [ ] The proxy listener runs on **the execution host** (where the PTY and `CLAUDE_CONFIG_DIR` live):
      orcad on an SSH server starts its own loopback listener; the desktop never proxies for a remote
      pane. The client tells the host which account slot a pane has through the existing accounts RPC
      (`assignedAccountId` already travels in the registry snapshot — add the set/flip RPC if missing).
- [ ] WSL: start the listener inside the WSL orcad (loopback inside the guest), or document and guard
      (`claudeAuthProxy` reports `unsupported:wsl` in `account list`) if the guest cannot read the
      Windows keychain/credential store. Prefer working.
- [ ] Windows: credentials come from Claude's Windows store (see `claude-account-folder.ts` for how
      Orca reads them today); the proxy must use the same reader. Guard cleanly if unreadable.
- [ ] Tests with the existing SSH/remote test harness (grep `remote-server` tests); a manual check on
      the Studio over `orca --environment macstudio` recorded in the report.

### Task 6: Durable jobs — Monitor tool, TaskStop forwarding, Windows/WSL

**Files:** `src/main/claude/durable-background-job*.{ts,mjs}`, `src/main/ipc/pty/host-env/durable-background-job.ts`.

- [ ] Monitor tool: the same PreToolUse rewrite for Claude's `Monitor` (verify its tool name and input
      shape on Claude Code 2.1.312; if it cannot be detached safely, document why and leave it).
- [ ] TaskStop: the waiter forwards SIGTERM/SIGINT to the job's process group so stopping the task in
      Claude stops the job (today it only stops the tail). Keep `orca job stop` as the explicit path.
- [ ] Windows: a detached job via `start /b` + job object or `wmic`/`powershell Start-Process -WindowStyle Hidden`;
      WSL: `setsid` inside the guest. Guard, test per platform with the existing platform matrix
      helpers (`docs/agents-md-refs/cross-platform-support.md`).
- [ ] Permission rule: ship the one-line allow pattern in docs and, if Claude Code supports it,
      `permissionDecision: allow` from the hook for the rewritten waiter only.

### Task 7: Proxy robustness

**Files:** `claude-auth-proxy.ts`, `claude-auth-proxy-host.ts`, `service-fetch-policy.ts`.

- [ ] Upstream outages / 5xx / 429 pass through unchanged (no retries in the proxy). Connection reuse
      (keep-alive agent), request body streaming (no buffering of 300 KB `/compact` bodies), SSE
      back-pressure, idle timeout ≥ Claude's own (10 min), graceful close on orcad stop (in-flight
      streams finish).
- [ ] Token freshness: re-read on every request is fine on macOS keychain (fast) — measure; if > 5 ms,
      cache per account with a 20 s TTL and invalidate on `rateLimits` auth snapshot change.
- [ ] Observability: `orca account auth-proxy --status` prints port, slots → account, requests served
      per account in the last hour, last error. Log lines are `[claude-auth-proxy] <method> <path> <status> <accountId>`.
- [ ] Security: loopback bind only; slot ids are 128-bit random; a request on an unknown slot is
      forwarded with its own header (fail open) and counted; never log headers or bodies; unit tests
      for each.

### Task 8: Mover and pool observability + mobile

- [ ] `orca account moves` already from Task 3; add the same list to the Settings accounts pane
      ("Recent moves") and to the mobile notification stream (orcad path already dispatches
      `dispatchMobileNotification`).
- [ ] Metrics in `orca-stats.json`-style local stats: moves per strategy, rebalances, failures.

### Task 9: Hardening build → `1.4.244-blowzer.6`

- [ ] Leader: merge 5–8, full gates, build, install, Studio SSH check (Task 5 manual section),
      STATUS.md.

---

## M3 — Upstream-ready

### Task 10: Clean the fork for contribution

- [ ] Fix the fork-caused ratchets: `runtime-electron-ratchet` (our `updater-disabled.ts` and the
      `system-language.ts` touch), process-host import boundary baseline for `durable-background-job.mjs`
      done right (not a baseline bump). `pnpm check:changed` must be fully green except the two
      machine-only real-git fixtures (document them; upstream CI will pass them).
- [ ] Separate fork-only commits (updater kill switch, `ORCA_NO_PUBLISH` packaging, BLOWzer docs) onto
      `blowzer/fork-only` so the feature branches are pure.
- [ ] Defaults for upstream: `claudeAuthProxy` **off**, `claudeAccountPool` off, `claudeSessionMover`
      `ask` (headless = move stays), `claudeAutoSwitchEnabled` false. The fork keeps its own defaults
      in `blowzer/fork-only`.
- [ ] Seven locales complete for every string this programme added (Task 3 did the pool; audit
      auto-switch, mover, proxy, durable jobs, hand-off note).
- [ ] Docs in upstream style: `docs/reference/claude-accounts.md` (accounts, auto-switch, mover,
      proxy, pool, durable jobs; policy lines; failure modes; CLI), linked from the docs index. No
      BLOWzer names anywhere.

### Task 11: Plugin API — expose accounts and usage

**Files:** plugin host (`src/main/plugins` — find the v0 API with 7 capabilities / 13 host calls),
`docs` for plugins.

- [ ] Read-only capability `accounts.read`: `listClaudeAccounts()` (ids, labels, usage windows,
      assigned session counts) and event `accounts.usage.changed`, `accounts.session.moved`. Keeps
      tokens out. Tests + a 20-line example plugin in `docs/`.

### Task 12: PR ladder preparation (branches, not posts)

Create from the cleaned fork, each rebased on current upstream `main`, each with its own
`check:changed` green, tests, locales, and a draft PR body following `.github/pull_request_template.md`
(ELI5, What changed, Why, Linked issue, Visual proof, Testing with platforms, AI disclosure filled
honestly, checklist):

1. `pr/claude-monitoring-pane-restart` — the mid-turn bug fix (5ba4329a13). Smallest, first.
2. `pr/claude-pane-account-registry` — registry + live usage routing + headless usage polling.
3. `pr/claude-session-mover` — policy, resume strategy, setting, CLI, notices, quiet wait, hand-off note.
4. `pr/claude-auth-proxy` — restart-free moves (default off).
5. `pr/claude-account-pool` — pool policy + rebalancer + badge + `account moves`.
6. `pr/claude-durable-background-jobs`.
7. `pr/plugin-accounts-api`.

Each branch's draft body lives in `docs/team/orca-fork/upstream/<branch>.md` (fork repo, ignored
dir, `git add -f`) together with the issue text.

### Task 13: Issues and videos

- [ ] One issue per PR, written as a user problem with repro ("Claude session stops at the usage
      limit mid-task; switching accounts restarts it and kills my background build"), with the
      before video. Issues 1–3 can be posted together; 4–7 after 1–3 are merged or at least
      acknowledged.
- [ ] Videos: before (today's upstream behaviour on a stock build), after (fork). The M0 and M1
      videos are the "after" for 3–5. Use `gh` image/attachment upload per the template, never
      committed files.

### Task 14: Pre-flight review (Grok reviewer + Codex when its cap resets Nov 3)

- [ ] Independent review of each PR branch against `AGENTS.md` and `CONTRIBUTING.md`: naming (no
      `helpers/utils`), checked types, no low-value tests (`docs/agents-md-refs/test-antipatterns.md`),
      hot-path cost, resource cleanup, cross-platform, SSH, mixed client/server versions, STYLEGUIDE
      for the badge/rows. Fix rounds until "Yes".

---

## M4 — Post and shepherd (Task 15, owner-gated per post)

- [ ] Owner says yes per issue and per PR. Post issue → wait for a maintainer reaction → post PR 1.
- [ ] Reply to review comments within a day (leader drafts, owner approves wording if public).
- [ ] After each merge, rebase the next branch, re-run gates, post.
- [ ] Keep the fork releasing (`.7`, …) with upstream merges via `rebuild.sh v<tag>` so we never
      diverge far.

---

## Risks and how we handle them

| Risk | Handling |
|---|---|
| Maintainers reject the proxy idea (network path change, account semantics) | It is PR 4, default off, after three smaller PRs have built trust; the fork keeps it regardless. |
| Proxy flips mid-stream cause a 401 on a long SSE | Flip only between requests (slot change applies to the next request); tested in Task 7. |
| Pool spreads sessions into an account the owner wanted reserved | Per-account `excludeFromPool` flag in Settings (Task 3). |
| Durable jobs leave orphans | Sweeper (done), `orca job list` shows them, TaskStop forwarding (Task 6). |
| Codex lane capped until Nov 3 | Grok workers until then; Codex for reviews after. |
| Owner Claude usage | Leader orchestrates only; all building and reviewing on Grok/Codex. |

## Definition of done for the phase

- `.6` installed on both Macs; five pooled sessions, one witnessed rebalance, one witnessed
  limit-driven proxy move, one witnessed resume move with a surviving durable job and a hand-off note.
- Seven PR branches green, bodies and issues drafted, videos recorded, reviews "Yes".
- STATUS.md, vault note and this plan ticked.
