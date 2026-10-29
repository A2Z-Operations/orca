# Build: restart-free account moves through an orcad auth proxy ("proxy strategy")
Repo: A2Z-Operations/orca, base branch blowzer/session-mover (you are in a fresh worktree of it).
Commit as Nachumi Eliyahu <nachumi@a2zoperations.com> only, no Co-Authored-By / AI trailers. Do not
push. Never print tokens. Tests: `corepack pnpm exec vitest run --config config/vitest.config.ts <paths>`;
typecheck via package.json scripts. Adapt and report instead of asking. worker_done with --report-path.

## Read first
- docs/team/orca-fork/reviews/proxy-swap-EXPERIMENT.md — the proof (feasible) and the design sketch.
  Follow its sketch unless the code says otherwise.
- docs/superpowers/specs/2026-10-19-orca-session-mover-design.md and the mover code in
  src/main/claude-accounts/claude-session-mover*.ts, claude-session-move-strategy.ts (the existing
  `resume` strategy; this task adds a second strategy), claude-pane-account-registry.ts,
  claude-profile-router.ts (launchEnv / launchEnvFor set CLAUDE_CONFIG_DIR),
  src/main/rate-limits/claude-oauth-credentials.ts (readClaudeOAuthCredentials, scoped keychain),
  src/main/orcad/orcad-bind-address.ts (loopback bind), src/main/orcad/orcad-account-services.ts.

## Deliverable (one feature, several commits are fine)
1. **Auth proxy in orcad** (`src/main/claude-accounts/claude-auth-proxy/`): one loopback HTTP
   listener per execution host (random port, started with the account services, stopped in
   cleanup). It forwards every request to https://api.anthropic.com (method, path, query, body,
   streaming SSE responses, all headers except Host/Authorization/Content-Length as needed),
   and sets `Authorization: Bearer <token>` for the account currently assigned to the calling
   pane. Pane identity: a per-pane path prefix or token in the base URL
   (e.g. `http://127.0.0.1:<port>/p/<pane-slot>/`) so each pane maps to an account slot.
   Tokens are read via readClaudeOAuthCredentials on each request (or TTL < access-token life);
   never refreshed by the proxy; never logged. Unknown slot → forward with the incoming header
   unchanged (fail open to the process's own account). Log only method/path/status/account id.
2. **Launch**: ClaudeProfileRouter launch env (both launchEnv and launchEnvFor) adds
   `ANTHROPIC_BASE_URL` to that pane's slot URL when the proxy is running and the new setting
   `claudeAuthProxy` is on (default ON in the fork; off = today's behaviour; settings row in
   src/renderer/src/components/settings/accounts-pane-claude-section.tsx next to the mover row,
   CLI `orca account auth-proxy --agent claude --on|--off` modelled on account-session-mover.ts,
   and an `auth-proxy:` line in `orca account list`). Respect a user-set ANTHROPIC_BASE_URL
   (do not override; log once).
3. **Registry**: `claude-pane-account-registry.ts` gains `assignedAccountId` (the account the
   proxy bills) separate from the spawn `accountId`/configDir; the mover view, usage
   attribution (claudeUsageForAccount / live statusline ingestion), auto-switch "running
   sessions" logic and `orca account list` use the assigned account when present.
4. **Mover strategy `proxy`**: in claude-session-move-strategy.ts add a strategy that, for a
   pane launched through the proxy, flips the slot to the target account, updates the registry,
   and returns `moved` with the SAME ptyId (no spawn). The evaluation picks `proxy` when the pane
   has a slot, else `resume`. No mid-turn wait is needed for a proxy move (it takes effect on the
   next request) — but keep the claim/cooldown/debit logic. Notice text: "… continues on <to>
   without a restart".
5. **Hand-off**: when the proxy flips, nothing else is needed; when the pane later restarts by
   hand, the registry's assigned account should become the launch account (router: prefer
   assignedAccountId for `--resume` relaunches of the same session id) so the session stays on
   the account it moved to.
6. Tests: proxy unit tests (header replacement, SSE pass-through, unknown slot, token re-read),
   router env tests, registry tests, strategy + evaluation tests, CLI tests. Typecheck node/web.
Report → docs/team/orca-fork/reviews/proxy-strategy-REPORT.md: design decisions, files, tests,
commit hashes, what is NOT covered (Windows/WSL, SSH remote hosts) and how to verify by hand.
