import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  _resetWindowsCopyVerdictsForTests,
  resolveGuestNativeProgram
} from './wsl-guest-windows-drive-path'

// orca #48: after a PATH miss the lookup also tries the host's system install folders (/usr/local/bin,
// /opt/homebrew/bin, ...), which ignore the injected home. A machine with a real claude or codex there failed these
// tests, and one without passed by luck. The tests read a fake system folder under their own root, never the host.
const systemDirs = vi.hoisted((): { current: string[] } => ({ current: [] }))
vi.mock('../../shared/system-cli-install-dirs', () => ({
  getSystemCliInstallDirectories: () => systemDirs.current
}))

let root: string
let native: string
let drive: string

function install(dir: string): string {
  mkdirSync(dir, { recursive: true })
  const program = join(dir, 'claude')
  writeFileSync(program, '#!/bin/sh\n')
  chmodSync(program, 0o755)
  return program
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'orca-guest-native-'))
  native = join(root, 'home', '.local', 'bin')
  // Stands in for a Windows drive mount such as /mnt/c.
  drive = join(root, 'c')
  systemDirs.current = [join(root, 'usr', 'local', 'bin')]
})

afterEach(() => {
  vi.useRealTimers()
  _resetWindowsCopyVerdictsForTests()
  rmSync(root, { recursive: true, force: true })
})

describe.skipIf(process.platform === 'win32')('the Windows-copy check', () => {
  const options = () => ({ pathEnv: `${native}:${drive}/npm`, homePath: join(root, 'home') })

  it('still finds a WSL install made after the verdict was cached', () => {
    install(join(drive, 'npm'))
    expect(resolveGuestNativeProgram('claude', options(), undefined, [drive])).toBeNull()
    const own = install(native)
    expect(resolveGuestNativeProgram('claude', options(), undefined, [drive])).toBe(own)
  })
})
