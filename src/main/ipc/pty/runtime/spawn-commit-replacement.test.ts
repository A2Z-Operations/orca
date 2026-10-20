import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Store } from '../../../persistence'
import type { IPtyProvider } from '../../../providers/pty-provider-contract'
import { ptySizes } from '../delivery/visibility-state'
import { ptyIncarnationById, ptyOwnership } from '../provider/ownership-state'
import type { ReplacedPaneOwner } from '../pane/pane-owner-replacement'
import { commitRuntimePtySpawn } from './spawn-commit'
import { createRuntimePtySpawnState, type RuntimePtySpawnArgs } from './spawn-state'
import type { PtyRuntimeControllerDeps } from './controller-deps'

const PTY_ID = 'orca-pty-replacement-commit'
const INCARNATION_ID = 'inc-replacement-commit'
const replaced: ReplacedPaneOwner = {
  ptyId: 'old',
  pane: { worktreeId: 'wt-1', tabId: 'tab-1', leafId: 'leaf-1', hostId: undefined }
}

/** Commits a replacing spawn whose durable bind answers with `persist`. */
async function commitReplacement(persist: () => Promise<boolean>) {
  const shutdown = vi.fn(async () => {})
  const persistPtyBinding = vi.fn((_input: unknown) => persist())
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the binding block reads only persistPtyBinding; the swap input is a closure it is never asked to run here.
  const store = { persistPtyBinding } as unknown as Store
  const runtime = { markPtyLivenessUnverifiable: vi.fn(), seedHeadlessTerminal: vi.fn() }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the commit fails in its binding block, before any other port is read.
  const deps = { runtime, store: undefined, options: {} } as unknown as PtyRuntimeControllerDeps
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: a pane-bound spawn needs only its grid and pane ids here.
  const args = { cols: 120, rows: 40, worktreeId: 'wt-1' } as unknown as RuntimePtySpawnArgs
  const ctx = createRuntimePtySpawnState(deps, args)
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: discard reads only shutdown.
  ctx.provider = { shutdown } as unknown as IPtyProvider
  ctx.result = { id: PTY_ID, incarnationId: INCARNATION_ID }
  ctx.hostSessionBinding = { store, worktreeId: 'wt-1', tabId: 'tab-1', leafId: 'leaf-1' }
  ctx.replacedPaneOwner = replaced
  const outcome = await commitRuntimePtySpawn(ctx).then(
    () => null,
    (error: unknown) => error
  )
  return { outcome, shutdown, persistPtyBinding }
}

describe('runtime spawn commit: a replacement that loses its pane', () => {
  afterEach(() => {
    ptySizes.delete(PTY_ID)
    ptyOwnership.delete(PTY_ID)
    ptyIncarnationById.delete(PTY_ID)
  })

  it('swaps through a closure and reports a refused swap as owner-changed', async () => {
    const { outcome, shutdown, persistPtyBinding } = await commitReplacement(async () => false)
    expect(typeof persistPtyBinding.mock.calls[0]?.[0]).toBe('function')
    expect(outcome).toBeInstanceOf(Error)
    expect((outcome as Error).message).toBe('terminal_pane_owner_changed')
    expect(shutdown).toHaveBeenCalledWith(PTY_ID, expect.objectContaining({ immediate: true }))
  })

  it('rethrows a split refusal from the bind as is, never as a save failure', async () => {
    const { outcome, shutdown } = await commitReplacement(async () => {
      throw new Error('terminal_split_source_not_found')
    })
    expect((outcome as Error).message).toBe('terminal_split_source_not_found')
    expect(outcome).not.toHaveProperty('agentSessionOperationOutcome')
    expect(shutdown).toHaveBeenCalled()
  })

  it('still reports any other bind failure as a save failure', async () => {
    const { outcome } = await commitReplacement(async () => {
      throw new Error('disk full')
    })
    expect(outcome).toHaveProperty('agentSessionOperationOutcome', 'unknown')
  })
})
