# Merge task: integrate pool-surface (d5786ce3667) and proxy-remote-hosts (28e1d83a663) into blowzer/session-mover
Repo: A2Z-Operations/orca. Work IN THE MAIN CHECKOUT /Users/nachumieliyahu/Documents/claude/orca-fork on branch
blowzer/session-mover (head af303fe9195; you are dispatched there — do not create a worktree). Commit as
Nachumi Eliyahu <nachumi@a2zoperations.com> only, no AI trailers. Do not push. Tests:
`corepack pnpm exec vitest run --config config/vitest.config.ts <paths>`; typecheck `corepack pnpm run typecheck:node|web|cli`.

Already merged on the head: pool-policy (bd264cf571d, Task 1), pool-rebalancer (fbe6ffda2e4, Task 2),
proxy-robustness (07de9254d39), durable-jobs-platforms (8911244b618), plugin-accounts-api (07e548ad90a).
Reports for every branch are in docs/team/orca-fork/reviews/*-REPORT.md — read pool-policy, pool-surface,
proxy-remote-hosts, proxy-robustness first.

1. `git merge --no-edit d5786ce3667` (pool-surface, Task 3). Conflicts: claude-account-selection.ts,
   service.ts, claude-account-switch-settings.ts, managed-account-types.ts. Rule: Task 1 owns the
   `claudeAccountPool` setting semantics and the launch choice; Task 3 owns the CLI/RPC/UI surface,
   session counts, move history and the badge. Keep BOTH; dedupe the setting type/default (one
   definition), make Task 3's switch actually drive Task 1's policy (its report says "turning the switch
   on … does not choose which account a new session launches on, because that policy belongs to Task 1").
2. `git merge --no-edit 28e1d83a663` (proxy-remote-hosts). Conflicts: spawn-claude-auth.ts,
   spawn-preflight.ts, managed-account-types.ts. Rule: keep Task 1's pooled launch choice AND the
   remote-host slot injection; the pooled account must be the one whose slot the proxy gets.
   Also reconcile with proxy-robustness (07de9254d39) which changed claude-auth-proxy-host.ts /
   accounts RPC after remote-hosts branched: the RPC catalog
   (`src/shared/rpc-contract/rpc-params-catalog.generated.ts`) must be REGENERATED with the repo script,
   not hand-merged (find it: grep "rpc-params-catalog" config/scripts package.json).
3. Gates on the merged head: `corepack pnpm exec vitest run --config config/vitest.config.ts src/main/claude-accounts src/main/claude src/main/agent-hooks src/main/rate-limits src/main/ipc/pty src/main/orcad src/main/plugins src/main/runtime/rpc src/cli src/shared src/renderer/src/lib src/renderer/src/components/settings src/renderer/src/components/tab-bar` must be green except the known env-only real-git fixtures; all three typechecks 0; `corepack pnpm run verify-localization-catalogs` and `verify-localization-extraction` exit 0 (add missing locale strings for every new key from ALL seven branches: es fr ja ko pt zh — use the project's localization scripts).
4. Report → docs/team/orca-fork/reviews/merge-phase2-REPORT.md (git add -f): what conflicted, how resolved, gates output, commit hashes. worker_done --report-path.
