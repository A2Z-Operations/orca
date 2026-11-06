// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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

  it('Load older reaches rows that share the oldest millisecond, without repeating it', async () => {
    const oldestAt = RECENT_MOVES_NOW - 14 * 60_000
    const sameTick = (ptyId: string) => ({
      type: 'decision' as const,
      at: oldestAt,
      ptyId,
      paneKey: null,
      fromAccountId: 'acct-a',
      toAccountId: 'acct-b',
      reason: 'moved',
      strategy: 'resume' as const
    })
    // The page the host serves ends on the same tick the table already shows: the move it has, plus
    // two more panes moved in that same millisecond that the first page's limit cut off.
    rpc.call.mockResolvedValue({
      entries: [sameTick('pty-moved'), sameTick('pty-same-ms-1'), sameTick('pty-same-ms-2')]
    })
    renderTable()
    expect(screen.getAllByTestId('claude-move-row')).toHaveLength(3)
    const loadOlder = screen.getByRole('button', { name: 'Load older' })
    fireEvent.click(loadOlder)
    expect(await screen.findByText('25 rows')).toBeTruthy()
    expect(rpc.call.mock.calls[0]?.[2]).toMatchObject({ before: oldestAt + 1 })
    // The oldest row still sits on that tick; the next page asks for it again and repeats nothing.
    fireEvent.click(loadOlder)
    await waitFor(() => expect(loadOlder.hasAttribute('disabled')).toBe(false))
    expect(rpc.call).toHaveBeenCalledTimes(2)
    expect(rpc.call.mock.calls[1]?.[2]).toMatchObject({ before: oldestAt + 1 })
    expect(screen.getByText('25 rows')).toBeTruthy()
    expect(screen.getAllByTestId('claude-move-row')).toHaveLength(5)
  })
})
