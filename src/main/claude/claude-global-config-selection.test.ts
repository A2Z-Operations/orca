import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { claudeStateFile, claudeStateFileAsync } from '../claude-accounts/claude-account-folder'

let root: string
afterEach(async () => {
  if (root) {
    await rm(root, { recursive: true, force: true })
  }
})

describe('Claude Code 2.1.323 config selection', () => {
  it.each([
    ['absent', 'present', 'current'],
    ['nonempty', 'present', 'legacy'],
    ['empty', 'present', 'current'],
    ['empty', 'absent', 'legacy'],
    ['nonempty', 'empty', 'legacy'],
    ['directory', 'present', 'current']
  ])('selects %s legacy beside %s current', async (legacyKind, currentKind, expected) => {
    root = await mkdtemp(join(tmpdir(), 'claude-config-selection-'))
    const legacy = join(root, '.config.json')
    const current = join(root, '.claude.json')
    if (legacyKind === 'directory') {
      await mkdir(legacy)
    } else if (legacyKind !== 'absent') {
      await writeFile(legacy, legacyKind === 'empty' ? '' : '{}')
    }
    if (currentKind !== 'absent') {
      await writeFile(current, currentKind === 'empty' ? '' : '{}')
    }
    const wanted = expected === 'legacy' ? legacy : current
    expect(claudeStateFile(root)).toBe(wanted)
    expect(await claudeStateFileAsync(root)).toBe(wanted)
  })

  it.skipIf(process.platform === 'win32')(
    'ignores an unwritable empty legacy placeholder',
    async () => {
      root = await mkdtemp(join(tmpdir(), 'claude-config-selection-'))
      await writeFile(join(root, '.config.json'), '')
      await chmod(join(root, '.config.json'), 0o400)
      await writeFile(join(root, '.claude.json'), '{}')
      expect(claudeStateFile(root)).toBe(join(root, '.claude.json'))
      expect(await claudeStateFileAsync(root)).toBe(join(root, '.claude.json'))
    }
  )
})
