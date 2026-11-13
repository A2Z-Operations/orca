import type { ClaudeSessionMoveOutcome } from './claude-session-move-strategy'
import { CLAUDE_SESSION_MOVE_TARGET_COOLDOWN_MS } from './claude-session-mover-policy'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeClaudeAccountLog, openClaudeAccountLog } from './claude-account-log'
import { readClaudeAccountLog } from './claude-account-log-read'
import { limits, PANE_1, PANE_2, setup, state } from './claude-session-mover-test-fixture'

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
    // Why real timers: the close and the read await fs/promises; faked timers never let them settle.
    vi.useRealTimers()
    await closeClaudeAccountLog()
    const rows = (await readClaudeAccountLog({ filePath: path })).entries
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

  it('retains completed and failed move rows after their PTYs leave the registry', async () => {
    const f = setup()
    f.session('pty-1', PANE_1, 'b')
    f.mover.start()
    f.publish(state(30, { b: limits(96), c: limits(20) }))
    await vi.runAllTimersAsync()
    f.records.splice(0)
    f.mover.evaluate()
    expect(f.mover.lastDecisions()).toEqual([
      expect.objectContaining({ ptyId: 'pty-new', reason: 'moved', toAccountId: 'c' })
    ])
    f.session('pty-failed', PANE_1, 'b')
    f.move.mockImplementationOnce(async () => {
      f.records.splice(0)
      throw new Error('replacement exited')
    })
    vi.setSystemTime(Date.now() + 20 * 60_000)
    f.publish(state(30, { b: limits(96), c: limits(20) }))
    await vi.runAllTimersAsync()
    f.mover.evaluate()
    expect(f.mover.lastDecisions().map((row) => row.reason)).toEqual(['failed', 'moved'])
    expect(f.notices[1]?.moves).toEqual(f.mover.lastDecisions())
    vi.useRealTimers()
    await closeClaudeAccountLog()
    const rows = (await readClaudeAccountLog({ filePath: path })).entries
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'decision', reason: 'moved', ptyId: 'pty-new' }),
        expect.objectContaining({ type: 'decision', reason: 'failed', ptyId: 'pty-failed' })
      ])
    )
  })

  it('retries a wait without a failure cooldown or a target reservation', async () => {
    const f = setup()
    f.session('pty-1', PANE_1, 'b')
    f.move.mockResolvedValueOnce({ kind: 'wait', reason: 'no-transcript' })
    f.mover.start()
    f.publish(state(30, { b: limits(96), c: limits(20) }))
    await vi.runAllTimersAsync()
    expect(f.mover.lastDecisions()).toEqual([
      expect.objectContaining({ ptyId: 'pty-1', reason: 'wait:no-transcript' })
    ])
    f.mover.evaluate()
    await vi.runAllTimersAsync()
    expect(f.mover.lastDecisions()).toEqual([
      expect.objectContaining({ ptyId: 'pty-new', reason: 'moved', toAccountId: 'c' })
    ])
  })

  it('releases both waiting claims when a later evaluation updates the same target', async () => {
    const first = Promise.withResolvers<ClaudeSessionMoveOutcome>()
    const second = Promise.withResolvers<ClaudeSessionMoveOutcome>()
    const f = setup()
    f.session('pty-1', PANE_1, 'b')
    f.move.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    f.mover.start()
    f.publish(state(97, { b: limits(96), c: limits(20) }))
    vi.setSystemTime(Date.now() + CLAUDE_SESSION_MOVE_TARGET_COOLDOWN_MS)
    f.session('pty-2', PANE_2, 'b')
    f.publish(state(97, { b: limits(96), c: limits(20) }))
    first.resolve({ kind: 'wait', reason: 'cwd-missing' })
    await vi.runAllTimersAsync()
    second.resolve({ kind: 'wait', reason: 'no-cwd' })
    await vi.runAllTimersAsync()
    expect(
      f.mover
        .lastDecisions()
        .map((row) => row.reason)
        .sort()
    ).toEqual(['wait:cwd-missing', 'wait:no-cwd'])
    f.mover.evaluate()
    await vi.runAllTimersAsync()
    expect(f.mover.lastDecisions()).toContainEqual(
      expect.objectContaining({ reason: 'moved', toAccountId: 'c' })
    )
  })

  it('stay and wait reasons are the decision reasons, never a bare "stay"', async () => {
    const f = setup()
    f.session('pty-1', PANE_1, 'b', 'done')
    f.session('pty-2', 'tab-2:leaf-2', 'c', 'done', true)
    f.session('pty-3', 'tab-3:leaf-3', 'b', 'working')
    f.mover.start()
    // Everyone has room: b and c are under the line, the pinned pane says so.
    f.publish(state(30, { b: limits(20), c: limits(20) }))
    expect(
      Object.fromEntries(f.mover.lastDecisions().map((row) => [row.ptyId, row.reason]))
    ).toEqual({
      'pty-1': 'under-line',
      'pty-2': 'pinned',
      'pty-3': 'under-line'
    })
    // b is over the line and nothing else has room: no target; a working resume pane waits.
    f.publish(state(97, { b: limits(97), c: limits(97) }))
    await vi.runAllTimersAsync()
    const reasons = Object.fromEntries(
      f.mover.lastDecisions().map((row) => [row.ptyId, row.reason])
    )
    expect(reasons['pty-1']).toBe('no-target')
    expect(reasons['pty-3']).toBe('wait:mid-turn')
    vi.useRealTimers()
    await closeClaudeAccountLog()
    const logged = (await readClaudeAccountLog({ filePath: path })).entries
    expect(logged.some((row) => row.type === 'decision' && row.reason === 'stay')).toBe(false)
    expect(logged.filter((row) => row.type === 'decision').map((row) => row.reason)).toEqual(
      expect.arrayContaining(['under-line', 'pinned', 'no-target', 'wait:mid-turn'])
    )
  })
})
