import { expect, it } from 'vitest'
import {
  forgetClaudePaneAccount,
  getClaudePaneAccount,
  onClaudePaneAssigned,
  recordClaudePaneAccount,
  type ClaudePaneAssignedNotice
} from '../../../claude-accounts/claude-pane-account-registry'
import { structuredClaudeSessionKey } from '../../../claude/claude-structured-session-key'
import { createQueuedMessageTestRig } from '../host/testing/structured-agent-session-queued-message-rig.test-fixture'
import { eventually } from '../host/testing/structured-agent-session-queued-message-rig-provider.test-fixture'
import { HOST_TEST_THREAD } from '../host/testing/structured-agent-session-host-test-data'

it('carries a native Claude turn’s ran model through the record to the account registry', async () => {
  const sessionId = 'claude_81b8a449_33cc_4832_91c7_336c540e7c8b'
  const key = structuredClaudeSessionKey(sessionId)
  const rig = await createQueuedMessageTestRig({ agent: 'claude', sessionId })
  const notices: ClaudePaneAssignedNotice[] = []
  recordClaudePaneAccount({
    ptyId: key,
    paneKey: key,
    surface: 'chat',
    accountId: 'acct-a',
    configDir: null,
    launchedAt: 0,
    pinned: false,
    source: 'spawn',
    model: 'claude-fable-5-2',
    modelSource: 'pinned'
  })
  const unsubscribe = onClaudePaneAssigned((notice) => notices.push(notice))
  try {
    rig.dispatch.mockResolvedValueOnce({
      state: 'accepted',
      providerIdentity: { provider: 'claude', sessionId: HOST_TEST_THREAD, uuid: 'first-turn' },
      ranOptions: { model: 'claude-fable-5-2', effort: 'high' }
    })
    expect(await rig.send('first turn').result).toMatchObject({ ok: true })
    await eventually(() =>
      expect(rig.store.getRecord(sessionId)?.options).toEqual({
        model: 'claude-fable-5-2',
        effort: 'high'
      })
    )

    rig.dispatch.mockResolvedValueOnce({
      state: 'accepted',
      providerIdentity: { provider: 'claude', sessionId: HOST_TEST_THREAD, uuid: 'second-turn' },
      ranOptions: { model: 'claude-sonnet-5-5', effort: 'low' }
    })
    expect(await rig.send('continue after /model').result).toMatchObject({ ok: true })
    await eventually(() =>
      expect(getClaudePaneAccount(key)).toMatchObject({
        accountId: 'acct-a',
        model: 'claude-sonnet-5-5',
        modelSource: 'pinned'
      })
    )
    expect(rig.store.getRecord(sessionId)).toMatchObject({
      options: { model: 'claude-fable-5-2', effort: 'high' },
      currentModel: 'claude-sonnet-5-5'
    })
    expect(notices).toContainEqual({
      ptyId: key,
      paneKey: key,
      accountId: 'acct-a',
      model: 'claude-sonnet-5-5'
    })
  } finally {
    unsubscribe()
    await rig.dispose()
    forgetClaudePaneAccount(key)
  }
})
