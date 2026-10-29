# Task 7 — proxy-robustness
Repo: A2Z-Operations/orca, fresh worktree off blowzer/session-mover (head a9d2f353274). Commit as Nachumi Eliyahu <nachumi@a2zoperations.com> only, no Co-Authored-By / AI trailers. Do not push. Never print tokens. Tests: `corepack pnpm exec vitest run --config config/vitest.config.ts <paths>`; typecheck: `corepack pnpm run typecheck:node|web|cli`. Read first: docs/team/orca-fork/reviews/proxy-strategy-REPORT.md, mover-quiet-wait-REPORT.md, mover-handoff-note-REPORT.md, durable-background-jobs-REPORT.md + -FOLLOWUP.md, and the phase-2 plan section pasted below (the whole plan is at ~/Documents/claude/BLOWzer/docs/superpowers/plans/2026-10-29-orca-account-pool-and-upstream.md). Adapt and report instead of asking; if a sibling task (named in the plan) owns a file you need, keep your change minimal and note the seam in the report. Finish with a report at docs/team/orca-fork/reviews/<task>-REPORT.md (git add -f) and worker_done --outcome --report-path.

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

