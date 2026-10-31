import { describe, expect, it, vi } from 'vitest'
import {
  createClaudeUsagePollingSwitch,
  shouldPollClaudeUsage
} from './claude-usage-polling-policy'

describe('claude usage polling policy', () => {
  it('polls when auto-switch, the mover, or the model policy needs readings', () => {
    expect(
      shouldPollClaudeUsage({
        claudeAutoSwitchEnabled: false,
        claudeSessionMover: 'off',
        claudeModelPolicy: { enabled: false }
      })
    ).toBe(false)
    expect(
      shouldPollClaudeUsage({
        claudeAutoSwitchEnabled: false,
        claudeSessionMover: 'off',
        claudeModelPolicy: { enabled: true }
      })
    ).toBe(true)
    expect(
      shouldPollClaudeUsage({ claudeAutoSwitchEnabled: true, claudeSessionMover: 'off' })
    ).toBe(true)
    expect(
      shouldPollClaudeUsage({ claudeAutoSwitchEnabled: false, claudeSessionMover: 'move' })
    ).toBe(true)
    expect(
      shouldPollClaudeUsage({
        claudeAutoSwitchEnabled: false,
        claudeSessionMover: 'off',
        claudeAccountPool: 'on'
      })
    ).toBe(true)
    expect(
      shouldPollClaudeUsage({
        claudeAutoSwitchEnabled: false,
        claudeSessionMover: 'off',
        claudeAccountPool: 'off',
        claudeModelPolicy: { enabled: false }
      })
    ).toBe(false)
    // Absent means 'ask', which on a headless host acts as 'move'.
    expect(shouldPollClaudeUsage({})).toBe(true)
  })

  it('starts once, stops once, and ignores unrelated settings changes', () => {
    const rateLimits = { start: vi.fn(), stop: vi.fn() }
    let settings: {
      claudeAutoSwitchEnabled?: boolean
      claudeSessionMover?: 'off' | 'ask' | 'move'
      claudeModelPolicy?: { enabled: boolean }
    } = { claudeSessionMover: 'off', claudeModelPolicy: { enabled: false } }
    const polling = createClaudeUsagePollingSwitch(rateLimits, () => settings)

    expect(polling.apply()).toBe(false)
    expect(rateLimits.start).not.toHaveBeenCalled()

    settings = { claudeSessionMover: 'move' }
    expect(polling.apply({ claudeSessionMover: 'move' })).toBe(true)
    expect(polling.apply({ claudeSessionMover: 'move' })).toBe(true)
    expect(rateLimits.start).toHaveBeenCalledTimes(1)
    expect(rateLimits.start).toHaveBeenCalledWith({
      fetchImmediately: true,
      pollWithoutWindow: true,
      pollInactiveClaude: true
    })

    expect(polling.apply({ appFontFamily: 'unused' })).toBe(true)
    expect(rateLimits.stop).not.toHaveBeenCalled()

    settings = {
      claudeSessionMover: 'off',
      claudeAutoSwitchEnabled: false,
      claudeModelPolicy: { enabled: false }
    }
    expect(polling.apply({ claudeSessionMover: 'off' })).toBe(false)
    expect(rateLimits.stop).toHaveBeenCalledTimes(1)
  })
})
