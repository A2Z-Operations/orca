# Headless `orca serve`: plugin service (Fixes #19)

Branch `fix/headless-serve-plugin-service` off `blowzer/fork-only` (0f2e6ba9e00). Written before
coding; the trace below is what the patch builds on.

## Symptom

On a headless host every plugin RPC answers `Plugin service is not available on this runtime`:
`requirePluginService()` in `src/main/runtime/rpc/methods/plugins/plugins.ts` throws when
`setPluginServiceForRpc` was never called. Its only caller is `bindPluginRpcServices`
(`src/main/startup/main-process-plugin-rpc.ts`), called once from
`initializeMainProcessPlugins` (`src/main/startup/main-process-plugins.ts`), which is the
**Electron** main-process startup (`main-process-ready-runtime.ts:72`).

## Which process hosts the headless runtime

`orca serve` has two runtimes (`src/main/orcad/orcad-local-serve-selection.ts`):

| runtime                                                                                             | process                                                                                                                                                       | plugins today                                                                                                        |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `ORCA_SERVE_RUNTIME=electron`                                                                       | the Electron binary, main process, `state.isServeMode`, no window                                                                                             | **yes** — `initializeMainProcessPlugins` runs; `bindPluginDesktopViews(state.isServeMode, …)` skips the window parts |
| `orcad` (**default** on Linux/macOS, what `orca serve --supervise --no-pairing` runs under systemd) | plain Node (`orcad-server.js`, an esbuild bundle with a pinned Node, `src/main/orcad/main.ts` → `orcad-command-startup` → `orcad-entry.ts#startOrcadRuntime`) | **no** — nothing constructs a `PluginService`                                                                        |

So the gap is orcad only. Issue #19's hosts run orcad.

## What `startOrcadRuntime` already has (`src/main/orcad/orcad-entry.ts`)

- **Store**: `createOrcadProfileStateStartup(runtimeUserDataPath)` → a real
  `Store` (`persistence/loading-store/store`), so `applyPluginConsent` / `applyPluginEnablement` /
  `store.updateSettings({pluginSystemEnabled|devPluginPaths})` work unchanged.
- **Runtime**: `new OrcaRuntimeService(profileStore, …)` — `workspace.*`, `terminal.*`,
  `dispatchPluginNotification`, `onWorktreeLifecycle`, `onWorkspaceSessionWritten` all live here.
- **Hooks / event bus**: `agentHookServer` (`subscribeEnrichedStatus`, `getStatusSnapshot`) is
  started before the runtime. `agent.launch.before` and the other agent hooks dispatch through the
  global `setPluginHookRunner` (`plugins/hooks/plugin-hook-participants.ts`), installed by
  `bindPluginRuntime`; the launch sites are runtime code shared by both hosts.
- **RPC**: `new OrcaRuntimeRpcServer({runtime, …})` dispatches `ALL_RPC_METHODS`, which already
  contains `PLUGIN_METHODS`, `PLUGIN_INSTALL_METHODS`, `PLUGIN_DEV_*`, `PLUGIN_VIEW_METHODS`
  (`rpc-method-registry.ts:145`). Only the injected service is missing.
- **Paths / version**: `getAppEnvironment()` (`orcad-host-adapters.ts`): `getPath('userData')`,
  `getAppPath()` = orcad install root (where `orcad-server.js` and its forked children live),
  `getVersion()`, `isPackaged() === true`.
- **Secrets / settings**: `prepareOrcadSecretStoreAndMigrate` runs before the Store and installs
  orcad's `SecretStore` (`shared/secret-store.ts`, a sealed key file beside the data). The plugin
  `storage`/`settings` host calls are file-backed under `getPluginsDataDir(userData)` and need no
  Electron. `plugin-secrets-store.ts` was the one Electron import in the plugin host path
  (`electron.safeStorage` directly); it now seals through the installed `SecretStore`. On orcad
  that seal reports a gap (key beside the data), which reads as `obfuscated`: `secrets.set` is
  refused with the gap text and `secrets.protection` answers `unavailable`, as the plugin API
  documents; `secrets.get` still decrypts what an earlier host sealed.
- **Cleanup**: `registerCleanup(…)`, run in reverse at stop.

## What `initializeMainProcessPlugins` needs, and what of it is Electron

| piece                                                                                                                                                                                                                                    | Electron?                                                                                                         | headless decision                                                                                                                                                                    |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `PluginService` + `PluginWorkerController` (forks `plugin-host-entry.js` with `fork()`, `ELECTRON_RUN_AS_NODE=1`, harmless under Node)                                                                                                   | no                                                                                                                | construct                                                                                                                                                                            |
| `PluginKillListService`, `PluginInstallStatsService`, `PluginMarketplaceService`, `PluginMarketplaceInstaller`, `PluginImageCache`                                                                                                       | no (global `fetch`)                                                                                               | kill list + marketplace + installer (needed by `install`/`catalog`); skip install stats (only feeds window badges)                                                                   |
| `bindPluginRuntime` (delegate, hook runner, resident-worker warmer)                                                                                                                                                                      | no                                                                                                                | call                                                                                                                                                                                 |
| `bindPluginRpcServices`                                                                                                                                                                                                                  | **yes, indirectly**: it imports `clearPluginFrameStorage` (`electron.session`) and `openPluginFrameGuestDevTools` | make the two desktop sinks parameters; desktop passes them, orcad passes none (both are already optional on the RPC side)                                                            |
| `getPluginDesktopFrameServices` (`shell.openExternal`, `files.saveAs`), `PluginStatusBarState`, `createDesktopPluginAppearance`, `bindPluginDesktopViews`, image protocol, `BrowserWindow` broadcasts, menu/tray rebuild, language packs | yes                                                                                                               | omit; the host bindings already answer `unavailable` / "only available in the Orca desktop app" when these are absent (`plugin-host-method-bindings.ts:244`, `:124`)                 |
| bundled plugin bootstrap (`bundledPluginRootForApp(app)`, `process.resourcesPath`)                                                                                                                                                       | reads Electron app layout                                                                                         | omit: the orcad bundle ships no bundled plugins                                                                                                                                      |
| auto-updater                                                                                                                                                                                                                             | no                                                                                                                | omit from the smallest patch (documented; follow-up)                                                                                                                                 |
| settings listener (`pluginSystemEnabled` / `devPluginPaths` → `refresh()`), kill-list refresh when packaged + enabled, marketplace seeding when enabled                                                                                  | no                                                                                                                | keep, same gates as desktop (`pluginSystemEnabled` honoured; orcad `isPackaged()` is true)                                                                                           |
| `emitPluginWorktreeLifecycle` (workspace.created/removed + `workspace.create` hook)                                                                                                                                                      | lives in `main-process-pty-startup.ts` (imports `electron`) and reads `mainProcessState`                          | re-emit from the orcad binding with the same payload                                                                                                                                 |
| `plugin-host-entry.js`                                                                                                                                                                                                                   | plain-Node entry, already guarded                                                                                 | **ship it in the orcad bundle** (`ORCAD_CHILD_ENTRY_POINTS` + `ORCAD_ARTIFACTS`); `resolvePluginHostEntryPath(installRoot, true)` already looks for it flat beside `orcad-server.js` |

Hard constraint: `build-orcad.mjs` fails the build if any module in the orcad graph imports
`electron`, so the new composition root must import only the electron-free modules above.
Verified by bundling `orcad-server.js` with `buildOrcadEntry` (9128 modules, zero electron /
node:sqlite importers) and the `plugin-host-entry.js` child (248 modules, 855 KB, zero).

## Renderer-only contributions (reported unavailable, never a crash)

| contribution / host call                                                                   | headless behaviour                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `panels` (`ui: "frame"` / `"components"`), `plugins.readPanelEntry`, `plugins.panelAction` | served to **paired clients** over RPC as on Electron serve; the transpile worker file is not shipped in the orcad bundle, so a components panel resolves `{ ok: false, message }` and the client shows the message. `plugin.view.*` RPC answers "only available in the Orca desktop app" (unchanged). |
| custom editors, new-file templates, fonts, themes/icons/syntaxes, language packs           | content packs reconcile (no window reads them); nothing crashes                                                                                                                                                                                                                                       |
| status bar items / `statusBar.update`                                                      | no `PluginStatusBarState` → host call answers `unavailable`                                                                                                                                                                                                                                           |
| `appearance.read` / `appearance.apply`                                                     | `unavailable` ("desktop appearance service is unavailable")                                                                                                                                                                                                                                           |
| `shell.openExternal`, `files.saveAs`                                                       | "this method is only available in the Orca desktop app"                                                                                                                                                                                                                                               |
| `plugins.devInspect` (frame DevTools)                                                      | "Plugin frame DevTools are only available in the Orca desktop app"                                                                                                                                                                                                                                    |
| preload / renderer relay (`getPluginHostRendererActions`)                                  | null on headless by design                                                                                                                                                                                                                                                                            |
| `notifications.*` → `runtime.dispatchPluginNotification`                                   | runtime-level (push to paired devices); not a window call                                                                                                                                                                                                                                             |
| `secrets.set` / `secrets.protection`                                                       | refused / `unavailable` on orcad (the seal's key sits beside the data); `secrets.get`, `storage.*`, `settings.*` work                                                                                                                                                                                 |

Plus one explicit line: when an approved plugin declares panels, custom editors, status bar items
or fonts on a headless host, the orcad binding writes a `warn` line to that plugin's log buffer
(`orca plugin logs <key>`), once per plugin install, naming what has no window to show it.

## Patch shape

1. `src/main/startup/main-process-plugin-rpc.ts`: the two Electron sinks become an optional
   `desktop` argument; desktop startup passes them. No behaviour change on desktop.
2. New `src/main/orcad/orcad-plugins.ts` (`startOrcadPlugins`): the headless composition root
   (service, catalogs, RPC binding, runtime binding, settings listener, kill-list refresh,
   marketplace seed, workspace/agent-status forwarding, headless log line, cleanup).
3. `src/main/orcad/orcad-entry.ts`: one call after the RPC server starts (plugins must not delay
   readiness; `plugins.list` waits on `whenReady()` anyway).
4. `config/scripts/orcad-distribution/server-bundle/orcad-entry-build.mjs` +
   `src/shared/orcad-artifacts.ts`: ship `plugin-host-entry.js`.
5. Tests: `orcad-plugins.test.ts` (service bound after headless start, `plugins.list` answers,
   `plugins.devInspect` reports desktop-only, headless log line for renderer-only contributions,
   worker RPC paths unaffected), `main-process-plugin-rpc` desktop path unchanged.
