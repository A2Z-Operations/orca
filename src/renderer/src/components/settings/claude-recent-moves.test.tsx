// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ClaudeRecentMoves } from './claude-recent-moves'
import { RECENT_MOVES_NOW, recentMovesFixture } from './claude-recent-moves-test-fixture'

const rpc = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('@/runtime/runtime-rpc-client', () => ({ callRuntimeRpc: rpc.call }))

describe('ClaudeRecentMoves table', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(RECENT_MOVES_NOW)
    rpc.call.mockReset()
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  function renderTable() {
    render(<ClaudeRecentMoves accounts={recentMovesFixture()} owner={{ kind: 'local' }} />)
  }

  it('shows columns in words, one grouped line for the 20 stays, the flips and the move', () => {
    renderTable()
    const group = screen.getByTestId('claude-move-group')
    expect(group.textContent).toContain(
      '20 sessions stayed on a@example.com — Stayed: no account under the line'
    )
    expect(group.textContent).toContain('9 minutes ago')
    const rows = screen.getAllByTestId('claude-move-row')
    expect(rows).toHaveLength(3)
    const text = rows.map((element) => element.textContent ?? '')
    expect(text[0]).toContain('fable → opus')
    expect(text[0]).toContain('Switched model: Fable → Opus (Fable window at its line)')
    expect(text[2]).toContain('a@example.com → b@example.com')
    expect(text[2]).toContain('Moved (restarted)')
    expect(text[2]).toContain('restart')
    expect(document.body.textContent).not.toMatch(/acct-a|pty-moved/)
  })

  it('expands a group, filters by chip and account, and searches', () => {
    renderTable()
    fireEvent.click(within(screen.getByTestId('claude-move-group')).getByRole('button'))
    expect(screen.getAllByTestId('claude-move-row')).toHaveLength(23)
    fireEvent.click(screen.getByRole('button', { name: 'Flips' }))
    expect(screen.getAllByTestId('claude-move-row')).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: 'All' }))
    const strip = screen.getByTestId('claude-account-usage-strip')
    expect(strip.textContent).toContain('at line')
    fireEvent.click(within(strip).getByRole('button', { name: /b@example.com/ }))
    expect(screen.getAllByTestId('claude-move-row')).toHaveLength(1)
    fireEvent.click(within(strip).getByRole('button', { name: /b@example.com/ }))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'no such session' } })
    expect(screen.queryAllByTestId('claude-move-row')).toHaveLength(0)
  })

  it('Load older reads the account log before the oldest row', async () => {
    rpc.call.mockResolvedValue({
      entries: [
        {
          type: 'decision',
          at: RECENT_MOVES_NOW - 3 * 3_600_000,
          ptyId: 'old',
          paneKey: null,
          fromAccountId: 'acct-b',
          toAccountId: 'acct-a',
          reason: 'moved',
          strategy: 'proxy'
        }
      ]
    })
    renderTable()
    fireEvent.click(screen.getByRole('button', { name: 'Load older' }))
    expect(await screen.findByText('Moved (no restart)')).toBeTruthy()
    const [, method, params] = rpc.call.mock.calls[0] ?? []
    expect(method).toBe('accounts.claudeAccountLog')
    expect(params).toMatchObject({ limit: 200 })
  })
})
