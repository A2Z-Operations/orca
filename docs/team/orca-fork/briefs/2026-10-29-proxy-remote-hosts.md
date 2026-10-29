# Task 5 — proxy-remote-hosts
Repo: A2Z-Operations/orca, fresh worktree off blowzer/session-mover (head a9d2f353274). Commit as Nachumi Eliyahu <nachumi@a2zoperations.com> only, no Co-Authored-By / AI trailers. Do not push. Never print tokens. Tests: `corepack pnpm exec vitest run --config config/vitest.config.ts <paths>`; typecheck: `corepack pnpm run typecheck:node|web|cli`. Read first: docs/team/orca-fork/reviews/proxy-strategy-REPORT.md, mover-quiet-wait-REPORT.md, mover-handoff-note-REPORT.md, durable-background-jobs-REPORT.md + -FOLLOWUP.md, and the phase-2 plan section pasted below (the whole plan is at ~/Documents/claude/BLOWzer/docs/superpowers/plans/2026-10-29-orca-account-pool-and-upstream.md). Adapt and report instead of asking; if a sibling task (named in the plan) owns a file you need, keep your change minimal and note the seam in the report. Finish with a report at docs/team/orca-fork/reviews/<task>-REPORT.md (git add -f) and worker_done --outcome --report-path.

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

