import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveGuestNativeAgentCommand, WINDOWS_ONLY_AGENT_CLI_DIR } from './command'

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

function install(dir: string, name: string): string {
  mkdirSync(dir, { recursive: true })
  const program = join(dir, name)
  writeFileSync(program, '#!/bin/sh\necho "9.9.9 (Claude Code)"\n')
  chmodSync(program, 0o755)
  return program
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'orca-agent-cli-guest-'))
  native = join(root, 'home', '.local', 'bin')
  // Stands in for a Windows drive mount such as /mnt/c.
  drive = join(root, 'c')
  systemDirs.current = [join(root, 'usr', 'local', 'bin')]
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe.skipIf(process.platform === 'win32')('agent CLI resolution on a WSL host', () => {
  const options = () => ({ pathEnv: `${native}:${drive}/npm`, homePath: join(root, 'home') })

  it('looks in the fake system folder after a PATH miss, never the host one', () => {
    const own = install(join(root, 'usr', 'local', 'bin'), 'claude')
    expect(resolveGuestNativeAgentCommand('claude', options(), [drive])).toBe(own)
  })

  it.each(['claude', 'codex'])('takes the WSL install of %s over a Windows copy', (name) => {
    const own = install(native, name)
    install(join(drive, 'npm'), name)
    expect(resolveGuestNativeAgentCommand(name, options(), [drive])).toBe(own)
  })

  it.each(['claude', 'codex'])(
    'reads a Windows-only %s as not installed: never a bare name the spawn would find',
    (name) => {
      install(join(drive, 'npm'), name)
      expect(resolveGuestNativeAgentCommand(name, options(), [drive])).toBe(
        `${WINDOWS_ONLY_AGENT_CLI_DIR}/${name}`
      )
    }
  )
})
