import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { fetchUpstreamReleaseTags } from './fetch-upstream-release-tags.mjs'

// A local repository stands in for upstream: the test never reaches the network.
const roots = []

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

function git(cwd, ...args) {
  const result = spawnSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 't',
      GIT_AUTHOR_EMAIL: 't@example.invalid',
      GIT_COMMITTER_NAME: 't',
      GIT_COMMITTER_EMAIL: 't@example.invalid'
    }
  })
  expect(result.status, result.stderr).toBe(0)
  return result.stdout.trim()
}

function repos() {
  const root = mkdtempSync(join(tmpdir(), 'orca-fork-tags-'))
  roots.push(root)
  const upstream = join(root, 'upstream')
  git(root, 'init', '--quiet', '-b', 'main', upstream)
  git(upstream, 'commit', '--quiet', '--allow-empty', '-m', 'one')
  git(upstream, 'tag', 'v1.0.0')
  git(upstream, 'checkout', '--quiet', '-b', 'release/1.0')
  git(upstream, 'commit', '--quiet', '--allow-empty', '-m', 'release-branch fix')
  git(upstream, 'tag', '-a', 'v1.0.1', '-m', 'v1.0.1')
  git(upstream, 'tag', 'nightly-1')
  git(upstream, 'checkout', '--quiet', 'main')
  const fork = join(root, 'fork')
  git(root, 'clone', '--quiet', '--no-tags', '--single-branch', upstream, fork)
  return { upstream, fork }
}

it('fetches only upstream v* tags, including ones on a release branch the clone does not have', () => {
  const { upstream, fork } = repos()
  expect(git(fork, 'tag', '--list')).toBe('')

  expect(fetchUpstreamReleaseTags({ repo: fork, upstream })).toEqual({
    before: 0,
    after: 2,
    fetched: true
  })
  expect(git(fork, 'tag', '--list').split('\n')).toEqual(['v1.0.0', 'v1.0.1'])
  expect(git(fork, 'rev-parse', 'v1.0.1^{commit}')).toBe(
    git(upstream, 'rev-parse', 'v1.0.1^{commit}')
  )
  expect(git(fork, 'branch', '--list', '--all')).not.toContain('release/1.0')
})

it('is idempotent', () => {
  const { upstream, fork } = repos()
  fetchUpstreamReleaseTags({ repo: fork, upstream })
  expect(fetchUpstreamReleaseTags({ repo: fork, upstream })).toEqual({
    before: 2,
    after: 2,
    fetched: true
  })
})

it('fails loudly when upstream cannot be read', () => {
  const { fork } = repos()
  expect(() => fetchUpstreamReleaseTags({ repo: fork, upstream: join(fork, 'missing') })).toThrow(
    /git fetch .* failed/
  )
})

it('--if-missing leaves a clone that already has release tags alone, without reaching upstream', () => {
  const { upstream, fork } = repos()
  fetchUpstreamReleaseTags({ repo: fork, upstream })
  const missing = join(fork, 'missing')
  expect(fetchUpstreamReleaseTags({ repo: fork, upstream: missing, ifMissing: true })).toEqual({
    before: 2,
    after: 2,
    fetched: false
  })
})

it('--if-missing still fetches into a clone with no release tags', () => {
  const { upstream, fork } = repos()
  expect(fetchUpstreamReleaseTags({ repo: fork, upstream, ifMissing: true })).toEqual({
    before: 0,
    after: 2,
    fetched: true
  })
})
