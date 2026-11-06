// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getDefaultSettings } from '../../../../shared/constants'
import type { ClaudeModelPolicyEvaluation } from '../../../../shared/managed-account-types'
import { ClaudeModelPolicyCoversExplicitSetting } from './claude-model-policy-covers-explicit-setting'

const row = (ptyId: string, skip: string | null): ClaudeModelPolicyEvaluation => ({
  ptyId,
  paneKey: null,
  accountId: 'a',
  model: null,
  source: null,
  choice: null,
  reason: skip ?? 'fable-line',
  skip,
  at: 0
})

describe('ClaudeModelPolicyCoversExplicitSetting', () => {
  afterEach(() => cleanup())

  it('counts sessions launched with a fixed model and writes the switch', () => {
    const updateSettings = vi.fn()
    render(
      <ClaudeModelPolicyCoversExplicitSetting
        settings={getDefaultSettings('/home/test')}
        updateSettings={updateSettings}
        evaluations={[
          row('1', 'pinned'),
          row('2', 'not-policy'),
          row('3', null),
          row('4', 'stale')
        ]}
      />
    )
    expect(screen.getByTestId('claude-fixed-model-sessions').textContent).toBe(
      '2 live sessions were launched with a fixed model.'
    )
    const toggle = screen.getByRole('switch', {
      name: 'Also switch sessions launched with a fixed model'
    })
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(toggle)
    expect(updateSettings).toHaveBeenCalledWith({ claudeModelPolicyCoversExplicit: true })
  })

  it('hides while the model policy is off', () => {
    const settings = {
      ...getDefaultSettings('/home/test'),
      claudeModelPolicy: { enabled: false, fableLine: 90, weeklyGuard: 91 }
    }
    render(
      <ClaudeModelPolicyCoversExplicitSetting
        settings={settings}
        updateSettings={() => {}}
        evaluations={[row('1', 'pinned')]}
      />
    )
    expect(screen.queryByRole('switch')).toBeNull()
  })
})
