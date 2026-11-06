import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  CLAUDE_PANE_ACCOUNT_PERSIST_MAX_AGE_MS,
  createClaudePaneAccountFileStore,
  installClaudePaneAccountPersistence
} from './claude-pane-account-persistence'
import {
  _internals,
  assignClaudePaneAccount,
  forgetClaudePaneAccount,
  recordClaudePaneAccount
} from './claude-pane-account-registry'
import { createClaudeAuthProxy } from './claude-auth-proxy/claude-auth-proxy'

const directories: string[] = []

function filePath(): string {
  const directory = mkdtempSync(join(tmpdir(), 'claude-pane-accounts-'))
  directories.push(directory)
  return join(directory, 'claude-pane-accounts.json')
}

const row = {
  ptyId: 'pty-1',
  paneKey: 'tab-1:leaf-1',
  accountId: 'a',
  configDir: '/profiles/a/home',
  launchedAt: 1_000,
  pinned: false,
  source: 'spawn' as const
}

afterEach(() => {
  installClaudePaneAccountPersistence(null)
  _internals.reset()
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('claude pane account file store', () => {
  it('round-trips a row with the port its slot was minted on, privately', () => {
    const path = filePath()
    const store = createClaudePaneAccountFileStore({
      filePath: path,
      listeningPort: () => 4100,
      now: () => 2_000
    })
    store.save({ ...row, proxySlot: 'slot-1', assignedAccountId: 'b' })
    store.setProxyPort(4100)
    const reread = createClaudePaneAccountFileStore({
      filePath: path,
      listeningPort: () => null,
      now: () => 2_000
    })
    expect(reread.read('pty-1')).toMatchObject({ proxySlot: 'slot-1', proxyPort: 4100 })
    expect(reread.proxyPort()).toBe(4100)
    if (process.platform !== 'win32') {
      expect(statSync(path).mode & 0o777).toBe(0o600)
    }
    reread.forget('pty-1')
    expect(JSON.parse(readFileSync(path, 'utf8')).panes).toEqual({})
  })

  it('drops rows too old to belong to a running PTY and survives a corrupt file', () => {
    const path = filePath()
    writeFileSync(
      path,
      JSON.stringify({ version: 1, panes: { old: { ...row, ptyId: 'old', launchedAt: 0 } } })
    )
    const store = createClaudePaneAccountFileStore({
      filePath: path,
      listeningPort: () => null,
      now: () => CLAUDE_PANE_ACCOUNT_PERSIST_MAX_AGE_MS + 1
    })
    expect(store.read('old')).toBeNull()
    writeFileSync(path, '{not json')
    const corrupt = createClaudePaneAccountFileStore({ filePath: path, listeningPort: () => null })
    expect(corrupt.read('pty-1')).toBeNull()
    expect(corrupt.proxyPort()).toBeNull()
  })

  it('the registry writes on record and assignment, and erases on forget', () => {
    const path = filePath()
    installClaudePaneAccountPersistence(
      createClaudePaneAccountFileStore({ filePath: path, listeningPort: () => 4100 })
    )
    recordClaudePaneAccount({ ...row, proxySlot: 'slot-1', assignedAccountId: 'a' })
    assignClaudePaneAccount('pty-1', 'b', 'session-1')
    const saved = JSON.parse(readFileSync(path, 'utf8')).panes['pty-1']
    expect(saved).toMatchObject({ assignedAccountId: 'b', providerSessionId: 'session-1' })
    forgetClaudePaneAccount('pty-1')
    expect(JSON.parse(readFileSync(path, 'utf8')).panes).toEqual({})
  })
})

describe('auth proxy restart', () => {
  it('asks for the previous port, falls back when it is taken, and adopts a recovered slot', async () => {
    const first = createClaudeAuthProxy({ readToken: async () => null })
    await first.start()
    const port = first.port()
    await first.stop()
    const again = createClaudeAuthProxy({ readToken: async () => null, preferredPort: port })
    await again.start()
    expect(again.port()).toBe(port)
    expect(again.adoptSlot('b'.repeat(32), 'acct-b')).toBe(true)
    expect(again.accountIdForSlot('b'.repeat(32))).toBe('acct-b')
    expect(again.adoptSlot('../not-a-slot', 'acct-b')).toBe(false)
    const blocker = createServer()
    await new Promise<void>((resolve) => blocker.listen(0, '127.0.0.1', resolve))
    const taken = blocker.address()
    const takenPort = taken && typeof taken === 'object' ? taken.port : null
    const fallback = createClaudeAuthProxy({
      readToken: async () => null,
      preferredPort: takenPort
    })
    await fallback.start()
    expect(fallback.port()).not.toBe(takenPort)
    expect(fallback.port()).toBeGreaterThan(0)
    await Promise.all([again.stop(), fallback.stop()])
    await new Promise<void>((resolve) => blocker.close(() => resolve()))
  })
})
