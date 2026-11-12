import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  TAG_PINS,
  assertFileMatchesPin,
  assertNativeInputsMatchTag,
  assertPathInside,
  assertRedirectTarget,
  assertRegularFileInside,
  assertReleaseAssetMatchesPin,
  extractDebData,
  prepareWorkDir,
  releaseDownloadUrl,
  tagPin
} from './harvest-orcad-prebuilds.mjs'

const directories = []
afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function tempDir() {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'harvest-orcad-')))
  directories.push(directory)
  return directory
}

function arMember(name, data, declaredSize = data.length) {
  const header = Buffer.alloc(60, ' ')
  header.write(name, 0, 'latin1')
  header.write('0', 16, 'latin1')
  header.write('0', 28, 'latin1')
  header.write('0', 34, 'latin1')
  header.write('100644', 40, 'latin1')
  header.write(String(declaredSize), 48, 'latin1')
  header.write('`\n', 58, 'latin1')
  const padding = data.length % 2 === 1 ? Buffer.from('\n') : Buffer.alloc(0)
  return Buffer.concat([header, data, padding])
}

function writeDeb(directory, members) {
  const path = join(directory, 'test.deb')
  writeFileSync(path, Buffer.concat([Buffer.from('!<arch>\n'), ...members]))
  return path
}

describe('assertPathInside', () => {
  it('accepts a strict descendant and refuses the parent itself, siblings and escapes', () => {
    expect(assertPathInside('/work/dir', '/work/dir/a/b')).toBe('/work/dir/a/b')
    expect(() => assertPathInside('/work/dir', '/work/dir')).toThrow(/not inside/)
    expect(() => assertPathInside('/work/dir', '/work/dir/../x')).toThrow(/not inside/)
    expect(() => assertPathInside('/work/dir', '/work/dirty/x')).toThrow(/not inside/)
    expect(() => assertPathInside('/work/dir', '/etc/passwd')).toThrow(/not inside/)
  })
})

describe('assertRegularFileInside', () => {
  it('accepts a regular file and refuses symlinks, directories and a symlinked parent', () => {
    const root = tempDir()
    const outside = tempDir()
    writeFileSync(join(root, 'file'), 'x')
    writeFileSync(join(outside, 'secret'), 'x')
    mkdirSync(join(root, 'dir'))
    symlinkSync(join(outside, 'secret'), join(root, 'link'))
    symlinkSync(outside, join(root, 'parent-link'))

    expect(assertRegularFileInside(root, join(root, 'file'))).toBe(join(root, 'file'))
    expect(() => assertRegularFileInside(root, join(root, 'link'))).toThrow(/not a regular file/)
    expect(() => assertRegularFileInside(root, join(root, 'dir'))).toThrow(/not a regular file/)
    expect(() => assertRegularFileInside(root, join(root, 'missing'))).toThrow(/not a regular file/)
    expect(() => assertRegularFileInside(root, join(root, 'parent-link', 'secret'))).toThrow(
      /not inside/
    )
  })
})

describe('extractDebData', () => {
  it('writes the data member byte for byte, GNU and BSD name styles alike', () => {
    for (const name of ['data.tar.xz', 'data.tar.xz/']) {
      const directory = tempDir()
      const data = Buffer.from('payload bytes of odd length')
      const deb = writeDeb(directory, [
        arMember('debian-binary', Buffer.from('2.0\n')),
        arMember('control.tar.gz', Buffer.from('ctl')),
        arMember(name, data)
      ])
      const out = join(directory, 'out')
      mkdirSync(out)
      const path = extractDebData(deb, out)
      expect(path).toBe(join(out, 'data.tar.xz'))
      expect(readFileSync(path)).toEqual(data)
    }
  })

  it('refuses a data-like member name that would escape the output dir, writing nothing', () => {
    const directory = tempDir()
    const out = join(directory, 'a', 'out')
    mkdirSync(out, { recursive: true })
    const deb = writeDeb(directory, [arMember('data.tar/../../x', Buffer.from('evil'))])
    expect(() => extractDebData(deb, out)).toThrow(/unexpected ar member/)
    expect(existsSync(join(directory, 'x'))).toBe(false)
    expect(readdirSync(out)).toEqual([])
  })

  it('refuses any member outside the allowlist', () => {
    const directory = tempDir()
    const deb = writeDeb(directory, [arMember('payload.bin', Buffer.from('x'))])
    expect(() => extractDebData(deb, directory)).toThrow(/unexpected ar member/)
  })

  it('fails closed on a member that declares more bytes than the file holds', () => {
    const directory = tempDir()
    const out = join(directory, 'out')
    mkdirSync(out)
    const deb = writeDeb(directory, [arMember('data.tar.xz', Buffer.from('abc'), 1000)])
    expect(() => extractDebData(deb, out)).toThrow(/past the end/)
    expect(readdirSync(out)).toEqual([])
  })

  it('fails closed on a truncated header (short read)', () => {
    const directory = tempDir()
    const member = arMember('debian-binary', Buffer.from('2.0\n'))
    const deb = writeDeb(directory, [member, member.subarray(0, 30)])
    expect(() => extractDebData(deb, directory)).toThrow(/short read/)
  })

  it('refuses a non-numeric size, a non-ar file and a deb without a data member', () => {
    const directory = tempDir()
    const badSize = arMember('data.tar.xz', Buffer.from('ab'))
    badSize.write('12x       ', 48, 'latin1')
    expect(() => extractDebData(writeDeb(directory, [badSize]), directory)).toThrow(
      /bad ar member size/
    )

    const notAr = join(directory, 'not.deb')
    writeFileSync(notAr, 'hello world')
    expect(() => extractDebData(notAr, directory)).toThrow(/not an ar archive/)

    const noData = writeDeb(directory, [arMember('debian-binary', Buffer.from('2.0\n'))])
    expect(() => extractDebData(noData, directory)).toThrow(/no data\.tar member/)
  })
})

describe('the pinned asset', () => {
  const bytes = Buffer.from('pinned deb bytes')
  const pin = {
    commit: 'a'.repeat(40),
    asset: 'orca-ide_9.9.9_amd64.deb',
    size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex')
  }

  it('accepts only bytes on disk with the pinned size and sha256', () => {
    const directory = tempDir()
    const good = join(directory, 'good.deb')
    writeFileSync(good, bytes)
    expect(() => assertFileMatchesPin(good, pin)).not.toThrow()

    const wrongSize = join(directory, 'size.deb')
    writeFileSync(wrongSize, Buffer.concat([bytes, Buffer.from('!')]))
    expect(() => assertFileMatchesPin(wrongSize, pin)).toThrow(/bytes, pinned/)

    const wrongHash = join(directory, 'hash.deb')
    writeFileSync(wrongHash, Buffer.from(bytes).fill(0x41, 0, 1))
    expect(() => assertFileMatchesPin(wrongHash, pin)).toThrow(/!= pinned/)

    const link = join(directory, 'link.deb')
    symlinkSync(good, link)
    expect(() => assertFileMatchesPin(link, pin)).toThrow(/not a regular file/)
    expect(() => assertFileMatchesPin(join(directory, 'missing.deb'), pin)).toThrow(
      /not a regular file/
    )
  })

  it('refuses a release record that disagrees with the pin', () => {
    const tag = 'v9.9.9'
    const asset = {
      name: pin.asset,
      browser_download_url: releaseDownloadUrl(tag, pin),
      size: pin.size,
      digest: `sha256:${pin.sha256}`
    }
    expect(asset.browser_download_url).toBe(
      'https://github.com/stablyai/orca/releases/download/v9.9.9/orca-ide_9.9.9_amd64.deb'
    )
    expect(() => assertReleaseAssetMatchesPin(asset, tag, pin)).not.toThrow()
    for (const change of [
      { digest: `sha256:${'0'.repeat(64)}` },
      { size: pin.size + 1 },
      { browser_download_url: 'https://evil.example/orca-ide_9.9.9_amd64.deb' },
      {
        browser_download_url:
          'https://github.com/stablyai/orca/releases/download/v9.9.8/orca-ide_9.9.9_amd64.deb'
      },
      { name: 'orca-ide_9.9.9_arm64.deb' }
    ]) {
      expect(() => assertReleaseAssetMatchesPin({ ...asset, ...change }, tag, pin)).toThrow(
        /disagrees with TAG_PINS/
      )
    }
    expect(() => assertReleaseAssetMatchesPin(undefined, tag, pin)).toThrow(/disagrees/)
  })

  it('follows a redirect only to an https GitHub storage host', () => {
    const base = 'https://github.com/stablyai/orca/releases/download/v9.9.9/a.deb'
    for (const host of ['release-assets.githubusercontent.com', 'objects.githubusercontent.com']) {
      expect(assertRedirectTarget(`https://${host}/path?sig=1`, base)).toBe(
        `https://${host}/path?sig=1`
      )
    }
    for (const location of [
      'http://release-assets.githubusercontent.com/x',
      'https://evil.example/x',
      'https://release-assets.githubusercontent.com.evil.example/x',
      'https://release-assets.githubusercontent.com:8443/x',
      'https://user:pw@objects.githubusercontent.com/x',
      '/elsewhere',
      ''
    ]) {
      expect(() => assertRedirectTarget(location, base)).toThrow(/redirect/)
    }
  })
})

describe('tagPin', () => {
  it('pins v1.4.255 to its upstream commit and release asset', () => {
    expect(tagPin('v1.4.255')).toEqual({
      commit: '084ce0eebbdda3f665251984804f2238be666296',
      asset: 'orca-ide_1.4.255_amd64.deb',
      size: 191_836_440,
      sha256: '6df53f4f6c919fd1f10dfe3511940934acc940a7754eb1b0e896d2c62e4add5a'
    })
    expect(Object.isFrozen(TAG_PINS['v1.4.255'])).toBe(true)
  })

  it('refuses a malformed or unpinned tag', () => {
    for (const tag of ['1.4.255', 'v1.4', 'v1.4.255/../x', 'v1.4.255 ', undefined]) {
      expect(() => tagPin(tag)).toThrow(/--tag must look like/)
    }
    expect(() => tagPin('v9.9.9')).toThrow(/not pinned/)
    expect(() => tagPin('v1.4.256')).toThrow(/not pinned/)
  })
})

describe('assertNativeInputsMatchTag', () => {
  function git(cwd, ...args) {
    const result = spawnSync(
      'git',
      [
        '-c',
        'core.hooksPath=/dev/null',
        '-c',
        'commit.gpgSign=false',
        '-c',
        'tag.gpgSign=false',
        '-c',
        'user.name=Harvest Test',
        '-c',
        'user.email=harvest-test@example.invalid',
        ...args
      ],
      { cwd, encoding: 'utf8' }
    )
    if (result.status !== 0) {
      throw new Error(`git ${args.join(' ')}: ${result.stderr}`)
    }
    return result.stdout.trim()
  }

  function repo() {
    const root = tempDir()
    git(root, 'init', '--quiet')
    writeFileSync(join(root, 'package.json'), '{}\n')
    git(root, 'add', '-A')
    git(root, 'commit', '--quiet', '-m', 'release')
    git(root, 'tag', 'v9.9.9')
    const commit = git(root, 'rev-parse', 'HEAD')
    return { root, commit, pins: { 'v9.9.9': { ...TAG_PINS['v1.4.255'], commit } } }
  }

  it('passes when the tag peels to the pinned commit and no native input changed', () => {
    const { root, pins } = repo()
    writeFileSync(join(root, 'README.md'), 'fork-only JS change\n')
    git(root, 'add', '-A')
    git(root, 'commit', '--quiet', '-m', 'fork')
    expect(() => assertNativeInputsMatchTag('v9.9.9', { root, pins })).not.toThrow()
  })

  it('refuses a tag that was moved off the pinned commit', () => {
    const { root, pins } = repo()
    writeFileSync(join(root, 'package.json'), '{"changed":true}\n')
    git(root, 'add', '-A')
    git(root, 'commit', '--quiet', '-m', 'fork')
    git(root, 'tag', '-f', 'v9.9.9', 'HEAD')
    expect(() => assertNativeInputsMatchTag('v9.9.9', { root, pins })).toThrow(
      /peels to .* but the pinned commit is/
    )
  })

  it('refuses a missing tag with the fetch hint', () => {
    const { root, pins } = repo()
    git(root, 'tag', '-d', 'v9.9.9')
    expect(() => assertNativeInputsMatchTag('v9.9.9', { root, pins })).toThrow(
      /tag v9\.9\.9 not found; git fetch/
    )
  })

  it('refuses a committed or uncommitted native input change', () => {
    const { root, pins } = repo()
    writeFileSync(join(root, 'package.json'), '{"dirty":true}\n')
    expect(() => assertNativeInputsMatchTag('v9.9.9', { root, pins })).toThrow(
      /native inputs differ/
    )
    git(root, 'add', '-A')
    git(root, 'commit', '--quiet', '-m', 'fork')
    expect(() => assertNativeInputsMatchTag('v9.9.9', { root, pins })).toThrow(
      /native inputs differ/
    )
  })
})

describe('prepareWorkDir', () => {
  it('accepts only a strict descendant of .build/, symlinks resolved', () => {
    const root = tempDir()
    const outside = tempDir()
    expect(prepareWorkDir(join(root, '.build', 'harvest', 'v1'), root)).toBe(
      join(root, '.build', 'harvest', 'v1')
    )
    expect(existsSync(join(root, '.build', 'harvest', 'v1'))).toBe(true)
    for (const work of [join(root, '.build'), root, '/', join(root, '.build', '..', 'out')]) {
      expect(() => prepareWorkDir(work, root)).toThrow(/not inside/)
    }
    symlinkSync(outside, join(root, '.build', 'escape'))
    expect(() => prepareWorkDir(join(root, '.build', 'escape', 'w'), root)).toThrow(
      /not a plain directory/
    )
    expect(readdirSync(outside)).toEqual([])
  })
})
