import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ProviderRateLimits } from '../../shared/rate-limit-types'
import type { ClaudePaneAccountRecord } from './claude-pane-account-registry'
import { resetClaudeModelPolicyEvaluations } from './claude-model-policy-evaluations'
import { createClaudeModelPolicyTicker } from './claude-model-policy-ticker'
import { CLAUDE_MODEL_POLICY_FLIP_COOLDOWN_MS } from './claude-model-policy'

afterEach(() => {
  resetClaudeModelPolicyEvaluations()
})

const NOW = Date.UTC(2026, 9, 29, 12)

function limits(weekly: number, fable: number): ProviderRateLimits {
  const window = (usedPercent: number) => ({
    usedPercent,
    windowMinutes: 10080,
    resetsAt: NOW + 86_400_000,
    resetDescription: null
  })
  return {
    provider: 'claude',
    session: window(10),
    weekly: window(weekly),
    fableWeekly: window(fable),
    updatedAt: NOW,
    error: null,
    status: 'ok'
  }
}

function pane(model: 'fable' | 'opus'): ClaudePaneAccountRecord {
  return {
    ptyId: 'pty-1',
    paneKey: 'pane-1',
    accountId: 'acct',
    configDir: '/tmp/claude',
    launchedAt: NOW,
    pinned: false,
    source: 'spawn',
    model,
    modelSource: 'policy'
  }
}

describe('createClaudeModelPolicyTicker', () => {
  it('leaves Fable at the weekly line and waits out hysteresis plus the cooldown to return', () => {
    const applied: string[] = []
    let current: 'fable' | 'opus' = 'fable'
    let usage = limits(91, 10)
    let now = NOW
    const ticker = createClaudeModelPolicyTicker({
      getSettings: () => ({ claudeModelPolicy: { enabled: true, fableLine: 90, weeklyGuard: 91 } }),
      panes: () => [pane(current)],
      usageFor: () => ({ rateLimits: usage, updatedAt: now }),
      subscribe: () => () => {},
      apply: (flip) => {
        applied.push(`${flip.from}->${flip.to}:${flip.reason}`)
        current = flip.to
      },
      now: () => now
    })

    expect(ticker.evaluate().map((flip) => flip.to)).toEqual(['opus'])
    // Still inside the 10 minute claim, even though both windows are under the return cut.
    usage = limits(80, 10)
    expect(ticker.evaluate()).toEqual([])
    // Weekly 86 is the return cut (91 - 5). At the cut the slot stays on Opus.
    usage = limits(86, 10)
    now = NOW + CLAUDE_MODEL_POLICY_FLIP_COOLDOWN_MS
    expect(ticker.evaluate()).toEqual([])
    usage = limits(80, 10)
    now = NOW + 2 * CLAUDE_MODEL_POLICY_FLIP_COOLDOWN_MS
    expect(ticker.evaluate().map((flip) => `${flip.to}:${flip.reason}`)).toEqual([
      'fable:fable-headroom'
    ])
    expect(applied).toEqual(['fable->opus:weekly-guard', 'opus->fable:fable-headroom'])
  })

  it('does not flip a pinned model', () => {
    const ticker = createClaudeModelPolicyTicker({
      getSettings: () => ({}),
      panes: () => [{ ...pane('fable'), modelSource: 'pinned' }],
      usageFor: () => ({ rateLimits: limits(99, 99), updatedAt: NOW }),
      subscribe: () => () => {},
      apply: () => {
        throw new Error('pinned')
      },
      now: () => NOW
    })
    expect(ticker.evaluate()).toEqual([])
  })

  it('flips on a settings change without waiting for the next usage publish', () => {
    let current: 'fable' | 'opus' = 'fable'
    let settings = { claudeModelPolicy: { enabled: true, fableLine: 90, weeklyGuard: 91 } }
    const onSettings: { current: (() => void) | null } = { current: null }
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const ticker = createClaudeModelPolicyTicker({
      getSettings: () => settings,
      panes: () => [pane(current)],
      usageFor: () => ({ rateLimits: limits(64, 63), updatedAt: NOW }),
      subscribe: () => () => {},
      subscribeSettings: (listener) => {
        onSettings.current = listener
        return () => {
          onSettings.current = null
        }
      },
      apply: (flip) => {
        current = flip.to
      },
      now: () => NOW
    })
    const stop = ticker.start()
    expect(current).toBe('fable')
    expect(info).toHaveBeenCalledWith('[claude-model-policy] started')
    settings = { claudeModelPolicy: { enabled: true, fableLine: 1, weeklyGuard: 1 } }
    onSettings.current?.()
    expect(current).toBe('opus')
    const lines = info.mock.calls.map((call) => String(call[0]))
    expect(lines.some((line) => line.includes('fable → opus') && line.includes('fable-line'))).toBe(
      true
    )
    stop()
    expect(info).toHaveBeenCalledWith('[claude-model-policy] stopped')
    info.mockRestore()
  })
})
