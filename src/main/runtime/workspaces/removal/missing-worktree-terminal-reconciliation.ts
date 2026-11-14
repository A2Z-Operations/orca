import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { getRepoRoutingConnectionId } from '../../../../shared/execution-host'
import type { IPtyProvider } from '../../../providers/pty-provider-contract'
import type { Repo } from '../../../../shared/repo-types'
import { splitWorktreeId } from '../../../../shared/worktree/id'
import { mapWithConcurrency } from '../../../../shared/map-with-concurrency'
import { rememberLocalDirectoryIdentity } from '../../../workspaces/catalog/local-worktree-directory-alias'
import { killAllProcessesForWorktree, type WorktreeTeardownRuntime } from './worktree-teardown'

// A scan listing under a quarter of the known ids is truncated, not evidence those checkouts were deleted.
function detectedScanLooksPartial(knownCount: number, detectedCount: number): boolean {
  return detectedCount > 0 && detectedCount * 4 < knownCount
}

async function linkedCheckoutStillPresent(worktreePath: string): Promise<boolean> {
  try {
    const gitEntry = await stat(join(worktreePath, '.git'))
    if (gitEntry.isDirectory()) {
      return true
    }
    if (!gitEntry.isFile()) {
      return false
    }
    const text = await readFile(join(worktreePath, '.git'), 'utf8')
    return text.startsWith('gitdir:')
  } catch {
    return false
  }
}

async function detectedScanStillListsWorktree(
  worktreePath: string,
  detectedWorktreeIds: readonly string[]
): Promise<boolean> {
  for (const detectedId of detectedWorktreeIds) {
    const detectedPath = splitWorktreeId(detectedId)?.worktreePath
    if (detectedPath && (await rememberLocalDirectoryIdentity(worktreePath, detectedPath))) {
      return true
    }
  }
  return false
}

const MISSING_WORKTREE_TEARDOWN_CONCURRENCY = 4

// Share one snapshot across known-missing workspaces to avoid O(N²) inventory traffic.
// Best-effort only: requirePhysicalStop needs fresh post-shutdown evidence and must never reuse this cache.
function withSharedProcessSnapshot(provider: IPtyProvider): IPtyProvider {
  let snapshot: Promise<Awaited<ReturnType<IPtyProvider['listProcesses']>>> | null = null
  return new Proxy(provider, {
    get(target, property) {
      if (property !== 'listProcesses') {
        // Bind to the real provider so internal this.listProcesses reads live state, not this sweep's cache.
        // oxlint-disable-next-line anti-slop/no-reflect-get -- Proxy get trap default forward.
        const member: unknown = Reflect.get(target, property)
        return typeof member === 'function' ? member.bind(target) : member
      }
      return async (opts?: Parameters<IPtyProvider['listProcesses']>[0]) => {
        const pending = (snapshot ??= target.listProcesses({
          ...opts,
          worktreeId: undefined,
          ptyIds: undefined
        }))
        try {
          return await pending
        } catch {
          // Retry failures per caller so one transient relay error cannot suppress the rest of the sweep.
          if (snapshot === pending) {
            snapshot = null
          }
          return target.listProcesses(opts)
        }
      }
    }
  })
}

// Host-fence path-derived ids so another host's same-id workspace survives.
function hostFence(
  repo: Repo,
  worktreeId: string
): { resolvedWorktreeId: string; resolvedConnectionId?: string } {
  const connectionId = getRepoRoutingConnectionId(repo)
  return {
    resolvedWorktreeId: worktreeId,
    ...(connectionId ? { resolvedConnectionId: connectionId } : {})
  }
}

type MissingWorktreeTerminalReconciliationDeps = {
  runtime: WorktreeTeardownRuntime
  getLocalProvider: () => IPtyProvider | null
  onPtyStopped?: (ptyId: string) => void
}

export async function stopMissingWorktreeTerminals(
  repo: Repo,
  knownWorktreeIds: readonly string[],
  detectedWorktreeIds: readonly string[],
  deps: MissingWorktreeTerminalReconciliationDeps
): Promise<{ stoppedWorktreeIds: string[] }> {
  const detectedIds = new Set(detectedWorktreeIds)
  const repoKnownIds = knownWorktreeIds.filter(
    (worktreeId) => splitWorktreeId(worktreeId)?.repoId === repo.id
  )
  if (detectedScanLooksPartial(repoKnownIds.length, detectedWorktreeIds.length)) {
    return { stoppedWorktreeIds: [] }
  }
  const missingIds = [...new Set(repoKnownIds.filter((worktreeId) => !detectedIds.has(worktreeId)))]
  if (missingIds.length === 0) {
    return { stoppedWorktreeIds: [] }
  }
  const remote = Boolean(getRepoRoutingConnectionId(repo))
  const presentIds = new Set(
    remote
      ? []
      : (
          await mapWithConcurrency(
            missingIds,
            MISSING_WORKTREE_TEARDOWN_CONCURRENCY,
            async (worktreeId) => {
              const worktreePath = splitWorktreeId(worktreeId)?.worktreePath
              if (!worktreePath) {
                return null
              }
              if (
                (await detectedScanStillListsWorktree(worktreePath, detectedWorktreeIds)) ||
                (await linkedCheckoutStillPresent(worktreePath))
              ) {
                return worktreeId
              }
              return null
            }
          )
        ).filter((worktreeId): worktreeId is string => worktreeId !== null)
  )
  const stopIds = missingIds.filter((worktreeId) => !presentIds.has(worktreeId))
  if (stopIds.length === 0) {
    return { stoppedWorktreeIds: [] }
  }

  const ownedProvider = getRepoRoutingConnectionId(repo) ? null : deps.getLocalProvider()
  const provider = ownedProvider ? withSharedProcessSnapshot(ownedProvider) : ownedProvider
  if (!provider) {
    const stoppedWorktreeIds = (
      await mapWithConcurrency(
        stopIds,
        MISSING_WORKTREE_TEARDOWN_CONCURRENCY,
        async (worktreeId) => {
          try {
            await deps.runtime.stopTerminalsForWorktree(worktreeId, hostFence(repo, worktreeId))
            return worktreeId
          } catch {
            return null
          }
        }
      )
    ).filter((worktreeId): worktreeId is string => worktreeId !== null)
    return { stoppedWorktreeIds }
  }

  const stoppedWorktreeIds = (
    await mapWithConcurrency(stopIds, MISSING_WORKTREE_TEARDOWN_CONCURRENCY, async (worktreeId) => {
      try {
        await killAllProcessesForWorktree(worktreeId, {
          runtime: deps.runtime,
          ...hostFence(repo, worktreeId),
          localProvider: provider,
          onPtyStopped: deps.onPtyStopped,
          // Cached pre-shutdown inventory can support only best-effort teardown.
          requirePhysicalStop: false
        })
        return worktreeId
      } catch (error) {
        console.warn(`[worktree-teardown] Failed to stop missing workspace ${worktreeId}`, error)
        return null
      }
    })
  ).filter((worktreeId): worktreeId is string => worktreeId !== null)

  return { stoppedWorktreeIds }
}
