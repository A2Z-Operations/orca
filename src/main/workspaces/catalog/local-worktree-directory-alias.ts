import { stat } from 'node:fs/promises'
import { getRepoRoutingConnectionId } from '../../../shared/execution-host'
import { normalizeRuntimePathForComparison } from '../../../shared/cross-platform-path'
import { hasStrongOrcaMetadata } from '../../../shared/worktree/ownership'
import { composeWorktreeId, splitWorktreeId } from '../../../shared/worktree/id'
import type { Repo } from '../../../shared/repo-types'
import type { WorktreeMeta } from '../../../shared/worktree/meta-types'
import { looksLikePosixAbsolutePath } from '../../git/worktrees/catalog/worktree-path-comparison'
import { isWorktreeMetaOwnedByRepo } from './worktree-metadata-ownership'

const directoryIdentityCache = new Map<string, boolean>()

function directoryIdentityCacheKey(left: string, right: string): string {
  const leftKey = normalizeRuntimePathForComparison(left)
  const rightKey = normalizeRuntimePathForComparison(right)
  return leftKey < rightKey ? `${leftKey}\0${rightKey}` : `${rightKey}\0${leftKey}`
}

/**
 * Same directory on a case-insensitive volume. A case-only pair is the same
 * checkout only after `rememberLocalDirectoryIdentity` has compared device and
 * inode; a cold cache stays false so a case-sensitive volume is never folded.
 */
export function localPathsAreSameDirectory(left: string, right: string): boolean {
  const leftKey = normalizeRuntimePathForComparison(left)
  const rightKey = normalizeRuntimePathForComparison(right)
  if (leftKey === rightKey) {
    return true
  }
  if (leftKey.toLowerCase() !== rightKey.toLowerCase()) {
    return false
  }
  if (!looksLikePosixAbsolutePath(left) || !looksLikePosixAbsolutePath(right)) {
    return false
  }
  return directoryIdentityCache.get(directoryIdentityCacheKey(left, right)) ?? false
}

/** Record whether two case-different paths are one directory. Remote repos are not stated locally. */
export async function rememberLocalDirectoryIdentity(
  left: string,
  right: string
): Promise<boolean> {
  const leftKey = normalizeRuntimePathForComparison(left)
  const rightKey = normalizeRuntimePathForComparison(right)
  if (leftKey === rightKey) {
    return true
  }
  if (leftKey.toLowerCase() !== rightKey.toLowerCase()) {
    return false
  }
  if (!looksLikePosixAbsolutePath(left) || !looksLikePosixAbsolutePath(right)) {
    return false
  }
  const key = directoryIdentityCacheKey(left, right)
  const cached = directoryIdentityCache.get(key)
  if (cached !== undefined) {
    return cached
  }
  let same = false
  try {
    const [leftStat, rightStat] = await Promise.all([stat(left), stat(right)])
    same =
      leftStat.isDirectory() &&
      rightStat.isDirectory() &&
      leftStat.dev === rightStat.dev &&
      leftStat.ino === rightStat.ino
  } catch {
    same = false
  }
  directoryIdentityCache.set(key, same)
  return same
}

/** Warm the directory cache for git spellings that differ from a creation record only by case. */
export async function primeLocalWorktreeDirectoryAliases(
  repo: Pick<Repo, 'id' | 'connectionId' | 'executionHostId'>,
  gitWorktrees: readonly { path: string }[],
  metaById: Readonly<Record<string, WorktreeMeta>>,
  repoOwnerCount: number
): Promise<void> {
  if (getRepoRoutingConnectionId(repo)) {
    return
  }
  const pending: Promise<boolean>[] = []
  for (const gitWorktree of gitWorktrees) {
    const gitPath = gitWorktree.path
    const folded = normalizeRuntimePathForComparison(gitPath).toLowerCase()
    for (const [worktreeId, meta] of Object.entries(metaById)) {
      if (!isWorktreeMetaOwnedByRepo(repo, meta, repoOwnerCount)) {
        continue
      }
      const parsed = splitWorktreeId(worktreeId)
      if (!parsed || parsed.repoId !== repo.id || !parsed.worktreePath) {
        continue
      }
      const candidateKey = normalizeRuntimePathForComparison(parsed.worktreePath)
      if (
        candidateKey.toLowerCase() !== folded ||
        candidateKey === normalizeRuntimePathForComparison(gitPath)
      ) {
        continue
      }
      pending.push(rememberLocalDirectoryIdentity(gitPath, parsed.worktreePath))
    }
  }
  await Promise.all(pending)
}

export type RegisteredWorktreePath = {
  path: string
  meta: WorktreeMeta
}

/**
 * `git worktree list` keeps the spelling passed to `worktree add`. Create stores
 * metadata under `rev-parse --show-toplevel`, the directory entry. On a
 * case-insensitive volume those are one checkout; publish the creation record.
 */
export function registeredLocalWorktreePath(
  repo: Pick<Repo, 'id' | 'connectionId' | 'executionHostId'>,
  gitPath: string,
  metaById: Readonly<Record<string, WorktreeMeta>>,
  repoOwnerCount: number
): RegisteredWorktreePath | undefined {
  const gitKey = normalizeRuntimePathForComparison(gitPath)
  const folded = gitKey.toLowerCase()
  let created: RegisteredWorktreePath | undefined
  for (const [worktreeId, meta] of Object.entries(metaById)) {
    if (!isWorktreeMetaOwnedByRepo(repo, meta, repoOwnerCount)) {
      continue
    }
    const parsed = splitWorktreeId(worktreeId)
    if (!parsed || parsed.repoId !== repo.id || !parsed.worktreePath) {
      continue
    }
    const candidateKey = normalizeRuntimePathForComparison(parsed.worktreePath)
    if (candidateKey.toLowerCase() !== folded) {
      continue
    }
    if (candidateKey === gitKey) {
      if (hasStrongOrcaMetadata(meta)) {
        return undefined
      }
      continue
    }
    if (!hasStrongOrcaMetadata(meta) || !localPathsAreSameDirectory(gitPath, parsed.worktreePath)) {
      continue
    }
    created ??= { path: parsed.worktreePath, meta }
  }
  return created
}

/** Publish the creation record when git's spelling is only a case alias of that directory. */
export function resolveRegisteredLocalWorktreeListing<T extends { path: string }>(
  repo: Pick<Repo, 'id' | 'connectionId' | 'executionHostId'>,
  gitWorktree: T,
  exact: WorktreeMeta | undefined,
  metaById: Readonly<Record<string, WorktreeMeta>>,
  repoOwnerCount: number
): { listed: T; meta: WorktreeMeta | undefined; id: string } {
  const registered = hasStrongOrcaMetadata(exact)
    ? undefined
    : registeredLocalWorktreePath(repo, gitWorktree.path, metaById, repoOwnerCount)
  if (!registered) {
    return {
      listed: gitWorktree,
      meta: exact,
      id: composeWorktreeId(repo.id, gitWorktree.path)
    }
  }
  return {
    listed: { ...gitWorktree, path: registered.path },
    meta: preferCreatedWorktreeMeta(registered.meta, exact),
    id: composeWorktreeId(repo.id, registered.path)
  }
}

/** Keep activity written against the git spelling without letting that thin row hide the creation record. */
export function preferCreatedWorktreeMeta(
  created: WorktreeMeta,
  gitSpelling: WorktreeMeta | undefined
): WorktreeMeta {
  if (!gitSpelling) {
    return created
  }
  return {
    ...gitSpelling,
    ...created,
    comment: created.comment || gitSpelling.comment,
    lastActivityAt: created.lastActivityAt || gitSpelling.lastActivityAt,
    displayName: created.displayName || gitSpelling.displayName,
    instanceId: created.instanceId || gitSpelling.instanceId,
    isUnread: created.isUnread || gitSpelling.isUnread,
    workspaceStatus: created.workspaceStatus ?? gitSpelling.workspaceStatus
  }
}

/**
 * Case-only path splits must resolve to the creation record. Other spelling
 * differences (symlinks, `/private/tmp`) stay on the existing success path.
 */
export async function createdWorktreeRegistrationHolds(
  repo: Pick<Repo, 'id' | 'connectionId' | 'executionHostId'>,
  gitRecordedPath: string,
  metadataPath: string,
  metaById: Readonly<Record<string, WorktreeMeta>>,
  repoOwnerCount = 1
): Promise<boolean> {
  const recorded = normalizeRuntimePathForComparison(gitRecordedPath)
  const registered = normalizeRuntimePathForComparison(metadataPath)
  if (recorded === registered || recorded.toLowerCase() !== registered.toLowerCase()) {
    return true
  }
  if (!(await rememberLocalDirectoryIdentity(gitRecordedPath, metadataPath))) {
    return false
  }
  const alias = registeredLocalWorktreePath(repo, gitRecordedPath, metaById, repoOwnerCount)
  return (
    alias !== undefined &&
    hasStrongOrcaMetadata(alias.meta) &&
    localPathsAreSameDirectory(alias.path, metadataPath)
  )
}
