#!/usr/bin/env node
// Fork (#48): put upstream's release tags (v*) into this clone, so the cross-version wire tests find their baselines.
//
// Why: those tests check this build against released builds by tag (the newest release not newer than this checkout,
// plus fixed older ones such as v1.4.190), and fail rather than skip when a tag is missing. The fork repo carries no
// tags, so every clone of it had none and about 40 cross-version files failed. Upstream's release tags are read-only
// facts about published builds; only tags are fetched, and nothing is pushed anywhere.
//
// Usage: node config/scripts/orca-fork/fetch-upstream-release-tags.mjs [--upstream <url or path>] [--repo <checkout>]
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

export const DEFAULT_UPSTREAM = 'https://github.com/stablyai/orca'
const RELEASE_TAG_REFSPEC = 'refs/tags/v*:refs/tags/v*'

function git(repo, args) {
  const result = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${(result.stderr || result.stdout).trim()}`)
  }
  return result.stdout.trim()
}

function releaseTagCount(repo) {
  return git(repo, ['tag', '--list', 'v[0-9]*']).split('\n').filter(Boolean).length
}

/** Fetches upstream's v* tags into `repo` (no other refs, no tag that moved is overwritten); returns the counts. */
export function fetchUpstreamReleaseTags({ repo, upstream = DEFAULT_UPSTREAM }) {
  const before = releaseTagCount(repo)
  git(repo, ['fetch', '--quiet', '--no-tags', upstream, RELEASE_TAG_REFSPEC])
  return { before, after: releaseTagCount(repo) }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values } = parseArgs({
    options: { upstream: { type: 'string' }, repo: { type: 'string' } }
  })
  const repo = resolve(values.repo ?? '.')
  const upstream = values.upstream ?? process.env.ORCA_UPSTREAM_URL ?? DEFAULT_UPSTREAM
  const { before, after } = fetchUpstreamReleaseTags({ repo, upstream })
  console.log(`release tags in ${repo}: ${before} -> ${after} (from ${upstream})`)
}
