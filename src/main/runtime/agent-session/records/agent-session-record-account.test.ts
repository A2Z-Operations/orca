import { afterEach, describe, expect, it } from 'vitest'
import {
  agentSessionLeaseFixture,
  agentSessionRecordFixture
} from '../../../../shared/agent-session/lifecycle/agent-session-record.test-fixture'
import type { AgentSessionRecord } from '../../../../shared/agent-session/lifecycle/agent-session-record'
import type { PersistedAgentSessionRecord } from '../../../../shared/agent-session/lifecycle/agent-session-legacy-handoff-lease'
import { createRestTestRig } from '../../../native-chat/agent-session-wire/host/testing/structured-agent-session-rest-test-rig'
import { foundAgentSessionRecord } from './agent-session-record-founding'
import {
  pickAgentSessionOption,
  recordAgentSessionRanOptions
} from './agent-session-record-options'
import {
  openTestAgentSessionRecordStore,
  seedTestAgentSessionRecordStore,
  storedTestAgentSessionRecord
} from './agent-session-record-store-test-harness'

const PROFILE_HOME =
  '/Users/me/Library/Application Support/orca/claude-profiles/9c633061-4a24-40ad-ab31-7cebe5ab8e58/home'

function founded(provider: string, path: string): AgentSessionRecord {
  return foundAgentSessionRecord(
    {
      sessionId: 'claude_81b8a449_33cc_4832_91c7_336c540e7c8b',
      location: {
        executionHostId: 'local',
        wslDistro: null,
        workspaceId: 'folder:one',
        workspaceKind: 'folder'
      },
      provider,
      accountHome: { variable: 'CLAUDE_CONFIG_DIR', path }
    },
    { claimKeyId: 'key-1', now: 1_000 }
  )
}

describe('agent session record account', () => {
  const disposers: (() => Promise<void>)[] = []
  afterEach(async () => {
    await Promise.all(disposers.splice(0).map((dispose) => dispose()))
  })

  it('stores the managed account a Claude home names when the record is written', () => {
    expect(founded('claude', PROFILE_HOME).accountId).toBe('9c633061-4a24-40ad-ab31-7cebe5ab8e58')
    expect(
      founded('claude', 'C:\\Users\\me\\AppData\\Roaming\\orca\\claude-profiles\\acct-b\\home')
        .accountId
    ).toBe('acct-b')
    expect(founded('claude', '/Users/me/.claude')).not.toHaveProperty('accountId')
    expect(founded('codex', PROFILE_HOME)).not.toHaveProperty('accountId')
  })

  it('backfills the account of a record written before the field, and drops a damaged one', async () => {
    const rig = await createRestTestRig()
    disposers.push(() => rig.dispose())
    const fixture = agentSessionRecordFixture(
      agentSessionLeaseFixture({ claimStatus: 'released', ownerProcess: null })
    )
    const legacy = {
      ...fixture,
      accountHome: { variable: 'CLAUDE_CONFIG_DIR', path: PROFILE_HOME }
    }
    const damaged: PersistedAgentSessionRecord = {
      ...storedTestAgentSessionRecord(
        agentSessionRecordFixture(
          agentSessionLeaseFixture({
            sessionId: 'session-beta-22',
            claimStatus: 'released',
            ownerProcess: null
          })
        )
      ),
      accountId: 42,
      currentModel: ''
    }
    await seedTestAgentSessionRecordStore(rig.root, { records: [legacy, damaged] })
    const store = await openTestAgentSessionRecordStore(rig.root)
    expect(store.getRecord(legacy.sessionId)?.accountId).toBe(
      '9c633061-4a24-40ad-ab31-7cebe5ab8e58'
    )
    const read = store.getRecord('session-beta-22')
    expect(read).not.toBeNull()
    expect(read).not.toHaveProperty('accountId')
    expect(read).not.toHaveProperty('currentModel')
  })

  it('keeps the model the chat switched to beside the saved choice until the next pick', () => {
    const record: AgentSessionRecord = {
      ...agentSessionRecordFixture(),
      options: { model: 'claude-fable-5-2', effort: 'max' }
    }
    const at = { sessionId: record.sessionId, fence: record.lease.runtimeFence, models: undefined }
    const switched = recordAgentSessionRanOptions(record, {
      ...at,
      model: 'claude-opus-5-5',
      options: { model: 'claude-opus-5-5' },
      now: 5_000
    })
    expect(switched.options?.model).toBe('claude-fable-5-2')
    expect(switched.currentModel).toBe('claude-opus-5-5')
    expect(switched.updatedAt).toBe(5_000)

    const back = recordAgentSessionRanOptions(switched, {
      ...at,
      model: 'claude-fable-5-2',
      options: { model: 'claude-fable-5-2' },
      now: 6_000
    })
    expect(back).not.toHaveProperty('currentModel')

    const picked = pickAgentSessionOption(switched, {
      ...at,
      key: 'model',
      value: 'claude-sonnet-5-5',
      now: 7_000
    })
    expect(picked.options?.model).toBe('claude-sonnet-5-5')
    expect(picked).not.toHaveProperty('currentModel')
  })

  it('ignores a stale owner reporting a different model', () => {
    const record: AgentSessionRecord = {
      ...agentSessionRecordFixture(),
      options: { model: 'claude-fable-5-2' }
    }
    const stale = recordAgentSessionRanOptions(record, {
      sessionId: record.sessionId,
      fence: record.lease.runtimeFence - 1,
      models: undefined,
      model: 'claude-opus-5-5',
      options: { model: 'claude-opus-5-5' },
      now: 5_000
    })
    expect(stale).toBe(record)
  })
})
