import { afterEach, describe, expect, it } from 'vitest'
import { claudeAuthProxySlotModel } from '../claude-accounts/claude-auth-proxy/claude-auth-proxy-slot-owners'
import {
  _internals,
  getClaudePaneAccount,
  onClaudePaneAssigned,
  recordClaudePaneAccount,
  type ClaudePaneAssignedNotice
} from '../claude-accounts/claude-pane-account-registry'
import type { ClaudeModelSource } from '../claude-accounts/claude-model-policy'
import { noteStructuredClaudeRanModel } from './claude-structured-launch-model'
import { structuredClaudeSessionKey } from './claude-structured-session-key'

const SESSION_ID = 'claude_81b8a449_33cc_4832_91c7_336c540e7c8b'
const KEY = structuredClaudeSessionKey(SESSION_ID)

function chatPane(model?: string, modelSource?: ClaudeModelSource): void {
  recordClaudePaneAccount({
    ptyId: KEY,
    paneKey: KEY,
    surface: 'chat',
    accountId: 'acct-a',
    configDir: null,
    launchedAt: 0,
    pinned: false,
    source: 'spawn',
    proxySlot: 'slot-chat',
    ...(model ? { model } : {}),
    ...(modelSource ? { modelSource } : {})
  })
}

describe('noteStructuredClaudeRanModel', () => {
  afterEach(() => {
    _internals.reset()
  })

  it('moves a pinned chat to the model a /model turn ran, without the proxy rewriting it', () => {
    chatPane('claude-fable-5-2', 'pinned')
    const notices: ClaudePaneAssignedNotice[] = []
    onClaudePaneAssigned((notice) => notices.push(notice))
    noteStructuredClaudeRanModel(SESSION_ID, 'claude-sonnet-5-5')
    // The renderer's header chip takes its model from this notice.
    expect(notices).toEqual([
      { ptyId: KEY, paneKey: KEY, accountId: 'acct-a', model: 'claude-sonnet-5-5' }
    ])
    noteStructuredClaudeRanModel(SESSION_ID, 'claude-sonnet-5-5')
    expect(notices).toHaveLength(1)
    expect(getClaudePaneAccount(KEY)).toMatchObject({
      model: 'claude-sonnet-5-5',
      modelSource: 'pinned'
    })
    expect(claudeAuthProxySlotModel('slot-chat')).toEqual({
      model: 'claude-sonnet-5-5',
      modelSource: 'pinned'
    })
  })

  it('keeps a policy model and leaves a chat with no recorded model open to takeover', () => {
    chatPane('opus', 'policy')
    noteStructuredClaudeRanModel(SESSION_ID, 'claude-sonnet-5-5')
    expect(getClaudePaneAccount(KEY)).toMatchObject({ model: 'opus', modelSource: 'policy' })

    _internals.reset()
    chatPane()
    noteStructuredClaudeRanModel(SESSION_ID, 'claude-sonnet-5-5')
    expect(getClaudePaneAccount(KEY)).not.toHaveProperty('model')
  })
})
