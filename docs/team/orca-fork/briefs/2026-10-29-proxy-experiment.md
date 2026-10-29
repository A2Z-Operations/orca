# Experiment: account swap WITHOUT restart via a local auth proxy (ANTHROPIC_BASE_URL)

Repo: A2Z-Operations/orca, base branch blowzer/session-mover (you are in a child worktree of it). Commit as Nachumi Eliyahu <nachumi@a2zoperations.com> only, no Co-Authored-By / AI trailers. Do not push. Never print tokens or secrets. Run tests with `corepack pnpm exec vitest run --config config/vitest.config.ts <paths>`; typecheck with the package.json typecheck scripts. Finish with worker_done (outcome, files, --report-path). Adapt and report instead of asking.

## Question

Can Orca move a RUNNING Claude Code session to another account by sitting between Claude and the API?
Claude Code honours ANTHROPIC_BASE_URL. If a session is launched with it pointing at a local proxy that
forwards to https://api.anthropic.com and REPLACES the Authorization header with another managed
account's OAuth bearer, does the session keep working and does the API identity follow the header?

## Known facts (from docs/team/orca-fork/reviews/token-swap-EXPERIMENT.md — read it first)

- Claude Code 2.1.312 with CLAUDE_CONFIG_DIR reads OAuth from a keychain item (service
  `Claude Code-credentials-<8 hex of sha256(configDir)>`), JSON with claudeAiOauth.accessToken etc.
- API identity is the bearer token: GET https://api.anthropic.com/api/oauth/usage with a token
  returns that account's windows. Use that to prove which account served a request.
- Accounts to use: A = blowzer1@sabrent.com (profile fe40c723-9950-4265-a582-1ddaad34fbf6),
  B = blowzer2@sabrent.com (11acf92d-2350-4479-835f-57e5793f8baf). Do NOT touch hello@getblowzer.com
  or profile 9c633061-…. Read tokens from the keychain only into process memory / mode-600 files
  in /tmp/proxy-exp; delete at the end. Do not modify any keychain item.

## Procedure

1. Write a ~60-line Node proxy in /tmp/proxy-exp/proxy.mjs: listens on 127.0.0.1:<port>, forwards
   every request (method, path, query, body, streaming responses) to api.anthropic.com, copies all
   headers except Host, and sets Authorization: Bearer <token of ACTIVE account> where the active
   account is read from a small file /tmp/proxy-exp/active (A or B) on every request. Log method,
   path, status and which account was used — never the token.
2. Launch an interactive session in an Orca terminal (orca terminal create / send / read) in
   /tmp/proxy-exp with CLAUDE_CONFIG_DIR=<A home> and ANTHROPIC_BASE_URL=http://127.0.0.1:<port>.
   Record: does Claude still attach its OAuth bearer (log whether an Authorization header arrived
   and its scheme), does the session start, /status output.
3. Prompt 'ping' with active=A. Prompt 'pong' with active=B. Prompt 'ping' with active=A again.
   For each: proxy log line, answer received, any error/retry. Then prove identity: compare the
   5h/weekly utilization from the usage endpoint for A and B before and after (B's session window
   must move only for 'pong').
4. Try with the header replaced for a session whose OWN keychain token is deliberately NOT sent
   (strip the incoming Authorization and set B's): does Claude Code care? Also note any other
   identity-bearing headers (e.g. x-api-key, anthropic-beta, user-agent, oauth org headers) and
   whether /status, statusline usage, or the transcript mention the account.
5. Run a slightly longer turn through the proxy with a background Bash task (`sleep 60 &` via
   run_in_background) and swap the account mid-task: confirm nothing restarts and the task survives.
6. Also test streaming + a tool call round trip + a /compact through the proxy to look for
   breakage (SSE, request timeouts, body size).

## Report → docs/team/orca-fork/reviews/proxy-swap-EXPERIMENT.md

Verdict feasible / not feasible, exact evidence per step, every caveat (headers, errors, latency),
and if feasible a short design sketch: where the proxy lives in Orca (orcad), how the launch env is
set by ClaudeProfileRouter (src/main/claude-accounts/claude-profile-router.ts), how the mover would
flip the account per pane (claude-pane-account-registry.ts) and how token refresh is shared with
Orca's existing readers (src/main/claude-accounts/runtime-auth, rate-limits). Commit the report.
