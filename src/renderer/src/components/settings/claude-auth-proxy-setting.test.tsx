// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { getDefaultSettings } from '../../../../shared/constants'
import { ClaudeAuthProxySetting } from './claude-auth-proxy-setting'

const NOW = Date.parse('2026-11-05T07:00:00Z')
const settings = getDefaultSettings('/home/test')

function renderRow(health: Parameters<typeof ClaudeAuthProxySetting>[0]['health']) {
  render(
    <ClaudeAuthProxySetting
      settings={settings}
      updateSettings={() => {}}
      health={health}
      now={NOW}
    />
  )
}

describe('ClaudeAuthProxySetting health', () => {
  afterEach(() => cleanup())

  it('warns about unknown slots and an upstream error within the hour', () => {
    renderRow({
      listening: true,
      unknownSlotRequests: 3,
      lastError: {
        at: NOW - 9 * 60_000,
        method: 'POST',
        path: '/v1/messages',
        status: 429,
        accountId: 'b'
      }
    })
    const line = screen.getByTestId('claude-auth-proxy-health')
    expect(line.dataset.warn).toBe('true')
    expect(line.textContent).toContain('Requests from unknown slots: 3')
    expect(line.textContent).toContain('Last upstream error: 429 POST /v1/messages, 9 minutes ago')
  })

  it('is quiet when healthy, and hidden without a listener or on an older host', () => {
    renderRow({ listening: true, unknownSlotRequests: 0, lastError: null })
    const line = screen.getByTestId('claude-auth-proxy-health')
    expect(line.dataset.warn).toBe('false')
    expect(line.textContent).toContain('No upstream errors')
    cleanup()
    renderRow({ listening: false, unknownSlotRequests: 0, lastError: null })
    expect(screen.queryByTestId('claude-auth-proxy-health')).toBeNull()
    cleanup()
    renderRow(undefined)
    expect(screen.queryByTestId('claude-auth-proxy-health')).toBeNull()
  })

  it('an error older than an hour is history, not a warning', () => {
    renderRow({
      listening: true,
      unknownSlotRequests: 0,
      lastError: {
        at: NOW - 3 * 3_600_000,
        method: 'GET',
        path: '/v1/models',
        status: 500,
        accountId: null
      }
    })
    expect(screen.getByTestId('claude-auth-proxy-health').dataset.warn).toBe('false')
  })
})
