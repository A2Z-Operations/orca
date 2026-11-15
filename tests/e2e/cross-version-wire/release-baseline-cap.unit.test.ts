import { describe, expect, it } from 'vitest'
import { releaseTagsUpToVersion, selectLatestStableReleaseTag } from './release-checkout'

// orca #48: a fork checkout at 1.4.255 that also holds upstream's later tags (v1.4.256 .. v1.4.259) took v1.4.259 as
// its baseline, and the tests then imported modules that moved after 1.4.255. A release newer than the checkout's own
// version is not a release this build can be downgraded to, so it is never the baseline.
describe('the cross-version baseline is never newer than the checkout', () => {
  const tags = ['v1.4.190', 'v1.4.254', 'v1.4.255', 'v1.4.256', 'v1.4.259', 'v1.4.256-rc.1']

  it('drops releases newer than the checkout version, keeps the rest', () => {
    expect(releaseTagsUpToVersion(tags, '1.4.255')).toEqual(['v1.4.190', 'v1.4.254', 'v1.4.255'])
    expect(selectLatestStableReleaseTag(releaseTagsUpToVersion(tags, '1.4.255'))).toBe('v1.4.255')
  })

  it('keeps every tag when the checkout is at or past the newest release (upstream main)', () => {
    expect(selectLatestStableReleaseTag(releaseTagsUpToVersion(tags, '1.4.259'))).toBe('v1.4.259')
    expect(selectLatestStableReleaseTag(releaseTagsUpToVersion(tags, '1.5.0'))).toBe('v1.4.259')
  })

  it('reads a build suffix and a leading v the same as the plain version', () => {
    expect(releaseTagsUpToVersion(tags, 'v1.4.255+blowzer.246')).toEqual(
      releaseTagsUpToVersion(tags, '1.4.255')
    )
  })

  it('does not cap when the version cannot be read', () => {
    expect(releaseTagsUpToVersion(tags, '')).toEqual(tags)
    expect(releaseTagsUpToVersion(tags, 'not-a-version')).toEqual(tags)
  })
})
