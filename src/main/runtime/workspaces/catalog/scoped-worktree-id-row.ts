import { getRepoExecutionHostId, type ExecutionHostId } from '../../../../shared/execution-host'
import { splitWorktreeIdForFilesystem, worktreeIdentityKey } from '../../../../shared/worktree/id'
import {
  getConnectedWorktreeLineageIds,
  projectResolvedWorktreeLineage
} from '../../../../shared/resolved-worktree-lineage'
import { localPathsAreSameDirectory } from '../../../workspaces/catalog/local-worktree-directory-alias'
import { resolveLocalProjectRuntimesForRepos } from '../../../workspaces/execution-host/local-project-runtime-resolution'
import {
  resolveRepoWorktreeRows,
  type RepoWorktreeRow,
  type RepoWorktreeRowDeps
} from './repo-worktree-row-resolution'

/** Resolve one id through its host owner and lineage repos; ambiguous ownership returns null for fleet fallback. */
export async function resolveScopedWorktreeIdRow(
  deps: RepoWorktreeRowDeps,
  worktreeId: string,
  requiredHostId?: ExecutionHostId
): Promise<RepoWorktreeRow | null> {
  const { store } = deps
  const parsed = splitWorktreeIdForFilesystem(worktreeId)
  if (!parsed?.repoId || !parsed.worktreePath) {
    return null
  }
  const owners = store
    .getRepos()
    .filter(
      (repo) =>
        repo.id === parsed.repoId &&
        (requiredHostId === undefined || getRepoExecutionHostId(repo) === requiredHostId)
    )
  // Only fleet scans disambiguate multiple unqualified owners; scoped lookup must not guess.
  if (owners.length !== 1) {
    return null
  }
  const repo = owners[0]
  const ownerRows = await resolveRepoWorktreeRows(
    deps,
    repo,
    store.getAllWorktreeMeta() ?? {},
    resolveLocalProjectRuntimesForRepos(store, [repo])
  )
  // Accept one normalized equivalent id; multiple path matches remain ambiguous (#16243).
  const comparisonKey = worktreeIdentityKey(worktreeId)
  const exact = ownerRows.find((worktree) => worktree.id === worktreeId)
  const equivalent = ownerRows.filter(
    (worktree) => worktreeIdentityKey(worktree.id) === comparisonKey
  )
  const sameDirectory =
    exact || equivalent.length > 0
      ? []
      : ownerRows.filter((worktree) =>
          localPathsAreSameDirectory(worktree.path, parsed.worktreePath)
        )
  const target =
    exact ??
    (equivalent.length === 1 ? equivalent[0] : null) ??
    (sameDirectory.length === 1 ? sameDirectory[0] : null)
  if (!target) {
    return null
  }
  const lineageById = store.getAllWorktreeLineage?.() ?? {}
  const relatedIds = getConnectedWorktreeLineageIds([target.id], lineageById)
  const relatedRepoIds = new Set(
    [...relatedIds]
      .map((id) => splitWorktreeIdForFilesystem(id)?.repoId)
      .filter((id) => id !== undefined)
  )
  relatedRepoIds.delete(repo.id)
  const hostId = getRepoExecutionHostId(repo)
  const relatedRepos = store
    .getRepos()
    .filter(
      (candidate) =>
        relatedRepoIds.has(candidate.id) && getRepoExecutionHostId(candidate) === hostId
    )
  if (new Set(relatedRepos.map((candidate) => candidate.id)).size !== relatedRepos.length) {
    return null
  }
  const metaById = store.getAllWorktreeMeta() ?? {}
  const projectRuntimeByRepoId = resolveLocalProjectRuntimesForRepos(store, relatedRepos)
  const otherRows = await Promise.all(
    relatedRepos.map((relatedRepo) =>
      resolveRepoWorktreeRows(deps, relatedRepo, metaById, projectRuntimeByRepoId)
    )
  )
  const projected = projectResolvedWorktreeLineage([...ownerRows, ...otherRows.flat()], lineageById)
  return projected[ownerRows.indexOf(target)] ?? null
}
