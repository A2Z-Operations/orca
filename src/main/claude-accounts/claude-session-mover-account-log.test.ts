import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  closeClaudeAccountLog,
  flushClaudeAccountLog,
  openClaudeAccountLog
} from './claude-account-log'
import { readClaudeAccountLog } from './claude-account-log-read'
import { limits, PANE_1, setup, state } from './claude-session-mover-test-fixture'

describe('session mover writes the durable account log', () => {
  let directory = ''
  let path = ''

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-05T06:00:00Z'))
    directory = mkdtempSync(join(tmpdir(), 'claude-mover-log-'))
    path = join(directory, 'account-moves.log')
    openClaudeAccountLog(path)
  })

  afterEach(() => {
    closeClaudeAccountLog()
    rmSync(directory, { recursive: true, force: true })
    vi.useRealTimers()
  })

  it('logs a decision once per reason change, and every settled move with its strategy', async () => {
    const f = setup()
    f.session('pty-1', PANE_1, 'a', 'done')
    f.mover.start()
    f.publish(state(30, { b: limits(96), c: limits(20) }))
    f.publish(state(31, { b: limits(96), c: limits(20) }))
    f.publish(state(96, { b: limits(20), c: limits(50) }))
    await vi.runAllTimersAsync()
    flushClaudeAccountLog()
    const rows = readClaudeAccountLog({ filePath: path }).entries
    const reasons = rows.map((row) => (row.type === 'decision' ? row.reason : row.type))
    expect(reasons.filter((reason) => reason === reasons[0])).toHaveLength(1)
    expect(rows.find((row) => row.type === 'decision' && row.reason === 'moved')).toMatchObject({
      type: 'decision',
      ptyId: 'pty-new',
      fromAccountId: 'a',
      toAccountId: 'b',
      strategy: 'resume',
      detail: 'pty-new'
    })
  })
})
