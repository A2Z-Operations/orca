import type { Stats } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const statMock = vi.hoisted(() => vi.fn())
vi.mock('node:fs/promises', () => ({ stat: statMock }))

import {
  localPathsAreSameDirectory,
  rememberLocalDirectoryIdentity
} from './local-worktree-directory-alias'

function directory(ino: number): Stats {
  return { isDirectory: () => true, dev: 7, ino } as unknown as Stats
}

function missing(): NodeJS.ErrnoException {
  return Object.assign(new Error('ENOENT: no such file or directory'), { code: 'ENOENT' })
}

describe('rememberLocalDirectoryIdentity', () => {
  beforeEach(() => {
    statMock.mockReset()
  })

  it('does not cache a failed stat: a case-split checkout re-created under the same name joins', async () => {
    // A hand-deleted worktree stays in git's list (prunable), so the sweep or a listing primes its pair.
    const gitPath = '/ws/BLOWzer/reborn'
    const metaPath = '/ws/Blowzer/reborn'
    statMock.mockRejectedValue(missing())
    expect(await rememberLocalDirectoryIdentity(gitPath, metaPath)).toBe(false)
    expect(localPathsAreSameDirectory(gitPath, metaPath)).toBe(false)

    // Re-created with the same name: both spellings now stat to one directory.
    statMock.mockReset()
    statMock.mockResolvedValue(directory(42))
    expect(await rememberLocalDirectoryIdentity(gitPath, metaPath)).toBe(true)
    expect(localPathsAreSameDirectory(gitPath, metaPath)).toBe(true)
    expect(statMock).toHaveBeenCalledTimes(2)
  })

  it('caches an answered comparison, same or different, and does not stat again', async () => {
    statMock.mockImplementation(async (path: string) => directory(path.includes('Two') ? 2 : 1))
    expect(await rememberLocalDirectoryIdentity('/ws/One/a', '/ws/one/a')).toBe(true)
    expect(await rememberLocalDirectoryIdentity('/ws/Two/b', '/ws/two/b')).toBe(false)
    const calls = statMock.mock.calls.length
    expect(await rememberLocalDirectoryIdentity('/ws/One/a', '/ws/one/a')).toBe(true)
    expect(await rememberLocalDirectoryIdentity('/ws/Two/b', '/ws/two/b')).toBe(false)
    expect(statMock.mock.calls.length).toBe(calls)
  })
})
