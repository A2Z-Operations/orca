import { describe, expect, it } from 'vitest'
import type { InactiveAccountUsage, ProviderRateLimits } from '../../shared/rate-limit-types'
import {
  CLAUDE_SESSION_MOVE_BACKGROUND_WAIT_MS,
  CLAUDE_SESSION_MOVE_COOLDOWN_MS,
  CLAUDE_SESSION_MOVE_FAILURE_HOLD_MS,
  CLAUDE_SESSION_MOVE_TARGET_COOLDOWN_MS,
  debitClaimedUsage,
  decideClaudeSessionMove,
  type ClaudeSessionMoveInputs
} from './claude-session-mover-policy'

const NOW = Date.parse('2026-10-19T12:00:00Z')

function limits(usedPercent: number, updatedAt = NOW): ProviderRateLimits {
  return {
    provider: 'claude',
    session: { usedPercent, windowMinutes: 300, resetsAt: null, resetDescription: null },
    weekly: null,
    updatedAt,
    error: null,
    status: 'ok'
  }
}

function candidate(accountId: string, usedPercent: number, updatedAt = NOW): InactiveAccountUsage {
  return { accountId, rateLimits: limits(usedPercent, updatedAt), updatedAt, isFetching: false }
}

function inputs(overrides: Partial<ClaudeSessionMoveInputs> = {}): ClaudeSessionMoveInputs {
  return {
    now: NOW,
    setting: 'move',
    pinned: false,
    paneState: 'done',
    usage: limits(96),
    candidates: [candidate('b', 50), candidate('c', 20)],
    candidateCount: 2,
    lastUsageReadAt: 0,
    lastMoveAt: 0,
    lastFailureAt: 0,
    targetClaims: new Map(),
    ...overrides
  }
}

describe('decideClaudeSessionMove', () => {
  it('moves an idle session over the line to the account with the most room', () => {
    expect(decideClaudeSessionMove(inputs())).toEqual({
      kind: 'move',
      to: 'c',
      window: { name: 'session', percent: 96, line: 95 }
    })
  })

  it('waits for the turn to end, and for a first status', () => {
    expect(decideClaudeSessionMove(inputs({ paneState: 'working' }))).toEqual({
      kind: 'wait',
      reason: 'mid-turn'
    })
    expect(decideClaudeSessionMove(inputs({ paneState: 'blocked' }))).toEqual({
      kind: 'wait',
      reason: 'mid-turn'
    })
    expect(decideClaudeSessionMove(inputs({ paneState: null }))).toEqual({
      kind: 'wait',
      reason: 'no-status'
    })
  })

  it('does not wait mid-turn when the main agent is done and no background work is alive', () => {
    // paneState is the main agent's state once the session view is collected.
    const decision = decideClaudeSessionMove(inputs({ paneState: 'done' }))
    expect(decision).not.toEqual({ kind: 'wait', reason: 'mid-turn' })
    expect(decision.kind).toBe('move')
  })

  it('holds a done main agent while background work is alive, then moves', () => {
    const waiting = {
      paneState: 'done' as const,
      paneBackgroundWork: true,
      backgroundWaitStartedAt: NOW - CLAUDE_SESSION_MOVE_BACKGROUND_WAIT_MS + 1
    }
    expect(decideClaudeSessionMove(inputs(waiting))).toEqual({
      kind: 'wait',
      reason: 'background-work'
    })
    expect(
      decideClaudeSessionMove(
        inputs({
          ...waiting,
          backgroundWaitStartedAt: NOW - CLAUDE_SESSION_MOVE_BACKGROUND_WAIT_MS
        })
      ).kind
    ).toBe('move')
    expect(decideClaudeSessionMove(inputs({ ...waiting, backgroundWaitStartedAt: 0 })).kind).toBe(
      'wait'
    )
    expect(
      decideClaudeSessionMove(
        inputs({ ...waiting, usage: limits(100), backgroundWaitStartedAt: NOW })
      ).kind
    ).toBe('move')
    expect(
      decideClaudeSessionMove(inputs({ paneState: 'done', paneBackgroundWork: false })).kind
    ).toBe('move')
    expect(
      decideClaudeSessionMove(inputs({ paneState: 'working', paneBackgroundWork: true }))
    ).toEqual({ kind: 'wait', reason: 'mid-turn' })
  })

  it('leaves a pinned session alone until its account is at the limit', () => {
    expect(decideClaudeSessionMove(inputs({ pinned: true, usage: limits(96) }))).toEqual({
      kind: 'stay',
      reason: 'under-line'
    })
    expect(decideClaudeSessionMove(inputs({ pinned: true, usage: limits(100) })).kind).toBe('move')
  })

  it('stays under the line and when the setting is off', () => {
    expect(decideClaudeSessionMove(inputs({ usage: limits(80) }))).toEqual({
      kind: 'stay',
      reason: 'under-line'
    })
    expect(decideClaudeSessionMove(inputs({ setting: 'off' }))).toEqual({
      kind: 'stay',
      reason: 'off'
    })
  })

  it("asks for a reading when the session's usage is stale, then stays until one arrives", () => {
    const stale = limits(96, NOW - 16 * 60_000)
    expect(decideClaudeSessionMove(inputs({ usage: stale }))).toEqual({ kind: 'read-usage' })
    expect(decideClaudeSessionMove(inputs({ usage: stale, lastUsageReadAt: NOW - 1_000 }))).toEqual(
      { kind: 'stay', reason: 'no-usage' }
    )
    expect(decideClaudeSessionMove(inputs({ usage: null }))).toEqual({ kind: 'read-usage' })
  })

  it("waits for every candidate's reading before picking, unless one is unreadable", () => {
    expect(decideClaudeSessionMove(inputs({ candidates: [candidate('b', 50)] }))).toEqual({
      kind: 'read-usage'
    })
    const unreadable: InactiveAccountUsage = {
      ...candidate('c', 20, NOW - 60 * 60_000),
      rateLimits: { ...limits(20, NOW - 60 * 60_000), usageMetadata: { retryAtMs: NOW + 60_000 } }
    }
    expect(
      decideClaudeSessionMove(inputs({ candidates: [candidate('b', 50), unreadable] }))
    ).toMatchObject({ kind: 'move', to: 'b' })
  })

  it('honours the per-session cooldown and the failure hold, except at the limit', () => {
    expect(
      decideClaudeSessionMove(inputs({ lastMoveAt: NOW - CLAUDE_SESSION_MOVE_COOLDOWN_MS + 1 }))
    ).toEqual({ kind: 'stay', reason: 'cooldown' })
    expect(
      decideClaudeSessionMove(
        inputs({ lastMoveAt: NOW - CLAUDE_SESSION_MOVE_COOLDOWN_MS + 1, usage: limits(100) })
      ).kind
    ).toBe('move')
    expect(
      decideClaudeSessionMove(
        inputs({ lastFailureAt: NOW - CLAUDE_SESSION_MOVE_FAILURE_HOLD_MS + 1 })
      )
    ).toEqual({ kind: 'stay', reason: 'failed-recently' })
    expect(
      decideClaudeSessionMove(inputs({ lastFailureAt: NOW - CLAUDE_SESSION_MOVE_FAILURE_HOLD_MS }))
        .kind
    ).toBe('move')
  })

  it('skips a target another session just claimed, then ranks it with the claim debited', () => {
    const claims = new Map([['c', { at: NOW - 1_000, debit: 5 }]])
    expect(decideClaudeSessionMove(inputs({ targetClaims: claims }))).toMatchObject({
      kind: 'move',
      to: 'b'
    })
    const older = new Map([['c', { at: NOW - CLAUDE_SESSION_MOVE_TARGET_COOLDOWN_MS, debit: 40 }]])
    // c reads 20 + 40 = 60 after the debit, so b (50) has more room.
    expect(decideClaudeSessionMove(inputs({ targetClaims: older }))).toMatchObject({
      kind: 'move',
      to: 'b'
    })
    expect(
      debitClaimedUsage(candidate('c', 20), { at: NOW - 1_000, debit: 5 }, NOW).rateLimits?.session
        ?.usedPercent
    ).toBe(25)
    expect(
      debitClaimedUsage(candidate('c', 98), { at: NOW - 1_000, debit: 5 }, NOW).rateLimits?.session
        ?.usedPercent
    ).toBe(100)
  })

  it('stays when no account has enough room', () => {
    expect(
      decideClaudeSessionMove(inputs({ candidates: [candidate('b', 90), candidate('c', 88)] }))
    ).toEqual({ kind: 'stay', reason: 'no-target' })
  })
})
