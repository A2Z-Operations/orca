import { preserveFolderUpgradeWorktreePath } from '../../../workspaces/catalog/folder-upgrade-worktree-path'
import { composeWorktreeId, splitWorktreeId } from '../../../../shared/worktree/id'
import { getRepoExecutionHostId } from '../../../../shared/execution-host'
import {
  readAllWorktreeMetaForHost,
  readWorktreeMetaForHost
} from '../../../persistence/host-qualified-worktree-meta'
import { hostWorktreeTarget } from '../../../../shared/worktree/host-qualified-identity'
import { isFolderRepo } from '../../../../shared/repo-kind'
import { withTimeout } from '../../../../shared/promise-timeout-fallback'
import type { GitWorktreeInfo, Worktree } from '../../../../shared/worktree/types'
import type { WorktreeLineage } from '../../../../shared/worktree/lineage-types'
import type { Repo } from '../../../../shared/repo-types'
import type { WorktreeMeta } from '../../../../shared/worktree/meta-types'
import type { ProjectExecutionRuntimeResolution } from '../../../../shared/execution-host/project-execution-runtime'
import type { RuntimeStore } from '../../construction/runtime-store-contract'

import { areWorktreePathsEqual } from '../../../git/worktrees/catalog/worktree-path-comparison'
import { mergeWorktree } from '../../../ipc/worktree-metadata-merge'
import { pruneLineageForMissingRepoWorktrees } from '../../../workspaces/catalog/worktree-lineage-pruning'
import { hasStrongOrcaMetadata } from '../../../../shared/worktree/ownership'
import { getRepoOwnedWorktreeMeta } from '../../../workspaces/catalog/worktree-metadata-ownership'
import {
  primeLocalWorktreeDirectoryAliases,
  registeredLocalWorktreePath,
  resolveRegisteredLocalWorktreeListing
} from '../../../workspaces/catalog/local-worktree-directory-alias'
import type { RuntimeWorktreeScanResult } from './repo-worktree-resolution-scan'

type RepoWorktreeRowStore = Pick<
  RuntimeStore,
  | 'getRepos'
  | 'getRepo'
  | 'getProjects'
  | 'getSettings'
  | 'getAllWorktreeMeta'
  | 'getAllWorktreeMetaForHost'
  | 'getWorktreeMeta'
  | 'getWorktreeMetaForHost'
  | 'setWorktreeMeta'
  | 'getAllWorktreeLineage'
  | 'getAllWorkspaceLineage'
  | 'removeWorktreeLineage'
>

/** Bound each repo independently for mobile startup; fingerprint probes derive their smaller budget from this shared constant. */
export const RESOLVED_WORKTREE_REPO_TIMEOUT_MS = 5000

/** Scans start without lineage; keep its type nullable so later projection can fill it. */
export type RepoWorktreeRow = Worktree & {
  parentWorktreeId: string | null
  childWorktreeIds: string[]
  lineage: WorktreeLineage | null
  git: Pick<GitWorktreeInfo, 'path' | 'head' | 'branch' | 'isBare' | 'isMainWorktree'>
}

export type RepoWorktreeRowDeps = {
  store: RepoWorktreeRowStore
  /** The cache-aware per-repo scan. Injected so this module never owns scan-cache state. */
  scanRepo: (
    repo: Repo,
    projectRuntimeByRepoId: ReadonlyMap<string, ProjectExecutionRuntimeResolution>
  ) => Promise<RuntimeWorktreeScanResult>
  getCachedSuccessfulScan?: (repo: Repo) => RuntimeWorktreeScanResult | undefined
  /** Folder workspaces are stamped from runtime-owned identity helpers, so the caller supplies them. */
  listFolderWorkspaces: (repo: Repo, repoOwnerCount: number) => Worktree[]
}

/** Publish last-known persisted rows on unreachable/stalled scans, matching disconnected SSH listing behavior. */
export function listStoredWorktreeRowsForRepo(
  store: RepoWorktreeRowStore,
  repo: Repo,
  repoOwnerCount = store.getRepos().filter((candidate) => candidate.id === repo.id).length
): GitWorktreeInfo[] {
  const expectedHostId = getRepoExecutionHostId(repo)
  const byWorktreeId = new Map<string, GitWorktreeInfo>()
  for (const [worktreeId, meta] of Object.entries(
    readAllWorktreeMetaForHost(store, expectedHostId)
  )) {
    const parsed = splitWorktreeId(worktreeId)
    if (!parsed || parsed.repoId !== repo.id) {
      continue
    }
    // Same repo ids can belong to several hosts; degraded scans must not publish another owner's metadata.
    if (meta.hostId ? meta.hostId !== expectedHostId : repoOwnerCount > 1) {
      continue
    }
    byWorktreeId.set(worktreeId, {
      path: parsed.worktreePath,
      head: '',
      branch: '',
      isBare: false,
      isMainWorktree: areWorktreePathsEqual(parsed.worktreePath, repo.path),
      ...(meta.sparseDirectories !== undefined ||
      meta.sparseBaseRef !== undefined ||
      meta.sparsePresetId !== undefined
        ? { isSparse: true }
        : {})
    })
  }
  return [...byWorktreeId.values()]
}

/** One git repo's checkouts as its scan saw them; carries no metadata, which is joined at read. */
export type RepoWorktreeRowsScan = { ok: boolean; worktrees: GitWorktreeInfo[] }

/** The scan half of `resolveRepoWorktreeRows`: slow, and the only part that awaits. */
export async function scanRepoWorktreeRows(
  deps: Pick<RepoWorktreeRowDeps, 'store' | 'scanRepo' | 'getCachedSuccessfulScan'>,
  repo: Repo,
  projectRuntimeByRepoId: ReadonlyMap<string, ProjectExecutionRuntimeResolution>,
  repoOwnerCount = deps.store.getRepos().filter((candidate) => candidate.id === repo.id).length
): Promise<RepoWorktreeRowsScan> {
  const { store } = deps
  // Absorb rejection before withTimeout: rejection preserves shipped empty results, but timeout restores last-known rows.
  const scan: RuntimeWorktreeScanResult = (await withTimeout<RuntimeWorktreeScanResult | null>(
    deps
      .scanRepo(repo, projectRuntimeByRepoId)
      .catch(() => ({ ok: false, worktrees: [] }) satisfies RuntimeWorktreeScanResult),
    RESOLVED_WORKTREE_REPO_TIMEOUT_MS,
    null
  )) ?? {
    ok: false,
    worktrees:
      deps.getCachedSuccessfulScan?.(repo)?.worktrees ??
      listStoredWorktreeRowsForRepo(store, repo, repoOwnerCount)
  }
  const gitWorktrees = preserveFolderUpgradeWorktreePath(repo, scan.worktrees)
  if (scan.ok) {
    pruneLineageForMissingRepoWorktrees(store, repo, gitWorktrees)
  }
  return { ok: scan.ok, worktrees: gitWorktrees }
}

/** The join half: a repo's rows from a scan and the metadata as it is now. Synchronous. */
export function projectRepoWorktreeRows(
  deps: Pick<RepoWorktreeRowDeps, 'store' | 'listFolderWorkspaces'>,
  repo: Repo,
  scan: RepoWorktreeRowsScan | null,
  metaById: Record<string, WorktreeMeta>,
  repoOwnerCount = deps.store.getRepos().filter((candidate) => candidate.id === repo.id).length
): RepoWorktreeRow[] {
  const { store } = deps
  if (isFolderRepo(repo)) {
    return deps.listFolderWorkspaces(repo, repoOwnerCount).map((worktree) => ({
      ...worktree,
      hostId: worktree.hostId ?? getRepoExecutionHostId(repo),
      parentWorktreeId: null,
      childWorktreeIds: [],
      lineage: null,
      git: {
        path: worktree.path,
        head: worktree.head,
        branch: worktree.branch,
        isBare: worktree.isBare,
        isMainWorktree: worktree.isMainWorktree
      },
      displayName: worktree.displayName,
      comment: worktree.comment
    }))
  }
  const expectedHostId = getRepoExecutionHostId(repo)
  return (scan?.worktrees ?? []).map((gitWorktree) => {
    const worktreeId = `${repo.id}::${gitWorktree.path}`
    const exact =
      readWorktreeMetaForHost(store, worktreeId, expectedHostId) ??
      getRepoOwnedWorktreeMeta(repo, worktreeId, metaById, repoOwnerCount)
    const { listed, meta } = resolveRegisteredLocalWorktreeListing(
      repo,
      gitWorktree,
      exact,
      metaById,
      repoOwnerCount
    )
    const merged = {
      ...mergeWorktree(repo.id, listed, meta, repo.displayName),
      hostId: meta?.hostId ?? expectedHostId
    }
    return {
      ...merged,
      parentWorktreeId: null,
      childWorktreeIds: [],
      lineage: null,
      git: {
        path: gitWorktree.path,
        head: gitWorktree.head,
        branch: gitWorktree.branch,
        isBare: gitWorktree.isBare,
        isMainWorktree: gitWorktree.isMainWorktree
      },
      displayName: merged.displayName,
      comment: merged.comment
    }
  })
}

/** Resolution owns durable identity stamping; memory projection never calls this wrapper. */
export function joinRepoWorktreeRows(
  deps: Pick<RepoWorktreeRowDeps, 'store' | 'listFolderWorkspaces'>,
  repo: Repo,
  scan: RepoWorktreeRowsScan | null,
  metaById: Record<string, WorktreeMeta>,
  repoOwnerCount = deps.store.getRepos().filter((candidate) => candidate.id === repo.id).length
): RepoWorktreeRow[] {
  let projectedMeta: Record<string, WorktreeMeta> | undefined
  if (!isFolderRepo(repo)) {
    const hostId = getRepoExecutionHostId(repo)
    for (const git of scan?.worktrees ?? []) {
      const id = composeWorktreeId(repo.id, git.path)
      const owned =
        readWorktreeMetaForHost(deps.store, id, hostId) ??
        getRepoOwnedWorktreeMeta(repo, id, metaById, repoOwnerCount)
      const registered = hasStrongOrcaMetadata(owned)
        ? undefined
        : registeredLocalWorktreePath(repo, git.path, projectedMeta ?? metaById, repoOwnerCount)
      // A creation record already lives on the directory-entry spelling. Do not stamp a second thin row.
      if (registered?.meta.instanceId) {
        continue
      }
      const stampId = registered ? composeWorktreeId(repo.id, registered.path) : id
      const stampMeta = registered?.meta ?? owned
      if (!stampMeta?.instanceId && (stampMeta || (!metaById[stampId] && repoOwnerCount === 1))) {
        projectedMeta ??= { ...metaById }
        projectedMeta[stampId] = deps.store.setWorktreeMeta(
          hostWorktreeTarget({ id: stampId, hostId }),
          {}
        )
      }
    }
  }
  return projectRepoWorktreeRows(deps, repo, scan, projectedMeta ?? metaById, repoOwnerCount)
}

/** One repo's worktree rows before lineage projection. Shared by the fleet scan and scoped lookups. */
export async function resolveRepoWorktreeRows(
  deps: RepoWorktreeRowDeps,
  repo: Repo,
  metaById: Record<string, WorktreeMeta>,
  projectRuntimeByRepoId: ReadonlyMap<string, ProjectExecutionRuntimeResolution>,
  repoOwnerCount = deps.store.getRepos().filter((candidate) => candidate.id === repo.id).length
): Promise<RepoWorktreeRow[]> {
  const scan = isFolderRepo(repo)
    ? null
    : await scanRepoWorktreeRows(deps, repo, projectRuntimeByRepoId, repoOwnerCount)
  await primeLocalWorktreeDirectoryAliases(repo, scan?.worktrees ?? [], metaById, repoOwnerCount)
  return joinRepoWorktreeRows(deps, repo, scan, metaById, repoOwnerCount)
}
