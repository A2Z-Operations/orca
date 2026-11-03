# Orca fork changelog

One line per fork build, newest first. Build recipe: `scripts/orca-fork/rebuild.sh` in the BLOWzer repo; version rule: a prerelease of the next upstream patch.

- `1.4.244-blowzer.16` — `orca repo set-hooks --repo <sel> [--setup "<cmd>"] [--archive "<cmd>"] [--setup-policy ask|run-by-default|skip-by-default] [--clear-setup] [--clear-archive] [--json]` binds a repo's setup/archive hook scripts from a terminal; merges into the stored `hookSettings` through the existing `repo.update` RPC (`src/cli/handlers/repo-set-hooks.ts`).
