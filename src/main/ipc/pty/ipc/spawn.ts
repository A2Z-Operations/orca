import { formatTerminalStartFailure } from '../../../../shared/terminal/pty/lifecycle/terminal-start-failure'
import { getPtyIpc } from '../pty-host-bindings'
import { runPtyIpcSpawn } from './spawn-run'
import type { PtySpawnIpcArgs, PtySpawnIpcDeps } from './spawn-types'
import { getConnectionExecutionHostId } from '../../../../shared/execution-host'
import { attachOnlyViewOf, attachViewAfterHiddenStart } from '../pane/attach-only-view'
import { findHolderOfResumedSession } from '../pane/held-agent-session-resume'
import { heldAgentSessionSources } from '../pane/held-agent-session-sources'
import { formatAgentSessionHeldRefusal } from '../../../../shared/agent-session/lifecycle/held-agent-session-refusal'

export function installPtySpawnIpcHandler(deps: PtySpawnIpcDeps): void {
  const ipcMain = getPtyIpc()
  const { getLocalPtyStartupPromise } = deps

  // Why: a mounted restart unbinds its pane before the spawn; asking first lets a refused restart
  // leave the old PTY bound to its pane. `pty:spawn` still refuses on its own.
  // Removed here, not in register-handlers: window reactivation re-registers every handler.
  ipcMain.removeHandler('pty:findAgentSessionHolder')
  ipcMain.handle(
    'pty:findAgentSessionHolder',
    async (
      _event,
      args: { resumeProviderSession?: unknown; replacesPtyId?: string } | undefined
    ): Promise<{ holderPtyId: string; refusal: string } | null> => {
      const sources = heldAgentSessionSources(deps.runtime, deps.store)
      const holderPtyId = await findHolderOfResumedSession(
        {
          resumeProviderSession: args?.resumeProviderSession,
          ...(typeof args?.replacesPtyId === 'string' ? { replacesPtyId: args.replacesPtyId } : {})
        },
        sources
      )
      return holderPtyId
        ? {
            holderPtyId,
            refusal: formatAgentSessionHeldRefusal(holderPtyId, sources.holderTitle(holderPtyId))
          }
        : null
    }
  )

  ipcMain.handle('pty:spawn', async (_event, args: PtySpawnIpcArgs) => {
    try {
      const startupPromise = getLocalPtyStartupPromise(
        getConnectionExecutionHostId(args.connectionId)
      )
      if (startupPromise) {
        await startupPromise
      }
      if (attachOnlyViewOf(args) && args.sessionId && args.initiallyHidden !== true) {
        return await attachViewAfterHiddenStart(
          args.sessionId,
          deps.transitionSpawnHiddenRendererPtyDeliveryState,
          () => runPtyIpcSpawn(deps, args)
        )
      }
      return await runPtyIpcSpawn(deps, args)
    } catch (error) {
      const message = formatTerminalStartFailure(error)
      if (message) {
        throw new Error(message)
      }
      throw error
    }
  })
}
