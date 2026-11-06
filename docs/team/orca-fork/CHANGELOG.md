# Orca fork changelog

One line per fork build, newest first. Build recipe: `scripts/orca-fork/rebuild.sh` in the BLOWzer repo; version rule: a prerelease of the next upstream patch.

- next build (`fork/mover-hardening`) — session mover / auth proxy hardening: a pane reattached after a restart keeps its proxy slot (persisted pane rows + the listener asks for its old port); durable `account-moves.log` (`orca account moves --log [--since <iso>]`); stay/wait reasons kept instead of `stay`; model flips recorded `strategy: proxy`; auth-proxy health (unknown slots, last error) in Settings and `--status`; `claudeModelPolicyCoversExplicit` (`model-policy --set covers-explicit=on|off`); `--status` for `auto-switch`, `session-mover`, `pool`; `orca account usage`; Settings recent-moves table with an Accounts usage strip.

- `1.4.244-blowzer.16` — `orca repo set-hooks --repo <sel> [--setup "<cmd>"] [--archive "<cmd>"] [--setup-policy ask|run-by-default|skip-by-default] [--clear-setup] [--clear-archive] [--json]` binds a repo's setup/archive hook scripts from a terminal; merges into the stored `hookSettings` through the existing `repo.update` RPC (`src/cli/handlers/repo-set-hooks.ts`).
