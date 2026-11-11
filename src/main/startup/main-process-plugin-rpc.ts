import type { Store } from '../persistence/loading-store/store'
import { applyPluginConsent, applyPluginEnablement } from '../plugins/plugin-enablement'
import type { PluginService } from '../plugins/plugin-service'
import type { PluginCliCatalogs } from '../plugins/plugin-cli-catalog-candidates'
import { setPluginServiceForRpc } from '../runtime/rpc/methods/plugins/plugins'
import { setPluginInstallServicesForRpc } from '../runtime/rpc/methods/plugins/plugin-install-methods'

/** Fork: the desktop-only sinks, passed in so a plain-Node host (orcad) can bind without Electron. */
export type PluginRpcDesktopServices = {
  /** Frame guest DevTools for `plugins.devInspect`; absent where no guest webContents exists. */
  openFrameDevTools?: (pluginKey: string) => number
  /** Frame guest storage cleared after an uninstall; absent where no guest session exists. */
  afterUninstall?: (pluginKey: string) => Promise<void>
}

/** Headless RPC resolves these too; consent shares the desktop hash-keyed write path. */
export function bindPluginRpcServices(
  store: Store,
  pluginService: PluginService,
  catalogs: PluginCliCatalogs,
  desktop: PluginRpcDesktopServices = {}
): void {
  setPluginServiceForRpc(pluginService, {
    applyConsent: (request) => applyPluginConsent({ store, pluginService, ...request }),
    applyEnablement: (pluginKey, enabled) =>
      applyPluginEnablement({ store, pluginService, pluginKey, enabled }),
    setPluginSystemEnabled: (pluginSystemEnabled) =>
      store.updateSettings({ pluginSystemEnabled }, { notifyListeners: true }),
    setDevPluginPaths: (devPluginPaths) =>
      store.updateSettings({ devPluginPaths }, { notifyListeners: true }),
    openFrameDevTools: desktop.openFrameDevTools
  })
  setPluginInstallServicesForRpc({
    pluginService,
    catalogs,
    applyConsent: (request) => applyPluginConsent({ store, pluginService, ...request }),
    store,
    afterUninstall: desktop.afterUninstall
  })
}
