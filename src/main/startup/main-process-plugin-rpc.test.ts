import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Store } from '../persistence/loading-store/store'
import type { PluginService } from '../plugins/plugin-service'
import type { PluginCliCatalogs } from '../plugins/plugin-cli-catalog-candidates'
import { eraseRpcMethods, type RpcContext, type RpcMethod } from '../runtime/rpc/core'
import { PLUGIN_METHODS, setPluginServiceForRpc } from '../runtime/rpc/methods/plugins/plugins'
import { setPluginInstallServicesForRpc } from '../runtime/rpc/methods/plugins/plugin-install-methods'
import { bindPluginRpcServices } from './main-process-plugin-rpc'
import '../../shared/rpc-contract/plugins-params'

function method(name: string): RpcMethod {
  const found = eraseRpcMethods(PLUGIN_METHODS).find((entry) => entry.name === name)
  if (!found || 'stream' in found) {
    throw new Error(`missing ${name}`)
  }
  return found
}

// oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: devInspect reads only whenReady from the service.
const pluginService = {
  whenReady: vi.fn().mockResolvedValue(undefined)
} as unknown as PluginService
// oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the binder only closes over the store.
const store = { getSettings: vi.fn(), updateSettings: vi.fn() } as unknown as Store
// oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: nothing here reaches a catalog.
const catalogs = {} as PluginCliCatalogs
// oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: plugin handlers never touch the runtime.
const context: RpcContext = { runtime: {} as RpcContext['runtime'], caller: { kind: 'local-cli' } }

afterEach(() => {
  setPluginServiceForRpc(null)
  setPluginInstallServicesForRpc(null)
})

describe('bindPluginRpcServices', () => {
  it('routes frame DevTools to the desktop sink when the desktop passes one', async () => {
    const openFrameDevTools = vi.fn(() => 2)
    bindPluginRpcServices(store, pluginService, catalogs, { openFrameDevTools })
    await expect(
      method('plugins.devInspect').handler({ pluginKey: 'acme.notes' }, context)
    ).resolves.toEqual({ pluginKey: 'acme.notes', opened: 2 })
    expect(openFrameDevTools).toHaveBeenCalledWith('acme.notes')
  })

  it('answers desktop-only for frame DevTools when a plain-Node host binds without sinks', async () => {
    bindPluginRpcServices(store, pluginService, catalogs)
    await expect(
      method('plugins.devInspect').handler({ pluginKey: 'acme.notes' }, context)
    ).rejects.toThrow('only available in the Orca desktop app')
  })
})
