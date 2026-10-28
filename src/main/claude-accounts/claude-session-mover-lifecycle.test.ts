import type { ClaudeSessionMoveOutcome } from './claude-session-move-strategy'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setup, state, limits, PANE_1 } from './claude-session-mover-test-fixture'
import { CLAUDE_SESSION_MOVE_COOLDOWN_MS } from './claude-session-mover-policy'

describe('session mover lifecycle and metadata', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-19T12:00:00Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps the matching provider session folder and effort when joining hook identities', async () => {
    const metadata = {
      key: 'session_id' as const,
      id: 'sess-pty-1',
      cwd: '/recorded/run',
      effort: 'high' as const
    }
    const f = setup({
      getStatusSnapshotForPane: () => [
        {
          paneKey: PANE_1,
          state: 'done',
          prompt: '',
          connectionId: null,
          receivedAt: Date.now(),
          stateStartedAt: Date.now(),
          providerSession: { key: 'session_id', id: 'other', cwd: '/wrong' }
        },
        {
          paneKey: PANE_1,
          state: 'done',
          prompt: '',
          connectionId: null,
          receivedAt: Date.now(),
          stateStartedAt: Date.now(),
          providerSession: metadata
        }
      ]
    })
    f.session('pty-1', PANE_1, 'b')
    f.mover.start()
    f.publish(state(30, { b: limits(96), c: limits(20) }))
    await vi.runAllTimersAsync()
    expect(f.move.mock.calls[0]?.[0].providerSession).toMatchObject(metadata)
  })

  it('keeps the cooldown after the registry replaces the old PTY with the new owner', async () => {
    const f = setup()
    f.session('pty-1', PANE_1, 'b')
    f.move.mockImplementationOnce(async () => {
      const old = f.records[0]!
      f.records.splice(0, 1, { ...old, ptyId: 'pty-new', accountId: 'c' })
      return { kind: 'moved', newPtyId: 'pty-new' }
    })
    f.mover.start()
    f.publish(state(30, { b: limits(96), c: limits(20) }))
    await vi.runAllTimersAsync()
    expect(f.mover.lastDecisions()).toEqual([
      expect.objectContaining({ ptyId: 'pty-new', reason: 'moved' })
    ])
    f.publish(state(30, { b: limits(20), c: limits(96) }))
    await vi.runAllTimersAsync()
    expect(f.move).toHaveBeenCalledTimes(1)
    expect(f.mover.lastDecisions()[0]).toMatchObject({ ptyId: 'pty-new', reason: 'stay' })
    vi.setSystemTime(Date.now() + CLAUDE_SESSION_MOVE_COOLDOWN_MS)
    f.publish(state(30, { b: limits(20), c: limits(96) }))
    await vi.runAllTimersAsync()
    expect(f.move).toHaveBeenCalledTimes(2)
  })

  it('holds the pane while its new PTY is published before the move promise settles', async () => {
    const f = setup()
    const pending = Promise.withResolvers<ClaudeSessionMoveOutcome>()
    f.move.mockReturnValueOnce(pending.promise)
    f.session('pty-1', PANE_1, 'b')
    f.mover.start()
    f.publish(state(30, { b: limits(96), c: limits(20) }))
    const old = f.records[0]!
    f.records.splice(0, 1, { ...old, ptyId: 'pty-new', accountId: 'c' })
    f.publish(state(30, { b: limits(96), c: limits(96) }))
    expect(f.move).toHaveBeenCalledTimes(1)
    pending.resolve({ kind: 'moved', newPtyId: 'pty-new' })
    await vi.runAllTimersAsync()
    expect(f.mover.lastDecisions()).toEqual([
      expect.objectContaining({ ptyId: 'pty-new', reason: 'moved' })
    ])
  })

  it('unsubscribes and cancels queued usage reads when stopped', async () => {
    const f = setup()
    f.session('pty-1', PANE_1, 'b')
    const stop = f.mover.start()
    f.publish(state(30, { b: limits(96, Date.now() - 16 * 60_000), c: limits(20) }))
    stop()
    await vi.runAllTimersAsync()
    expect(f.fetchInactive).not.toHaveBeenCalled()
    f.publish(state(30, { b: limits(96), c: limits(20) }))
    f.setStatus(PANE_1, 'done')
    f.mover.evaluate()
    await vi.runAllTimersAsync()
    expect(f.move).not.toHaveBeenCalled()
  })

  it('records under-line, read-usage and off decisions without moving', async () => {
    const f = setup()
    f.session('pty-1', PANE_1, 'b')
    f.mover.start()
    f.publish(state(30, { b: limits(20), c: limits(20) }))
    expect(f.mover.lastDecisions()[0]?.reason).toBe('stay')
    f.publish(state(30, { b: limits(96, Date.now() - 16 * 60_000), c: limits(20) }))
    expect(f.mover.lastDecisions()[0]?.reason).toBe('read-usage')
    f.settings.claudeSessionMover = 'off'
    f.publish(state(30, { b: limits(96), c: limits(20) }))
    expect(f.mover.lastDecisions()[0]?.reason).toBe('off')
    expect(f.mover.lastDecisions()).toHaveLength(1)
    f.records.splice(0)
    expect(f.mover.lastDecisions()).toEqual([])
    await vi.runAllTimersAsync()
    expect(f.move).not.toHaveBeenCalled()
  })
})
