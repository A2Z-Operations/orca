import { toSshExecutionHostId } from '../../../../shared/execution-host'
import { parsePaneKey } from '../../../../shared/workspace-layout/stable-pane-id'
import type { Store } from '../../../persistence/loading-store/store'
import type { PersistPtyBindingArgs } from '../../../persistence/loading-store/pty-binding-persistence'
import type { OrcaRuntimeService } from '../../../runtime/orca-runtime'
import type { ReplacedPaneOwner } from './replaced-pane-owner'
import { ptyPaneKey } from './key-state'
import { resolveStablePaneOwner } from './stable-owner'

/** Caller holds the pane's spawn reservation, so no other spawn can claim the pane meanwhile. */
export async function stopReplacedPaneOwner(
  deps: {
    runtime?: OrcaRuntimeService
    store?: Store
    stopReplacedPty: (id: string) => Promise<void>
  },
  args: {
    replacesPtyId: string
    paneKey: string | null
    worktreeId: string | undefined
    connectionId: string | null | undefined
  }
): Promise<ReplacedPaneOwner> {
  const owner = resolveStablePaneOwner(
    deps.runtime,
    deps.store,
    args.paneKey,
    args.worktreeId,
    args.connectionId
  )
  if (owner && owner.ptyId !== args.replacesPtyId) {
    throw new Error('terminal_pane_owner_changed')
  }
  // #70 S3: proven = a bound owner with this id, or (unbound) the PTY's own pane-key record. Never a refusal here: an
  // unproven restart still runs as before (the window route relies on that); it only carries nothing.
  const proven =
    owner !== null || (args.paneKey !== null && ptyPaneKey.get(args.replacesPtyId) === args.paneKey)
  await deps.stopReplacedPty(args.replacesPtyId)
  const pane = args.paneKey ? parsePaneKey(args.paneKey) : null
  return {
    ...(proven ? { proven: true as const } : {}),
    ptyId: args.replacesPtyId,
    pane:
      pane && args.worktreeId
        ? {
            worktreeId: args.worktreeId,
            tabId: pane.tabId,
            leafId: pane.leafId,
            hostId: args.connectionId ? toSshExecutionHostId(args.connectionId) : undefined
          }
        : null
  }
}

/** Swap inside the durable mutation: accept the stopped ID or a renderer-cleared leaf; another owner wins. */
export function swapReplacedPaneBinding(
  store: Store,
  binding: PersistPtyBindingArgs,
  replaced: ReplacedPaneOwner
): () => PersistPtyBindingArgs | null {
  return () => {
    const bound =
      store.getWorkspaceSession().terminalLayoutsByTabId?.[binding.tabId]?.ptyIdsByLeafId?.[
        binding.leafId
      ]
    // Unbound is ok: the renderer's pre-connect clear can withdraw it (split tab).
    if (bound !== undefined && bound !== replaced.ptyId) {
      return null
    }
    return replaced.dropsIncarnation ? { ...binding, dropsIncarnation: true } : binding
  }
}

/** Clears a stopped id's binding and keeps the pane; false when another owner took the pane. */
export async function retireReplacedPaneBinding(
  store: Store,
  replaced: ReplacedPaneOwner & {
    pane: NonNullable<ReplacedPaneOwner['pane']>
    /** Also fence on the saved incarnation, for an id the host reported absent rather than stopped. */
    absenceFence?: { incarnationId: string | undefined }
  }
): Promise<boolean> {
  const { hostId, ...pane } = replaced.pane
  return store.retirePtyBinding({ ...pane, ptyId: replaced.ptyId }, hostId, replaced.absenceFence)
}

/** Best effort: a failed replacement must not leave the stopped id bound for the remount to reattach. */
export async function releaseStoppedPaneBinding(
  store: Store | undefined,
  replaced: ReplacedPaneOwner
): Promise<void> {
  if (!store || !replaced.pane) {
    return
  }
  try {
    await retireReplacedPaneBinding(store, { ...replaced, pane: replaced.pane })
  } catch (error) {
    console.warn('[pty] could not clear the stopped pane binding after a failed restart:', error)
  }
}
