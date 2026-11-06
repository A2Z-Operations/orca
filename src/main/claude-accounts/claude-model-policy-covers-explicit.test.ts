import { afterEach, describe, expect, it } from 'vitest'
import type { ProviderRateLimits } from '../../shared/rate-limit-types'
import type { ClaudePaneAccountRecord } from './claude-pane-account-registry'
import {
  claudeModelPolicyEvaluations,
  resetClaudeModelPolicyEvaluations
} from './claude-model-policy-evaluations'
import {
  createClaudeModelPolicyTicker,
  type ClaudeModelPolicyFlip
} from './claude-model-policy-ticker'
import { claudeModelPolicySettingsUpdate } from './claude-account-list-extras'

afterEach(() => {
  resetClaudeModelPolicyEvaluations()
})

const NOW = Date.UTC(2026, 10, 5, 6)

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

function pane(ptyId: string, extra: Partial<ClaudePaneAccountRecord>): ClaudePaneAccountRecord {
  return {
    ptyId,
    paneKey: `pane-${ptyId}`,
    accountId: 'acct',
    configDir: null,
    launchedAt: NOW,
    pinned: false,
    source: 'spawn',
    ...extra
  }
}

const panes = [
  pane('explicit-fable', { model: 'fable', modelSource: 'pinned' }),
  pane('explicit-sonnet', { model: 'claude-sonnet-4-6', modelSource: 'pinned' }),
  pane('unrecorded', {})
]

function run(
  coversExplicit: boolean | undefined,
  options: { panes?: ClaudePaneAccountRecord[]; uncover?: (ptyId: string) => void } = {}
): ClaudeModelPolicyFlip[] {
  const ticker = createClaudeModelPolicyTicker({
    getSettings: () => ({
      claudeModelPolicy: { enabled: true, fableLine: 90, weeklyGuard: 91 },
      ...(coversExplicit === undefined ? {} : { claudeModelPolicyCoversExplicit: coversExplicit })
    }),
    panes: () => options.panes ?? panes,
    // Fable is over its line, so the policy wants Opus.
    usageFor: () => ({ rateLimits: limits(50, 95), updatedAt: NOW }),
    subscribe: () => () => {},
    apply: () => {},
    uncover: (target) => options.uncover?.(target.ptyId),
    now: () => NOW
  })
  return ticker.evaluate()
}

describe('model policy covers explicit-model panes', () => {
  it('off (the default) leaves explicit and unrecorded panes alone, as today', () => {
    expect(run(undefined)).toEqual([])
    expect(run(false)).toEqual([])
    const skips = Object.fromEntries(
      claudeModelPolicyEvaluations().map((row) => [row.ptyId, row.skip])
    )
    expect(skips).toEqual({
      'explicit-fable': 'pinned',
      'explicit-sonnet': 'pinned',
      unrecorded: 'not-policy'
    })
  })

  it('on flips an explicit Fable pane and takes over an unrecorded one; Sonnet stays', () => {
    const flips = run(true)
    expect(flips.map((flip) => `${flip.ptyId}:${flip.from}->${flip.to}`)).toEqual([
      'explicit-fable:fable->opus',
      'unrecorded:unset->opus'
    ])
    const sonnet = claudeModelPolicyEvaluations().find((row) => row.ptyId === 'explicit-sonnet')
    expect(sonnet?.skip).toBe('unrecognized-model')
  })

  it('off again uncovers a pane the policy took over; on keeps it under the lines', () => {
    const covered = [
      pane('covered', { model: 'opus', modelSource: 'policy', launchModel: 'fable' })
    ]
    const uncovered: string[] = []
    const uncover = (ptyId: string) => uncovered.push(ptyId)
    expect(run(true, { panes: covered, uncover })).toEqual([])
    expect(uncovered).toEqual([])
    expect(claudeModelPolicyEvaluations()[0]?.skip).toBe('same')
    expect(run(false, { panes: covered, uncover })).toEqual([])
    expect(run(undefined, { panes: covered, uncover })).toEqual([])
    expect(uncovered).toEqual(['covered', 'covered'])
    expect(claudeModelPolicyEvaluations()[0]).toMatchObject({
      reason: 'uncovered',
      skip: 'uncovered'
    })
    // A pane the policy chose for from launch has nothing to go back to.
    expect(
      run(false, { panes: [pane('policy', { model: 'opus', modelSource: 'policy' })], uncover })
    ).toEqual([])
    expect(uncovered).toHaveLength(2)
  })

  it('the settings patch writes the switch only when given, and keeps the lines', () => {
    const current = {
      claudeModelPolicy: { enabled: true, fableLine: 80, weeklyGuard: 85 },
      claudeModelPolicyCoversExplicit: true
    }
    expect(claudeModelPolicySettingsUpdate(current, { fableLine: 70 })).toEqual({
      claudeModelPolicy: { enabled: true, fableLine: 70, weeklyGuard: 85 }
    })
    expect(claudeModelPolicySettingsUpdate(current, { coversExplicit: false })).toEqual({
      claudeModelPolicy: { enabled: true, fableLine: 80, weeklyGuard: 85 },
      claudeModelPolicyCoversExplicit: false
    })
  })
})
