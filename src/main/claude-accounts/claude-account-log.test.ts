import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ClaudeAccountLogEntry } from '../../shared/claude-account-log-types'
import {
  appendClaudeAccountLog,
  CLAUDE_ACCOUNT_LOG_FILE,
  closeClaudeAccountLog,
  createClaudeAuthProxyAccountLogObserver,
  flushClaudeAccountLog,
  openClaudeAccountLog
} from './claude-account-log'
import { readClaudeAccountLog } from './claude-account-log-read'

const directories: string[] = []

function logPath(): string {
  const directory = mkdtempSync(join(tmpdir(), 'claude-account-log-'))
  directories.push(directory)
  return join(directory, CLAUDE_ACCOUNT_LOG_FILE)
}

const reasonOf = (row: ClaudeAccountLogEntry): string =>
  row.type === 'decision' || row.type === 'flip' ? row.reason : row.type

afterEach(() => {
  closeClaudeAccountLog()
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

const decision = (at: number, reason: string): ClaudeAccountLogEntry => ({
  type: 'decision',
  at,
  ptyId: 'pty-1',
  paneKey: 'tab-1:leaf-1',
  fromAccountId: 'a',
  toAccountId: null,
  reason
})

describe('claude account log', () => {
  it('appends ndjson that the reader returns oldest first, filtered by since and limit', () => {
    const path = logPath()
    openClaudeAccountLog(path)
    appendClaudeAccountLog(decision(3_000, 'under-line'))
    appendClaudeAccountLog(decision(1_000, 'wait:mid-turn'))
    appendClaudeAccountLog(decision(2_000, 'cooldown'))
    flushClaudeAccountLog()
    expect(readFileSync(path, 'utf8').trim().split('\n')).toHaveLength(3)
    expect(readClaudeAccountLog({ filePath: path }).entries.map((row) => row.at)).toEqual([
      1_000, 2_000, 3_000
    ])
    expect(readClaudeAccountLog({ filePath: path, since: 2_000 }).entries).toHaveLength(2)
    expect(readClaudeAccountLog({ filePath: path, limit: 1 }).entries[0]?.at).toBe(3_000)
  })

  it('reads the rotated files and skips a line cut mid-write', () => {
    const path = logPath()
    writeFileSync(`${path}.1`, `${JSON.stringify(decision(1_000, 'off'))}\n{"type":"deci`)
    writeFileSync(path, `${JSON.stringify(decision(2_000, 'pinned'))}\nnot json\n`)
    expect(readClaudeAccountLog({ filePath: path }).entries.map(reasonOf)).toEqual([
      'off',
      'pinned'
    ])
  })

  it('writes the file privately and drops appends while closed', () => {
    const path = logPath()
    appendClaudeAccountLog(decision(1_000, 'dropped'))
    openClaudeAccountLog(path)
    appendClaudeAccountLog(decision(2_000, 'kept'))
    closeClaudeAccountLog()
    expect(readClaudeAccountLog({ filePath: path }).entries.map(reasonOf)).toEqual(['kept'])
    if (process.platform !== 'win32') {
      expect(statSync(path).mode & 0o777).toBe(0o600)
    }
  })

  it('folds repeated unknown-slot requests and upstream errors for a minute, without headers', () => {
    const rows: ClaudeAccountLogEntry[] = []
    let now = 0
    const observe = createClaudeAuthProxyAccountLogObserver(
      (entry) => rows.push(entry),
      () => now
    )
    const unknown = { method: 'POST', path: '/v1/messages', status: 200, accountId: null }
    observe({ ...unknown, unknownSlot: true })
    now = 10_000
    observe({ ...unknown, unknownSlot: true })
    observe({
      method: 'POST',
      path: '/v1/messages',
      status: 429,
      accountId: 'b',
      unknownSlot: false
    })
    observe({
      method: 'POST',
      path: '/v1/messages',
      status: 200,
      accountId: 'b',
      unknownSlot: false
    })
    now = 70_000
    observe({ ...unknown, unknownSlot: true })
    expect(rows).toEqual([
      { type: 'proxy-unknown-slot', at: 0, method: 'POST', path: '/v1/messages', count: 1 },
      {
        type: 'proxy-error',
        at: 10_000,
        method: 'POST',
        path: '/v1/messages',
        status: 429,
        accountId: 'b',
        count: 1
      },
      { type: 'proxy-unknown-slot', at: 70_000, method: 'POST', path: '/v1/messages', count: 2 }
    ])
    expect(JSON.stringify(rows)).not.toMatch(/authorization|bearer|x-api-key/i)
  })

  it('has one writer: only claude-account-log.ts names the file or opens a sink for it', () => {
    // Main-process code; the CLI help text may name the file without writing it.
    const src = join(__dirname, '..')
    const files = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name)
        if (entry.isDirectory()) {
          return entry.name === 'node_modules' ? [] : files(path)
        }
        return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : []
      })
    const writers = files(src)
      .filter((file) => {
        const text = readFileSync(file, 'utf8')
        return (
          text.includes('account-moves.log') ||
          text.includes('CLAUDE_ACCOUNT_LOG_FILE') ||
          (text.includes('claudeAccountLogPath') &&
            /createLocalFileSink|appendFileSync|writeFileSync|openSync/.test(text))
        )
      })
      .map((file) => relative(src, file).replaceAll('\\', '/'))
    expect(writers).toEqual(['claude-accounts/claude-account-log.ts'])
  })
})
