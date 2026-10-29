# Proxy on SSH execution hosts and WSL

Date: 2026-10-29. Branch: `nachumi-a2zoperations/proxy-remote-hosts`. Implementation commit: `42000737a4a` (`feat(claude-accounts): run the Claude auth proxy on the execution host`). Not pushed.

## What it does

The proxy listener runs on the execution host, the machine whose PTY and `CLAUDE_CONFIG_DIR` the pane uses. The desktop does not proxy a remote pane.

A non-WSL orcad (an SSH server, or the Studio's macOS orcad) already started that listener inside `createOrcadAccountServices` and installed the profile router, so a spawn on that host injects `http://127.0.0.1:<that host's port>/p/<slot>/`. Desktop spawn refuses any non-local execution host in `getProvider` (`PtyHostNotDispatchableError`) before it can inject env. An SSH workspace also skips desktop-pushed host launch env. `applyRuntimeClaudeAuthEnv` now treats a loopback `/p/<slot>/` URL whose port is not this process's listener as another machine's proxy, not as a user `ANTHROPIC_BASE_URL`. That URL is dropped and this host's slot is kept. `https://…` and a loopback URL that is not the `/p/<slot>/` shape still win, and are still noted once.

## WSL

`createOrcadAccountServices` still returns null on a WSL host. `accounts.list` still throws the desktop-owned message, and `accounts.setHostLaunchEnv` still works. Before that return, the guest starts the same loopback listener and registers `stopClaudeAuthProxy` on cleanup.

A Claude spawn on that guest, when this process is the WSL orcad, calls `applyWslGuestAuthProxyEnv`. If `CLAUDE_CONFIG_DIR` is set, the proxy setting is not off, and `readClaudeOAuthCredentials` returns a token for that folder, the guest binds the folder and sets its own slot URL. The pane is recorded with that slot, so a later flip has something to update. If the folder has no readable token, the guest does not set `ANTHROPIC_BASE_URL` (Claude keeps the real API host). A desktop `/p/<slot>/` URL in the env is removed either way. A user `https` host or a non-slot loopback URL is left unchanged.

The desktop still does not push a proxy URL into the guest. WSL `terminalEnv` returns only the profile pointer, and `ANTHROPIC_BASE_URL` is not an allowed host-launch env key.

On a Windows desktop, `accounts.list` adds optional `wslAuthProxy`. It is `on` when at least one WSL account's `.credentials.json` is readable over the distro UNC path (`toWindowsWslPath`), and `unsupported:wsl` when WSL accounts exist and none of those files are readable. The host's own `authProxy` stays `on` or `off`. The field is omitted off win32 and when there are no WSL accounts. `orca account list` prints `wsl auth-proxy: on` or `wsl auth-proxy: unsupported:wsl`. `on` means the file is readable, not that every pane's folder holds a token. A pane whose folder has no token is still not pointed at the proxy.

## Windows credentials

The proxy uses `readClaudeOAuthCredentials`, the same reader the rest of Orca uses. On darwin that is the Claude Code keychain item, then `.credentials.json`. On win32 the keychain step is skipped and the file is the source. `@orca/windows-security` is a DACL helper and `@orca/windows-registry` is the registry. There is no Credential Manager / `CredRead` reader, and this task does not add one. A throw, an empty token, or `unavailable` returns null and is not logged. The proxy then forwards the incoming `Authorization` unchanged. A Windows host whose token lives only in Credential Manager and not in `.credentials.json` fail-opens. The WSL desktop list reports `unsupported:wsl` when that file is missing or unreadable.

## Flip RPC

`accounts.assignClaudePane` (`accounts-admin`) takes `{ ptyId, accountId, configDir? }` and returns `{ assigned: boolean }`. It rebinds the pane's existing slot and sets `assignedAccountId`. An unknown pane returns `{ assigned: false }` and does not throw. A host with a profile router resolves the folder from the router. A WSL guest has no router, so `configDir` is required. The method does not call `requireServices()`, so it works on the guest where `accounts.list` still throws. The catalog was regenerated.

Older hosts do not know the method. The desktop session mover still flips only panes in its own process. A client tells a remote host with this RPC and must tolerate an unknown-method error from a mixed-version host.

## Task 7 seam

`claude-auth-proxy.ts` is unchanged (keep-alive, body streaming, 128-bit slot ids, `auth-proxy --status`). `claude-auth-proxy-host.ts` gained a config-dir map for hosts without a profile router, `claudeAuthProxyReady`, `claudeAuthProxyListeningPort`, and a token read that uses that map when the router is absent. Slot allocation is still `randomBytes(8)`.

## Tests

`/opt/homebrew/bin/pnpm exec vitest run --config config/vitest.config.ts` on the new and touched tests: 9 files, 44 tests, passed. `typecheck:node` and `typecheck:cli` exited 0. oxlint on the touched files reported 0 warnings. The pre-commit hook's default `pnpm` is the broken corepack shim (`ENOEXEC` on `~/Library/pnpm/.tools/pnpm/12.14.0/bin/pnpm`). The commit ran with `/opt/homebrew/bin` first on `PATH`, so lint-staged (oxlint, ast-grep, oxfmt) ran and passed. `corepack pnpm` was not used.

Covered: foreign `/p/<slot>/` is replaced by this host's slot; an `https` gateway and `http://127.0.0.1:8080/v1` stay; a WSL guest allocates a slot only when a token is readable and records the pane; no token drops a desktop slot and publishes no URL; the proxy-off setting does not allocate; `getProvider('ssh:macstudio')` throws before this machine can inject env; a WSL orcad starts the listener and still returns null from account services; `accounts.assignClaudePane` flips a live slot and returns false without a pane or, with no router, without `configDir`; a throwing credential read returns null and the secret is not logged; account list text prints `wsl auth-proxy: unsupported:wsl` beside `auth-proxy: on`.

## Studio check

Ran from this Mac with the installed `/Applications/Orca.app` CLI, not this worktree's unreleased code.

- `orca environment list --json` includes a paired server named `macstudio` (and `threadripper`).
- `orca host name --environment macstudio --json` returned `ok: true`. The Studio answered.
- `orca account list --environment macstudio` exited 1: `` `--environment` does not retarget `orca account list`. Run it on the host whose accounts you want to manage. ``
- `orca account auth-proxy --environment macstudio` writes `accounts.setClaudeAuthProxy`. It was not run. The Studio's live auth-proxy setting was not read and was not changed.
- This commit is not deployed on the Studio, so the guest listener and `accounts.assignClaudePane` were not exercised there.

## Left

- Not pushed. Not deployed.
- The desktop mover does not call `accounts.assignClaudePane` for a remote or WSL pane.
- WSL `accounts.list` still throws. Guest pane assignments are on the guest registry only.
- No Windows Credential Manager reader. A token that exists only there is unreadable, and the proxy fail-opens.
- Task 7 still owns proxy robustness (`claude-auth-proxy.ts`, status, 128-bit slots).
