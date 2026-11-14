import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, realpathSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { LOCAL_EXECUTION_HOST_ID } from '../../../../shared/execution-host'
import type { Repo } from '../../../../shared/repo-types'
import { composeWorktreeId } from '../../../../shared/worktree/id'
import type { WorktreeMeta } from '../../../../shared/worktree/meta-types'
import { toDetectedWorktree } from '../../../../shared/worktree/ownership'
import type { GitWorktreeInfo } from '../../../../shared/worktree/types'
import type { Store } from '../../../persistence/loading-store/store'
import {
  createdWorktreeRegistrationHolds,
  primeLocalWorktreeDirectoryAliases,
  registeredLocalWorktreePath
} from '../../../workspaces/catalog/local-worktree-directory-alias'
import { joinRepoWorktreeRows, type RepoWorktreeRowDeps } from './repo-worktree-row-resolution'
import { runtimePathsEqual } from './runtime-worktree-path-identity'

const GIT_IDENTITY = {
  GIT_AUTHOR_NAME: 'Nachumi Eliyahu',
  GIT_AUTHOR_EMAIL: 'nachumi@a2zoperations.com',
  GIT_COMMITTER_NAME: 'Nachumi Eliyahu',
  GIT_COMMITTER_EMAIL: 'nachumi@a2zoperations.com'
}
const LINKED_WORKTREE_COUNT = 8
const REPO_ID = 'repo-blowzer-case'

function directoryCaseFolds(parent: string): boolean {
  const canonical = join(parent, 'CaseFoldProbe')
  mkdirSync(canonical)
  try {
    const folded = statSync(join(parent, 'casefoldprobe'))
    const created = statSync(canonical)
    return (
      created.isDirectory() &&
      folded.isDirectory() &&
      created.dev === folded.dev &&
      created.ino === folded.ino
    )
  } catch {
    return false
  } finally {
    rmSync(canonical, { recursive: true, force: true })
  }
}

function volumeFoldsDirectoryCase(): boolean {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'orca-case-probe-')))
  try {
    return directoryCaseFolds(parent)
  } finally {
    rmSync(parent, { recursive: true, force: true })
  }
}

const foldsDirectoryCase = volumeFoldsDirectoryCase()

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    env: { ...process.env, ...GIT_IDENTITY },
    encoding: 'utf8'
  })
}

function porcelainWorktrees(repoPath: string): GitWorktreeInfo[] {
  const text = git(repoPath, ['worktree', 'list', '--porcelain'])
  const worktrees: GitWorktreeInfo[] = []
  let path = ''
  let head = ''
  let branch = ''
  const push = () => {
    if (!path) {
      return
    }
    worktrees.push({
      path,
      head,
      branch,
      isBare: false,
      isMainWorktree: path === repoPath
    })
    path = ''
    head = ''
    branch = ''
  }
  for (const line of text.split('\n')) {
    if (line.startsWith('worktree ')) {
      push()
      path = line.slice('worktree '.length)
    } else if (line.startsWith('HEAD ')) {
      head = line.slice('HEAD '.length)
    } else if (line.startsWith('branch ')) {
      branch = line.slice('branch '.length)
    } else if (line === '') {
      push()
    }
  }
  push()
  return worktrees
}

function metaShell(overrides: Partial<WorktreeMeta>): WorktreeMeta {
  return Object.assign(
    {
      displayName: '',
      comment: '',
      linkedIssue: null,
      linkedPR: null,
      linkedLinearIssue: null,
      isArchived: false,
      isUnread: false,
      isPinned: false,
      sortOrder: 1,
      lastActivityAt: 10,
      workspaceStatus: 'todo'
    },
    overrides
  )
}

function blowzerRepo(path: string): Repo {
  return {
    id: REPO_ID,
    path,
    displayName: 'BLOWzer',
    badgeColor: 'blue',
    addedAt: Date.UTC(2026, 10, 1),
    externalWorktreeVisibilityLegacy: false
  }
}

describe('case-distinct local worktree registration', () => {
  const roots: string[] = []
  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('does not treat a different directory or a missing case variant as the same checkout', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'orca-case-distinct-')))
    roots.push(root)
    const alpha = join(root, 'alpha')
    const beta = join(root, 'beta')
    mkdirSync(alpha)
    mkdirSync(beta)
    const repo = blowzerRepo(join(root, 'BLOWzer'))
    const meta = {
      [composeWorktreeId(REPO_ID, alpha)]: metaShell({
        instanceId: 'alpha',
        createdAt: 1_700_000_000_000,
        orcaCreatedAt: 1_700_000_000_000
      })
    }
    expect(registeredLocalWorktreePath(repo, beta, meta, 1)).toBeUndefined()
    expect(
      registeredLocalWorktreePath(
        repo,
        join(root, 'BLOWzer', 'missing'),
        {
          [composeWorktreeId(REPO_ID, join(root, 'Blowzer', 'missing'))]: metaShell({
            createdAt: 1_700_000_000_000
          })
        },
        1
      )
    ).toBeUndefined()
    await expect(createdWorktreeRegistrationHolds(repo, alpha, alpha, meta, 1)).resolves.toBe(true)
    await expect(createdWorktreeRegistrationHolds(repo, alpha, beta, {}, 1)).resolves.toBe(true)
    await expect(
      createdWorktreeRegistrationHolds(
        repo,
        join(root, 'BLOWzer', 'missing'),
        join(root, 'Blowzer', 'missing'),
        {},
        1
      )
    ).resolves.toBe(false)
  })

  it.skipIf(!foldsDirectoryCase)(
    'lists created worktrees when git records a different case than the workspace directory',
    async () => {
      const root = realpathSync(mkdtempSync(join(tmpdir(), 'orca-blowzer-worktrees-')))
      roots.push(root)
      const repoPath = join(root, 'Documents', 'claude', 'BLOWzer')
      const workspaces = join(root, 'orca', 'workspaces')
      mkdirSync(join(workspaces, 'Blowzer'), { recursive: true })
      mkdirSync(repoPath, { recursive: true })
      git(repoPath, ['init', '-q', '-b', 'main'])
      git(repoPath, ['commit', '-q', '--allow-empty', '-m', 'init'])
      for (let index = 0; index < LINKED_WORKTREE_COUNT; index += 1) {
        git(repoPath, [
          'worktree',
          'add',
          '-q',
          '-b',
          `nachumi-a2zoperations/probe-${index}`,
          join(workspaces, 'BLOWzer', `probe-${index}`)
        ])
      }
      git(repoPath, [
        'worktree',
        'add',
        '-q',
        '-b',
        'nachumi-a2zoperations/external-checkout',
        join(root, 'external-checkout')
      ])

      const scanned = porcelainWorktrees(repoPath)
      const linkedGit = scanned.filter((worktree) => worktree.path.includes('/BLOWzer/probe-'))
      expect(linkedGit).toHaveLength(LINKED_WORKTREE_COUNT)
      const repo = blowzerRepo(repoPath)
      const metaById: Record<string, WorktreeMeta> = {}
      const canonicalByGitPath = new Map<string, string>()
      for (const worktree of linkedGit) {
        const canonical = git(worktree.path, ['rev-parse', '--show-toplevel']).trim()
        expect(canonical).not.toBe(worktree.path)
        expect(canonical).toContain('/Blowzer/')
        canonicalByGitPath.set(worktree.path, canonical)
        const name = canonical.slice(canonical.lastIndexOf('/') + 1)
        metaById[composeWorktreeId(REPO_ID, canonical)] = metaShell({
          instanceId: `created-${name}`,
          displayName: name,
          comment: '',
          createdAt: 1_700_000_000_000,
          orcaCreatedAt: 1_700_000_000_000,
          orcaCreationSource: 'runtime',
          orcaCreationWorkspaceLayout: { path: workspaces, nestWorkspaces: true }
        })
        metaById[composeWorktreeId(REPO_ID, worktree.path)] = metaShell({
          instanceId: `thin-${name}`,
          hostId: LOCAL_EXECUTION_HOST_ID,
          displayName: name,
          comment: name === 'probe-0' ? 'kept-note' : '',
          lastActivityAt: 20
        })
      }
      const canonicalProbe = canonicalByGitPath.get(linkedGit[0].path)
      expect(canonicalProbe).toBeTruthy()
      await expect(
        createdWorktreeRegistrationHolds(repo, linkedGit[0].path, canonicalProbe ?? '', metaById, 1)
      ).resolves.toBe(true)
      expect(runtimePathsEqual(linkedGit[0].path, canonicalProbe ?? '')).toBe(true)

      const store = {
        getRepos: () => [repo],
        getAllWorktreeMeta: () => metaById,
        getAllWorktreeLineage: () => ({}),
        getProjects: () => [],
        getSettings: () => ({}),
        setWorktreeMeta: (target: { id: string }, updates: Partial<WorktreeMeta>) => {
          const next = Object.assign(metaShell({}), metaById[target.id] ?? {}, updates)
          metaById[target.id] = next
          return next
        }
      }
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: a partial store mock; the join reads only the members this object defines.
      const typedStore = store as unknown as Store
      const deps: RepoWorktreeRowDeps = {
        store: typedStore,
        scanRepo: async () => ({ ok: true, worktrees: scanned }),
        listFolderWorkspaces: () => []
      }
      const settings: Pick<
        GlobalSettings,
        'workspaceDir' | 'nestWorkspaces' | 'workspaceDirHistory' | 'worktreeVisibilityDefaults'
      > = {
        workspaceDir: workspaces,
        nestWorkspaces: true,
        workspaceDirHistory: []
      }
      await primeLocalWorktreeDirectoryAliases(repo, linkedGit, metaById, 1)
      const detected = joinRepoWorktreeRows(
        deps,
        repo,
        { ok: true, worktrees: scanned },
        metaById
      ).map((worktree) =>
        toDetectedWorktree({
          repo,
          worktree,
          meta: metaById[worktree.id],
          settings,
          knownOrcaLayouts: [{ path: workspaces, nestWorkspaces: true }],
          isLegacyRepoForVisibility: false
        })
      )
      const visibleLinked = detected.filter((worktree) => worktree.path.includes('/Blowzer/probe-'))
      expect(visibleLinked).toHaveLength(LINKED_WORKTREE_COUNT)
      for (const worktree of visibleLinked) {
        expect(worktree.visible).toBe(true)
        expect(worktree.ownership).toBe('orca-managed')
        expect(worktree.path).toContain('/Blowzer/')
        expect(worktree.path).not.toContain('/BLOWzer/')
        expect(worktree.id).toBe(composeWorktreeId(REPO_ID, worktree.path))
      }
      expect(visibleLinked.find((worktree) => worktree.path.endsWith('/probe-0'))?.comment).toBe(
        'kept-note'
      )
      expect(detected.find((worktree) => worktree.isMainWorktree)?.visible).toBe(true)
      expect(
        detected.find((worktree) => worktree.path.endsWith('/external-checkout'))?.visible
      ).toBe(false)
      expect(detected.filter((worktree) => worktree.visible)).toHaveLength(
        LINKED_WORKTREE_COUNT + 1
      )
    }
  )
})
