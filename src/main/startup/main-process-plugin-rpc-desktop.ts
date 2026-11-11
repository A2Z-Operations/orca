import type { Store } from '../persistence/loading-store/store'
import type { PluginService } from '../plugins/plugin-service'
import type { PluginCliCatalogs } from '../plugins/plugin-cli-catalog-candidates'
import { clearPluginFrameStorage } from '../plugins/panels/plugin-frame-guest-sessions'
import { openPluginFrameGuestDevTools } from '../plugins/panels/plugin-frame-guest-diagnostics'
import { bindPluginRpcServices } from './main-process-plugin-rpc'

/** Fork: the desktop binding. The Electron frame sinks live here so `main-process-plugin-rpc.ts`
 *  stays plain Node and the orcad host can call it without them. */
export function bindDesktopPluginRpcServices(
  store: Store,
  pluginService: PluginService,
  catalogs: PluginCliCatalogs
): void {
  bindPluginRpcServices(store, pluginService, catalogs, {
    openFrameDevTools: openPluginFrameGuestDevTools,
    afterUninstall: clearPluginFrameStorage
  })
}
