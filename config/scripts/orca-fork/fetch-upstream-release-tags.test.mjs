import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { fetchUpstreamReleaseTags, pinnedReleaseRefs } from './fetch-upstream-release-tags.mjs'

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
    fetched: true,
    missing: []
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
    fetched: true,
    missing: []
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
    fetched: false,
    missing: []
  })
})

it('--if-missing still fetches into a clone with no release tags', () => {
  const { upstream, fork } = repos()
  expect(fetchUpstreamReleaseTags({ repo: fork, upstream, ifMissing: true })).toEqual({
    before: 0,
    after: 2,
    fetched: true,
    missing: []
  })
})

/** The fork checkout as the tests see it: a version, and cross-version tests that pin release refs. */
function pin(fork, version, refs) {
  writeFileSync(join(fork, 'package.json'), JSON.stringify({ version }))
  const dir = join(fork, 'tests', 'e2e', 'cross-version-wire')
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'pins.unit.test.ts'),
    refs.map((ref, index) => `const PIN_${index} = '${ref}'\n`).join('')
  )
}

// orca #55 (PR 50 should-fix): a clone holding only some release tags (for example those in the fork's own history)
// must still fetch when a ref the cross-version tests pin is absent; "any v* tag present" is not enough.
it('--if-missing fetches when a pinned release ref is absent, although other v* tags are present', () => {
  const { upstream, fork } = repos()
  git(fork, 'fetch', '--quiet', '--no-tags', upstream, 'refs/tags/v1.0.0:refs/tags/v1.0.0')
  pin(fork, '1.0.1', ['v1.0.0', 'v1.0.1'])
  expect(fetchUpstreamReleaseTags({ repo: fork, upstream, ifMissing: true })).toMatchObject({
    before: 1,
    after: 2,
    fetched: true,
    missing: ['v1.0.1']
  })
})

it('--if-missing leaves a clone alone when every pinned release ref is there', () => {
  const { upstream, fork } = repos()
  fetchUpstreamReleaseTags({ repo: fork, upstream })
  pin(fork, '1.0.1', ['v1.0.0', 'v1.0.1'])
  expect(
    fetchUpstreamReleaseTags({ repo: fork, upstream: join(fork, 'missing'), ifMissing: true })
  ).toMatchObject({ fetched: false, missing: [] })
})

it('reads the pinned refs from the cross-version tests, never one newer than the checkout', () => {
  const { fork } = repos()
  pin(fork, '1.4.255', ['v1.4.190', 'v1.4.255', 'v1.4.259', 'v1.4.190'])
  expect(pinnedReleaseRefs(fork)).toEqual(['v1.4.190', 'v1.4.255'])
})

// orca #55 (PR 50 nit): an upstream starting with "-" would be parsed by git as an option.
it('refuses an upstream that starts with a dash, before git sees it', () => {
  const { fork } = repos()
  expect(() => fetchUpstreamReleaseTags({ repo: fork, upstream: '--upload-pack=touch x' })).toThrow(
    /upstream must not start with "-"/
  )
})
