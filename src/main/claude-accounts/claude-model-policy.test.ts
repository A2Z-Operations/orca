import { describe, expect, it } from 'vitest'
import type { ProviderRateLimits } from '../../shared/rate-limit-types'
import type { ClaudePoolAccount, ClaudePoolUsage } from './claude-account-pool-policy'
import {
  CLAUDE_FABLE_MODEL_ID,
  CLAUDE_MODEL_POLICY_STRAND_WARNING,
  CLAUDE_OPUS_MODEL_ID,
  chooseClaudeModel,
  chooseClaudePoolAccountForModel,
  resolveClaudeModelPolicy
} from './claude-model-policy'

const NOW = Date.UTC(2026, 9, 29, 12)

function window(usedPercent: number, resetsAt: number | null = null) {
  return { usedPercent, windowMinutes: 10_080, resetsAt, resetDescription: null }
}

function limits(
  weekly: number | null,
  fable: number | null,
  extra: Partial<ProviderRateLimits> = {}
): ProviderRateLimits {
  return {
    provider: 'claude',
    session: window(0),
    weekly: weekly === null ? null : window(weekly),
    ...(fable === null ? {} : { fableWeekly: window(fable) }),
    updatedAt: NOW,
    error: null,
    status: 'ok',
    ...extra
  }
}

function account(id: string, extra: Partial<ClaudePoolAccount> = {}): ClaudePoolAccount {
  return { id, signedIn: true, ...extra }
}

function usage(
  accountId: string,
  rateLimits: ProviderRateLimits | null,
  updatedAt = NOW
): ClaudePoolUsage {
  return { accountId, rateLimits, updatedAt }
}

describe('resolveClaudeModelPolicy', () => {
  it('defaults on at 90 and 91, and an explicit false turns it off', () => {
    expect(resolveClaudeModelPolicy(undefined)).toEqual({
      enabled: true,
      fableLine: 90,
      weeklyGuard: 91
    })
    expect(resolveClaudeModelPolicy({ claudeModelPolicy: { enabled: false } }).enabled).toBe(false)
    expect(
      resolveClaudeModelPolicy({ claudeModelPolicy: { fableLine: 0, weeklyGuard: 140 } })
    ).toMatchObject({ fableLine: 1, weeklyGuard: 100 })
  })
})

describe('chooseClaudeModel', () => {
  it('runs Fable while both windows are under their lines', () => {
    expect(chooseClaudeModel({ limits: limits(42, 71), now: NOW })).toMatchObject({
      model: 'fable',
      modelId: CLAUDE_FABLE_MODEL_ID,
      reason: 'fable-headroom'
    })
  })

  it('runs Opus when either line is crossed or a window is missing', () => {
    expect(chooseClaudeModel({ limits: limits(42, 90), now: NOW })).toMatchObject({
      model: 'opus',
      modelId: CLAUDE_OPUS_MODEL_ID,
      reason: 'fable-line'
    })
    expect(chooseClaudeModel({ limits: limits(91, 10), now: NOW }).reason).toBe('weekly-guard')
    expect(chooseClaudeModel({ limits: limits(10, null), now: NOW }).reason).toBe('fable-unread')
    expect(chooseClaudeModel({ limits: limits(null, 10), now: NOW }).reason).toBe('weekly-unread')
    expect(chooseClaudeModel({ limits: null, now: NOW }).model).toBe('opus')
  })

  it('treats a window past its reset as empty', () => {
    const reset = limits(95, 95, {
      weekly: window(95, NOW - 1),
      fableWeekly: window(95, NOW - 1)
    })
    expect(chooseClaudeModel({ limits: reset, now: NOW }).reason).toBe('window-reset')
  })

  it('returns to Fable only 5 points under both lines', () => {
    const over = limits(88, 86)
    expect(chooseClaudeModel({ limits: over, now: NOW, current: 'opus' }).reason).toBe('hysteresis')
    expect(chooseClaudeModel({ limits: limits(85, 84), now: NOW, current: 'opus' }).model).toBe(
      'fable'
    )
    expect(chooseClaudeModel({ limits: limits(91, 10), now: NOW, current: 'fable' }).model).toBe(
      'opus'
    )
  })

  it('warns once weekly usage reaches 80, and stays quiet when the policy is off', () => {
    expect(chooseClaudeModel({ limits: limits(80, 10), now: NOW }).warning).toBe(
      CLAUDE_MODEL_POLICY_STRAND_WARNING
    )
    expect(chooseClaudeModel({ limits: limits(79, 10), now: NOW }).warning).toBeNull()
    expect(
      chooseClaudeModel({
        limits: limits(10, 10),
        now: NOW,
        settings: { claudeModelPolicy: { enabled: false } }
      }).reason
    ).toBe('off')
  })
})

describe('chooseClaudePoolAccountForModel', () => {
  const base = {
    now: NOW,
    pinnedCounts: {},
    assignedCounts: {}
  }

  it('ranks Fable-eligible accounts by Fable headroom, then assigned panes', () => {
    const choice = chooseClaudePoolAccountForModel({
      ...base,
      accounts: [account('a', { selected: true }), account('b'), account('c')],
      usage: [usage('a', limits(20, 40)), usage('b', limits(10, 10)), usage('c', limits(5, 10))],
      assignedCounts: { b: 3, c: 0 }
    })
    expect(choice).toMatchObject({ accountId: 'c', kind: 'chosen', model: 'fable' })
  })

  it('falls back to the most weekly headroom for Opus when nobody can run Fable', () => {
    const choice = chooseClaudePoolAccountForModel({
      ...base,
      accounts: [account('a', { selected: true }), account('b')],
      usage: [usage('a', limits(40, 95)), usage('b', limits(20, 95))]
    })
    expect(choice).toMatchObject({ accountId: 'b', model: 'opus', reason: 'fable-line' })
  })

  it('skips a pinned or stale account and warns when the winner is near the weekly guard', () => {
    const choice = chooseClaudePoolAccountForModel({
      ...base,
      accounts: [account('a'), account('b', { selected: true })],
      usage: [usage('a', limits(10, 5)), usage('b', limits(85, 10))],
      pinnedCounts: { a: 1 }
    })
    expect(choice).toMatchObject({
      accountId: 'b',
      warning: CLAUDE_MODEL_POLICY_STRAND_WARNING
    })
    expect(
      chooseClaudePoolAccountForModel({
        ...base,
        accounts: [account('a', { selected: true })],
        usage: [usage('a', limits(10, 10), NOW - 60 * 60 * 1000)]
      })?.kind
    ).toBe('fallback')
  })

  it('does not invent an account when nothing is selected and nothing is fresh', () => {
    expect(
      chooseClaudePoolAccountForModel({
        ...base,
        accounts: [account('a')],
        usage: []
      })
    ).toBeNull()
  })
})
