import { describe, expect, it } from 'vitest'
import type { InactiveAccountUsage, ProviderRateLimits } from '../../shared/rate-limit-types'
import {
  CLAUDE_AUTO_SWITCH_COOLDOWN_MS,
  pickClaudeAutoSwitchTarget
} from './claude-account-auto-switch-policy'

function limits(session: number, weekly = 0, status: ProviderRateLimits['status'] = 'ok') {
  const window = (usedPercent: number, windowMinutes: number) => ({
    usedPercent,
    windowMinutes,
    resetsAt: null,
    resetDescription: null
  })
  return {
    provider: 'claude' as const,
    session: window(session, 300),
    weekly: window(weekly, 10_080),
    updatedAt: 0,
    error: null,
    status
  }
}

function usage(accountId: string, rateLimits: ProviderRateLimits): InactiveAccountUsage {
  return { accountId, rateLimits, updatedAt: rateLimits.updatedAt, isFetching: false }
}

const COOLED_DOWN = CLAUDE_AUTO_SWITCH_COOLDOWN_MS

describe('pickClaudeAutoSwitchTarget', () => {
  it('stays while the active account is under the line', () => {
    expect(pickClaudeAutoSwitchTarget(limits(89), [usage('b', limits(0))], COOLED_DOWN)).toBe(null)
  })

  it('moves to the account with the most room once the active account crosses the line', () => {
    const candidates = [usage('b', limits(50)), usage('c', limits(20)), usage('d', limits(35))]

    expect(pickClaudeAutoSwitchTarget(limits(90), candidates, COOLED_DOWN)).toBe('c')
  })

  it('counts the weekly window as well as the 5-hour one', () => {
    expect(
      pickClaudeAutoSwitchTarget(limits(10, 95), [usage('b', limits(10, 10))], COOLED_DOWN)
    ).toBe('b')
  })

  it('ranks candidates by their tightest window', () => {
    const candidates = [usage('b', limits(5, 85)), usage('c', limits(40, 40))]

    expect(pickClaudeAutoSwitchTarget(limits(92), candidates, COOLED_DOWN)).toBe('c')
  })

  it('stays when the best account is not clearly better', () => {
    expect(pickClaudeAutoSwitchTarget(limits(91), [usage('b', limits(86))], COOLED_DOWN)).toBe(null)
  })

  it('never moves to an account that is itself over the line before the limit is hit', () => {
    expect(pickClaudeAutoSwitchTarget(limits(99), [usage('b', limits(90))], COOLED_DOWN)).toBe(null)
  })

  it('skips accounts whose usage could not be read', () => {
    const candidates = [usage('expired', limits(0, 0, 'error')), usage('b', limits(40))]

    expect(pickClaudeAutoSwitchTarget(limits(95), candidates, COOLED_DOWN)).toBe('b')
  })

  it('stays while the active usage cannot be read', () => {
    expect(
      pickClaudeAutoSwitchTarget(limits(100, 0, 'error'), [usage('b', limits(0))], COOLED_DOWN)
    ).toBe(null)
  })

  it('waits out the cooldown after the last switch', () => {
    const candidates = [usage('b', limits(10))]

    expect(pickClaudeAutoSwitchTarget(limits(95), candidates, COOLED_DOWN - 1)).toBe(null)
  })

  it('at the limit, takes any account with room even during the cooldown', () => {
    const candidates = [usage('b', limits(97)), usage('c', limits(100))]

    expect(pickClaudeAutoSwitchTarget(limits(100), candidates, 0)).toBe('b')
  })

  it('stays when every account is out', () => {
    const candidates = [usage('b', limits(100)), usage('c', limits(20, 100))]

    expect(pickClaudeAutoSwitchTarget(limits(100), candidates, COOLED_DOWN)).toBe(null)
  })
})
