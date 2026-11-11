// Fork: the plugin service for the plain-Node serve host (orcad). The desktop composition root
// (`startup/main-process-plugins.ts`) reaches into Electron for windows, frames, the status bar
// and the image protocol; none of that exists here, so this file wires only what a windowless
// host can serve: discovery, consent/enablement writes, catalogs, trusted-worker activation, the
// runtime delegate (workspace/terminal/agent/hooks/storage/notifications) and the plugin RPC.
// Keep every import electron-free: `build-orcad.mjs` refuses a bundle that imports electron.
import { join } from 'node:path'
import { getAppEnvironment } from '../../shared/app-environment'
import { pluginHostVersion } from '../../shared/plugins/installation/plugin-host-version'
import {
  normalizePluginConsents,
  normalizePluginIdList
} from '../../shared/plugins/approval/plugin-consent-state'
import type { PluginManifest } from '../../shared/plugins/manifest/plugin-manifest'
import type { Store } from '../persistence/loading-store/store'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { ALL_RPC_METHODS } from '../runtime/rpc/methods/rpc-method-registry'
import { setPluginServiceForRpc } from '../runtime/rpc/methods/plugins/plugins'
import { setPluginInstallServicesForRpc } from '../runtime/rpc/methods/plugins/plugin-install-methods'
import { PluginService } from '../plugins/plugin-service'
import { PluginKillListService } from '../plugins/catalog/plugin-kill-list-service'
import { PluginMarketplaceService } from '../plugins/catalog/plugin-marketplace-service'
import { PluginMarketplaceInstaller } from '../plugins/catalog/plugin-marketplace-installer'
import { PluginImageCache } from '../plugins/plugin-image-cache'
import { getPluginsDataDir, isInvalidDiscoveredPlugin } from '../plugins/plugin-discovery'
import { resolvePluginHostEntryPath } from '../plugins/workers/plugin-host-process'
import { revokePluginConsent } from '../plugins/plugin-enablement'
import { projectPluginAgentStatusChangedPayload } from '../plugins/plugin-agent-status-event'
import { bindPluginClaudeAccountEvents } from '../plugins/plugin-claude-account-events'
import {
  bindPluginRuntime,
  createPluginAgentStatusForwarder,
  watchPluginWorkspaceContext
} from '../plugins/plugin-runtime-binding'
import { emitPluginWorktreeLifecycleTo } from '../plugins/plugin-worktree-lifecycle'
import { bindPluginRpcServices } from '../startup/main-process-plugin-rpc'
import type { AgentHookServer } from '../agent-hooks/server/agent-hook-server'
import type { OrcadRuntimeCleanup } from './orcad-runtime-lifetime'
import type { OrcadPluginClaudeAccountSource } from './orcad-account-services'

export type OrcadPluginsHandle = {
  pluginService: PluginService
  killList: PluginKillListService
  marketplace: PluginMarketplaceService
  installer: PluginMarketplaceInstaller
}

/** Contributions only a window shows; a headless host logs them instead of failing the plugin. */
export function headlessUnavailableContributions(manifest: PluginManifest): string[] {
  const { contributes } = manifest
  const unavailable: string[] = []
  if (contributes.panels.length > 0) {
    unavailable.push(`${contributes.panels.length} panel(s)`)
  }
  if (contributes.customEditors.length > 0) {
    unavailable.push(`${contributes.customEditors.length} custom editor(s)`)
  }
  if (contributes.newFiles.length > 0) {
    unavailable.push(`${contributes.newFiles.length} new-file template(s)`)
  }
  if (contributes.statusBarItems.length > 0) {
    unavailable.push(`${contributes.statusBarItems.length} status bar item(s)`)
  }
  if (contributes.fonts.length > 0) {
    unavailable.push(`${contributes.fonts.length} font(s)`)
  }
  return unavailable
}

export function headlessUnavailableLine(unavailable: readonly string[]): string {
  return (
    `headless serve: ${unavailable.join(', ')} declared but this host has no window to show ` +
    'them; the worker, commands, hooks and events still run'
  )
}

/** The plugin host entry beside the orcad bundle (the desktop out/main layout is the fallback).
 *  Empty when this process has no bundle root: workers then fail per plugin, never the host. */
export function orcadPluginHostEntryPath(appPath?: string): string {
  try {
    return resolvePluginHostEntryPath(appPath ?? getAppEnvironment().getAppPath(), false)
  } catch (error) {
    console.warn('[orcad plugins] no plugin host entry on this host:', error)
    return ''
  }
}

export function startOrcadPlugins(input: {
  runtime: OrcaRuntimeService
  store: Store
  hookServer: Pick<AgentHookServer, 'getStatusSnapshot' | 'subscribeEnrichedStatus'>
  registerCleanup: (cleanup: OrcadRuntimeCleanup) => void
  userDataPath?: string
  hostVersion?: string
  hostEntryPath?: string
  /** Whether the safety list and catalog seeds may reach the network; packaged hosts do. */
  networkAllowed?: boolean
  /** This host's Claude accounts for plugins holding `accounts.read`, as the desktop binds its own.
   *  Absent when the host owns no accounts (a WSL guest, whose accounts stay on the desktop): then
   *  `accounts.read` answers `{ accounts: [] }` and no `accounts.*` event fires, by design. */
  claudeAccounts?: OrcadPluginClaudeAccountSource
}): OrcadPluginsHandle {
  const { runtime, store, hookServer, registerCleanup } = input
  const userDataPath = input.userDataPath ?? getAppEnvironment().getPath('userData')
  const hostVersion = input.hostVersion ?? pluginHostVersion(getAppEnvironment().getVersion())
  const networkAllowed = input.networkAllowed ?? getAppEnvironment().isPackaged()
  const pluginsDataDir = getPluginsDataDir(userDataPath)
  const isEnabled = (): boolean => store.getSettings().pluginSystemEnabled === true

  const killList = new PluginKillListService({ pluginsDataDir })
  const imageCache = new PluginImageCache(join(pluginsDataDir, 'image-cache'))
  const marketplace = new PluginMarketplaceService({
    imageCache,
    pluginsDataDir,
    getKillListEntry: (pluginKey) => killList.find(pluginKey),
    hostVersion
  })
  let pluginService: PluginService | null = null
  const installer = new PluginMarketplaceInstaller({
    marketplace,
    userDataPath,
    hostVersion,
    blockedPluginReason: (pluginKey) => killList.reason(pluginKey),
    imageCache,
    revokeConsent: (pluginKey) => revokePluginConsent({ store, pluginService, pluginKey })
  })
  pluginService = new PluginService({
    userDataPath,
    hostVersion,
    // Same switch as the desktop: off means discovery returns nothing and no plugin code runs.
    isPluginSystemEnabled: isEnabled,
    getDisabledPlugins: () => normalizePluginIdList(store.getSettings().disabledPlugins),
    getPluginConsents: () => normalizePluginConsents(store.getSettings().pluginConsents),
    getDevPluginPaths: () => normalizePluginIdList(store.getSettings().devPluginPaths),
    getPluginKillListEntry: (pluginKey) => killList.find(pluginKey),
    hostEntryPath: input.hostEntryPath ?? orcadPluginHostEntryPath()
    // No desktop frame services, status bar or appearance: the host bindings answer
    // `unavailable` for those calls, which is the headless contract.
  })
  const service = pluginService

  // Bound before the first RPC can reach it; the same store-backed writes as the desktop.
  const pluginDelegate = bindPluginRuntime(service, runtime, hookServer, ALL_RPC_METHODS)
  bindPluginRpcServices(store, service, { marketplace, installer })

  const seedCatalogs = (): void => {
    if (!isEnabled() || !networkAllowed) {
      return
    }
    void marketplace
      .seedOfficialSource()
      .catch((error) =>
        console.warn('[orcad plugins] failed to configure the official marketplace:', error)
      )
    void marketplace
      .seedCommunitySource()
      .catch((error) =>
        console.warn('[orcad plugins] failed to add the community marketplace:', error)
      )
  }
  const refreshKillList = (): void => {
    if (!isEnabled() || !networkAllowed) {
      return
    }
    void killList
      .refresh()
      .catch((error) =>
        console.warn(
          '[orcad plugins] failed to refresh plugin safety list; using cached state:',
          error
        )
      )
    killList.syncPeriodicRefresh(true)
  }

  const stopKillListChanges = killList.onChanged(() => {
    void service
      .reconcileActivationState()
      .catch((error) =>
        console.warn('[orcad plugins] failed to apply plugin safety-list refresh:', error)
      )
  })
  const stopSettingsChanges = store.onSettingsChanged((updates) => {
    if (updates.pluginSystemEnabled === true) {
      seedCatalogs()
      refreshKillList()
    }
    if (updates.pluginSystemEnabled === false) {
      killList.syncPeriodicRefresh(false)
    }
    if ('pluginSystemEnabled' in updates || 'devPluginPaths' in updates) {
      // Main owns lifecycle refresh even when a caller crashes before its follow-up refresh.
      void service.refresh().catch((error) => {
        console.warn('[orcad plugins] failed to apply plugin settings change:', error)
      })
    }
  })

  // One line per install for contributions no window shows, so `orca plugin logs` explains it.
  const noted = new Set<string>()
  const noteHeadlessContributions = (): void => {
    for (const plugin of service.getDiscovered()) {
      if (isInvalidDiscoveredPlugin(plugin)) {
        continue
      }
      const key = `${plugin.pluginKey}@${plugin.rootDir}:${plugin.manifest.version}`
      if (noted.has(key) || !service.findApprovedPlugin(plugin.pluginKey, true)) {
        continue
      }
      noted.add(key)
      const unavailable = headlessUnavailableContributions(plugin.manifest)
      if (unavailable.length > 0) {
        service.captureLog(plugin.pluginKey)('warn', headlessUnavailableLine(unavailable))
      }
    }
  }
  const stopChanges = service.onChanged(noteHeadlessContributions)

  // Filter hook/worktree events server-side by each plugin subscription.
  const forwardAgentStatus = createPluginAgentStatusForwarder(pluginDelegate, service)
  const stopAgentStatus = hookServer.subscribeEnrichedStatus((enriched) => {
    const payload = projectPluginAgentStatusChangedPayload(enriched)
    if (payload) {
      forwardAgentStatus(payload, enriched.terminalHandle)
    }
  })
  const stopWorkspaceContext = watchPluginWorkspaceContext({
    delegate: pluginDelegate,
    events: service,
    onSessionWritten: (listener) => store.onWorkspaceSessionWritten(listener)
  })
  const stopWorktreeLifecycle = runtime.onWorktreeLifecycle((event) =>
    emitPluginWorktreeLifecycleTo(service, event)
  )
  // Same binding as the desktop's `bindDesktopPluginClaudeAccountEvents`: `accounts.read` answers
  // this host's view, `accounts.usage/session/model.changed` fire from its own rate-limit service.
  const releaseClaudeAccounts = input.claudeAccounts
    ? bindPluginClaudeAccountEvents({
        emit: (event, payload) => service.emitEvent(event, payload),
        readAccounts: input.claudeAccounts.readAccounts,
        subscribeRateLimits: input.claudeAccounts.subscribeRateLimits
      })
    : () => undefined

  registerCleanup(async () => {
    releaseClaudeAccounts()
    stopAgentStatus()
    stopWorkspaceContext()
    stopWorktreeLifecycle()
    stopChanges()
    stopSettingsChanges()
    stopKillListChanges()
    killList.dispose()
    setPluginServiceForRpc(null)
    setPluginInstallServicesForRpc(null)
    await service.dispose()
  })

  // Initialization discovers manifests only; workers start on their first command, event or hook.
  void killList
    .initialize()
    .then(() => service.initialize())
    .then(() => {
      noteHeadlessContributions()
      console.info(
        `[orcad plugins] plugin system ${isEnabled() ? 'on' : 'off'}; ` +
          `${service.getDiscovered().length} plugin(s) discovered`
      )
      refreshKillList()
      seedCatalogs()
    })
    .catch((error) => console.warn('[orcad plugins] failed to initialize plugin service:', error))

  return { pluginService: service, killList, marketplace, installer }
}
