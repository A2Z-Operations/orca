import { describe, expect, it } from 'vitest'
import type { AgentHookStatusChangeEntry } from '../agent-hooks/server/server-types'
import type { ClaudePaneAccountRecord } from './claude-pane-account-registry'
import { collectClaudeMoverSessions } from './claude-session-mover-sessions'

const PANE = 'tab-1:0195f2ce-1111-4000-8000-000000000001'

function record(): ClaudePaneAccountRecord {
  return {
    ptyId: 'pty-1',
    paneKey: PANE,
    accountId: 'acct-a',
    configDir: '/profiles/acct-a/home',
    launchedAt: 0,
    pinned: false,
    source: 'spawn'
  }
}

function status(
  state: AgentHookStatusChangeEntry['state'],
  mainAgentState?: AgentHookStatusChangeEntry['mainAgentState']
): AgentHookStatusChangeEntry {
  return {
    paneKey: PANE,
    state,
    ...(mainAgentState ? { mainAgentState } : {}),
    receivedAt: 1,
    observedInCurrentRuntime: true
  }
}

function paneState(entry: AgentHookStatusChangeEntry): string | null {
  return (
    collectClaudeMoverSessions({
      records: [record()],
      statuses: [entry],
      providerSessions: [],
      resolveProviderSession: () => null,
      resolvePaneKey: () => PANE,
      resolvePtyIdForPaneKey: () => null,
      resolveWorktreeId: () => null,
      accounts: [],
      recordInferred: () => {},
      now: 1
    })[0]?.paneState ?? null
  )
}

describe('collectClaudeMoverSessions', () => {
  it('carries the main agent state so a monitoring pane reads as idle', () => {
    expect(paneState(status('working', 'done'))).toBe('done')
    expect(paneState(status('working', 'working'))).toBe('working')
    expect(paneState(status('blocked'))).toBe('blocked')
    expect(paneState(status('waiting'))).toBe('waiting')
  })
})
