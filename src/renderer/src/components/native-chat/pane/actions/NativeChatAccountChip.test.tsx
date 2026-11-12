// @vitest-environment happy-dom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import type {
  ClaudePaneAssignedEvent,
  ClaudeStructuredSessionSnapshot
} from '../../../../../../shared/managed-account-types'
import {
  structuredAgentSessionPaneKey,
  structuredAgentSessionTabId
} from '../../../../../../shared/agent-session/view/structured-agent-session-projection'
import { NativeChatAccountChip } from './NativeChatAccountChip'

const SESSION_ID = 'claude_81b8a449_33cc_4832_91c7_336c540e7c8b'
const PANE_KEY = structuredAgentSessionPaneKey(structuredAgentSessionTabId(SESSION_ID), SESSION_ID)

function savedChat(
  overrides: Partial<ClaudeStructuredSessionSnapshot>
): ClaudeStructuredSessionSnapshot {
  return {
    sessionId: SESSION_ID,
    paneKey: PANE_KEY,
    account: 'managed',
    accountId: 'acct-a',
    label: 'ada',
    email: 'ada@example.com',
    model: 'claude-opus-5-5',
    workspaceId: 'folder:one',
    lastActivityAt: 1_000,
    ...overrides
  }
}

let paneAssigned: ((event: ClaudePaneAssignedEvent) => void) | null = null

function hostWith(
  structuredSessions: ClaudeStructuredSessionSnapshot[],
  paneAccounts: { ptyId: string; label: string; email: string; model?: string }[] = []
): void {
  Object.assign(window, {
    api: {
      claudeAccounts: {
        list: vi.fn(async () => ({
          accounts: [],
          activeAccountId: null,
          structuredSessions,
          paneAccounts: paneAccounts.map((pane) => ({
            ...pane,
            paneKey: pane.ptyId,
            accountId: 'acct-a'
          }))
        })),
        onPaneAssigned: (listener: (event: ClaudePaneAssignedEvent) => void) => {
          paneAssigned = listener
          return () => {
            paneAssigned = null
          }
        }
      }
    }
  })
}

function renderChip() {
  return render(
    <TooltipProvider>
      <NativeChatAccountChip nativeChat={{ sessionId: SESSION_ID, agent: 'claude' }} />
    </TooltipProvider>
  )
}

afterEach(cleanup)

it("shows a saved chat's account label next to the model it runs", async () => {
  hostWith([savedChat({})])
  renderChip()
  expect(await screen.findByText('ada · claude-opus-5-5')).toBeTruthy()
})

it('says unknown account when the chat names a removed account', async () => {
  hostWith([
    savedChat({ account: 'unknown', accountId: 'acct-gone', label: undefined, email: undefined })
  ])
  renderChip()
  expect(await screen.findByText('unknown account · claude-opus-5-5')).toBeTruthy()
})

it("prefers the running launch's account over the saved record", async () => {
  hostWith(
    [savedChat({})],
    [{ ptyId: PANE_KEY, label: 'bob', email: 'bob@example.com', model: 'opus' }]
  )
  renderChip()
  expect(await screen.findByText('bob · opus')).toBeTruthy()
  expect(screen.queryByText('ada · claude-opus-5-5')).toBeNull()
})

it('follows a /model in the running chat', async () => {
  hostWith(
    [savedChat({})],
    [{ ptyId: PANE_KEY, label: 'bob', email: 'bob@example.com', model: 'opus' }]
  )
  renderChip()
  expect(await screen.findByText('bob · opus')).toBeTruthy()
  act(() => {
    paneAssigned?.({
      ptyId: PANE_KEY,
      paneKey: PANE_KEY,
      accountId: 'acct-a',
      label: 'bob',
      email: 'bob@example.com',
      model: 'sonnet'
    })
  })
  expect(await screen.findByText('bob · sonnet')).toBeTruthy()
  expect(screen.queryByText('bob · opus')).toBeNull()
})

it("shows the record's model when the running launch recorded none", async () => {
  hostWith([savedChat({})], [{ ptyId: PANE_KEY, label: 'bob', email: 'bob@example.com' }])
  renderChip()
  expect(await screen.findByText('bob · claude-opus-5-5')).toBeTruthy()
})
