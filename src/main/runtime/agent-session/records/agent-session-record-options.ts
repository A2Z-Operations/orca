import { agentSessionRefusalError } from '../../../../shared/agent-session/failures/agent-session-wire-refusals'
import type { AgentSessionOptionsReplacement } from '../../../../shared/agent-session/options/agent-session-options-replacement'
import type { AgentSessionRecord } from '../../../../shared/agent-session/lifecycle/agent-session-record'
import type { AgentSessionModelOption } from '../../../../shared/agent-session/agent-session-wire'

function writesOptions(record: AgentSessionRecord, fence: number): boolean {
  const { lease } = record
  // At rest the host is the only writer: a pick is intent the next start replays.
  const atRest = lease.claimStatus === 'released' && lease.ownerProcess === null
  return lease.runtimeFence === fence && (lease.claimStatus === 'live' || atRest)
}

function withoutCurrentModel(record: AgentSessionRecord): AgentSessionRecord {
  const { currentModel: _currentModel, ...rest } = record
  return rest
}

export function replaceAgentSessionRecordOptions(
  record: AgentSessionRecord,
  replacement: AgentSessionOptionsReplacement
): AgentSessionRecord {
  if (!writesOptions(record, replacement.fence)) {
    throw agentSessionRefusalError('agent_session_ownership_unknown', { reason: 'leaseMoved' })
  }
  if (!('options' in replacement)) {
    return { ...record, permissionMode: replacement.permissionMode, updatedAt: replacement.now }
  }
  // A new model choice supersedes what the last turn reported running.
  const base =
    replacement.options.model !== record.options?.model ? withoutCurrentModel(record) : record
  return { ...base, options: { ...replacement.options }, updatedAt: replacement.now }
}

/** Saved catalog only; missing model evidence permits options without starting discovery. */
export type AgentSessionAdmissionModels = readonly AgentSessionModelOption[] | undefined

export type AgentSessionOptionPick = {
  sessionId: string
  fence: number
  key: string
  value: string
  models: AgentSessionAdmissionModels
  now: number
}

export function pickAgentSessionOption(
  record: AgentSessionRecord,
  { key, value, models: _models, ...at }: AgentSessionOptionPick
): AgentSessionRecord {
  return replaceAgentSessionRecordOptions(record, {
    ...at,
    options: { ...record.options, [key]: value }
  })
}

/** Fill only missing options for the still-current model; explicit picks always win. */
export type AgentSessionRanOptions = {
  sessionId: string
  fence: number
  model: string
  options: Readonly<Record<string, string>>
  models: AgentSessionAdmissionModels
  now: number
}

export function recordAgentSessionRanOptions(
  record: AgentSessionRecord,
  { model, options, models: _models, ...at }: AgentSessionRanOptions
): AgentSessionRecord {
  const saved = record.options ?? {}
  // The saved choice stays the intent a restart replays; the record notes the model that ran.
  // A stale owner's report is dropped, like the options it cannot add.
  const notes = writesOptions(record, at.fence)
  if (saved.model !== undefined && saved.model !== model) {
    return notes && record.currentModel !== model
      ? { ...record, currentModel: model, updatedAt: at.now }
      : record
  }
  const ran =
    notes && record.currentModel !== undefined
      ? { ...withoutCurrentModel(record), updatedAt: at.now }
      : record
  const added = Object.entries({ ...options, model }).filter(
    ([key]) => key !== 'interactionMode' && saved[key] === undefined
  )
  return added.length === 0
    ? ran
    : replaceAgentSessionRecordOptions(ran, {
        ...at,
        options: { ...Object.fromEntries(added), ...saved }
      })
}
