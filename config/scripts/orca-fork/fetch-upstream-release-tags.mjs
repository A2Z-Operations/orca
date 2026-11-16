#!/usr/bin/env node
// Fork (#48): put upstream's release tags (v*) into this clone, so the cross-version wire tests find their baselines.
//
// Why: those tests check this build against released builds by tag (the newest release not newer than this checkout,
// plus fixed older ones such as v1.4.190), and fail rather than skip when a tag is missing. The fork repo carries no
// tags, so every clone of it had none and about 40 cross-version files failed. Upstream's release tags are read-only
// facts about published builds; only tags are fetched, and nothing is pushed anywhere.
//
// The preflight's unit step runs it with --if-missing: it fetches only when the clone has no release tag, or lacks a
// release ref the cross-version tests pin (read from those tests, #55); otherwise upstream is not contacted. A clone
// with only the fork's own history's tags therefore still fetches, since many pinned releases sit on upstream release
// branches.
//
// Only release tags NOT NEWER than the checkout's package.json version are fetched (#48 slice 14): a newer release is
// never a baseline, and the skill-bundle ledger reads SKILL.md from every v* tag, so upstream v1.4.256's skill text made
// the fork's (1.4.255) "skill bundle manifest" check stale. With no readable version, every v* tag is fetched as before.
// --prune-newer deletes the local v* tags newer than the checkout (a one-time step for clones fetched before this).
//
// Usage: node config/scripts/orca-fork/fetch-upstream-release-tags.mjs [--if-missing] [--prune-newer] [--upstream <url or path>] [--repo <checkout>]
import { spawnSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { compareReleaseTags } from '../release/versioning/stable-release-tags.mjs'

export const DEFAULT_UPSTREAM = 'https://github.com/stablyai/orca'
const RELEASE_TAG_REFSPEC = 'refs/tags/v*:refs/tags/v*'
const CROSS_VERSION_TESTS = join('tests', 'e2e', 'cross-version-wire')
const RELEASE_REF_LITERAL = /['"`](v\d+\.\d+\.\d+)['"`]/g

function git(repo, args, input) {
  const result = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8', input })
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${(result.stderr || result.stdout).trim()}`)
  }
  return result.stdout.trim()
}

function releaseTagCount(repo) {
  return git(repo, ['tag', '--list', 'v[0-9]*']).split('\n').filter(Boolean).length
}

function checkoutVersion(repo) {
  try {
    const manifest = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'))
    return /^v?(\d+\.\d+\.\d+)/.exec(String(manifest?.version ?? ''))?.[1] ?? null
  } catch {
    return null
  }
}

/**
 * The release refs the cross-version tests name ('vX.Y.Z' literals in tests/e2e/cross-version-wire), never one newer
 * than the checkout's own version: the harness never uses one, so it is not a pin (a test may list later tags as data).
 */
export function pinnedReleaseRefs(repo) {
  let files
  try {
    files = readdirSync(join(repo, CROSS_VERSION_TESTS), { recursive: true }).map(String)
  } catch {
    return []
  }
  const version = checkoutVersion(repo)
  const refs = new Set()
  for (const file of files.filter((name) => /\.[cm]?[jt]sx?$/.test(name))) {
    const source = readFileSync(join(repo, CROSS_VERSION_TESTS, file), 'utf8')
    for (const [, ref] of source.matchAll(RELEASE_REF_LITERAL)) {
      if (version === null || compareReleaseTags(ref, `v${version}`) <= 0) {
        refs.add(ref)
      }
    }
  }
  return [...refs].sort(compareReleaseTags)
}

function hasTag(repo, ref) {
  return (
    spawnSync('git', ['-C', repo, 'rev-parse', '-q', '--verify', `refs/tags/${ref}^{commit}`], {
      encoding: 'utf8'
    }).status === 0
  )
}

/**
 * Fetches upstream's v* tags into `repo` (no other refs, no tag that moved is overwritten); returns the counts.
 * `ifMissing` fetches only when the clone has no release tag or lacks a pinned release ref. `missing` lists the pins
 * absent before (all of them on a clone with no release tag), `stillMissing` those a fetch did not bring (#61).
 */
export function fetchUpstreamReleaseTags({ repo, upstream = DEFAULT_UPSTREAM, ifMissing = false }) {
  // Passed to git positionally: a leading dash would be read as an option (#55).
  if (String(upstream).startsWith('-')) {
    throw new Error(`upstream must not start with "-": ${upstream}`)
  }
  const before = releaseTagCount(repo)
  const missing = pinnedReleaseRefs(repo).filter((ref) => !hasTag(repo, ref))
  if (ifMissing && before > 0 && missing.length === 0) {
    return { before, after: before, fetched: false, missing, stillMissing: [] }
  }
  const version = checkoutVersion(repo)
  if (version === null) {
    git(repo, ['fetch', '--quiet', '--no-tags', upstream, RELEASE_TAG_REFSPEC])
  } else {
    const wanted = upstreamReleaseTags(repo, upstream).filter(
      (tag) => compareReleaseTags(tag, `v${version}`) <= 0
    )
    if (wanted.length > 0) {
      // One refspec per tag on stdin: no command-line limit with ~1,100 tags.
      git(
        repo,
        ['fetch', '--quiet', '--no-tags', '--stdin', upstream],
        `${wanted.map((tag) => `refs/tags/${tag}:refs/tags/${tag}`).join('\n')}\n`
      )
    }
  }
  const stillMissing = missing.filter((ref) => !hasTag(repo, ref))
  return { before, after: releaseTagCount(repo), fetched: true, missing, stillMissing }
}

/** Upstream's v<digits>* tag names (peeled entries left out). */
function upstreamReleaseTags(repo, upstream) {
  return git(repo, ['ls-remote', '--tags', '--refs', upstream, 'refs/tags/v[0-9]*'])
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split('\t')[1].slice('refs/tags/'.length))
}

/** Deletes the local v* release tags newer than the checkout's version; returns their names. */
export function pruneNewerReleaseTags({ repo }) {
  const version = checkoutVersion(repo)
  if (version === null) {
    throw new Error(
      `cannot read the checkout version from ${join(repo, 'package.json')}; nothing pruned`
    )
  }
  const newer = git(repo, ['tag', '--list', 'v[0-9]*'])
    .split('\n')
    .filter((tag) => tag && compareReleaseTags(tag, `v${version}`) > 0)
  if (newer.length > 0) {
    git(repo, ['tag', '-d', ...newer])
  }
  return newer
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values } = parseArgs({
    options: {
      upstream: { type: 'string' },
      repo: { type: 'string' },
      'if-missing': { type: 'boolean', default: false },
      'prune-newer': { type: 'boolean', default: false }
    }
  })
  const repo = resolve(values.repo ?? '.')
  if (values['prune-newer']) {
    const pruned = pruneNewerReleaseTags({ repo })
    console.log(`release tags newer than the checkout deleted in ${repo}: ${pruned.length}`)
  }
  const upstream = values.upstream ?? process.env.ORCA_UPSTREAM_URL ?? DEFAULT_UPSTREAM
  const { before, after, fetched, stillMissing } = fetchUpstreamReleaseTags({
    repo,
    upstream,
    ifMissing: values['if-missing']
  })
  console.log(
    fetched
      ? `release tags in ${repo}: ${before} -> ${after} (from ${upstream})`
      : `release tags in ${repo}: ${before}, every pinned release ref present; nothing fetched`
  )
  if (stillMissing.length > 0) {
    // A pin upstream does not have (a typo in a test, say) would otherwise cost an upstream contact on every run.
    console.warn(`pinned release refs still missing after the fetch: ${stillMissing.join(', ')}`)
  }
}
