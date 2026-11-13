import type { AgentSessionRecord } from '../../shared/agent-session/lifecycle/agent-session-record'
import { agentSessionManagedAccountId } from '../../shared/agent-session/lifecycle/agent-session-account-id'
import type {
  ClaudeSessionMoveSummary,
  ClaudeStructuredSessionSnapshot
} from '../../shared/managed-account-types'
import { structuredClaudeSessionKey } from '../claude/claude-structured-session-key'
import { claudeAccountShortLabel } from './claude-account-short-label'

export type ClaudeListedStructuredRecord = Pick<
  AgentSessionRecord,
  | 'sessionId'
  | 'provider'
  | 'accountHome'
  | 'accountId'
  | 'options'
  | 'currentModel'
  | 'location'
  | 'lastTurn'
  | 'updatedAt'
>

/** Null while the chat store is not open: the host cannot say which chats exist. */
type ClaudeStructuredRecordsReader = () => readonly ClaudeListedStructuredRecord[] | null

let readStructuredRecords: ClaudeStructuredRecordsReader | null = null

/** The chat host installs this, so the account list does not import the session store. */
export function setClaudeStructuredRecordsReader(
  reader: ClaudeStructuredRecordsReader | null
): void {
  readStructuredRecords = reader
}

/**
 * The list's moves and saved chats. Like `paneAccounts`, an open store with no chats lists `[]`;
 * without a reader or before the store opens the field is absent, since nothing is known yet.
 */
export function claudeListedChatSessions(
  accounts: readonly { id: string; email: string }[],
  moves: readonly ClaudeSessionMoveSummary[]
): {
  sessionMoves: ClaudeSessionMoveSummary[]
  structuredSessions?: ClaudeStructuredSessionSnapshot[]
} {
  const records = readStructuredRecords?.() ?? null
  if (!records) {
    return { sessionMoves: [...moves] }
  }
  return claudeListedStructuredSessions(accounts, records, moves)
}

/** Native Claude chats with the account their home names, and the moves annotated with the chat. */
export function claudeListedStructuredSessions(
  accounts: readonly { id: string; email: string }[],
  records: readonly ClaudeListedStructuredRecord[],
  moves: readonly ClaudeSessionMoveSummary[]
): {
  structuredSessions: ClaudeStructuredSessionSnapshot[]
  sessionMoves: ClaudeSessionMoveSummary[]
} {
  const emails = accounts.map((account) => account.email)
  const movesByKey = new Map<string, ClaudeSessionMoveSummary>()
  for (const move of moves) {
    if (!movesByKey.has(move.ptyId)) {
      movesByKey.set(move.ptyId, move)
    }
  }
  const sessionIdByKey = new Map<string, string>()
  const structuredSessions: ClaudeStructuredSessionSnapshot[] = []
  for (const record of records) {
    if (record.provider !== 'claude') {
      continue
    }
    const paneKey = structuredClaudeSessionKey(record.sessionId)
    sessionIdByKey.set(paneKey, record.sessionId)
    const accountId =
      record.accountId ?? agentSessionManagedAccountId(record.provider, record.accountHome) ?? null
    const account = accountId ? accounts.find((candidate) => candidate.id === accountId) : null
    const model = record.currentModel ?? record.options?.model
    const move = movesByKey.get(paneKey)
    structuredSessions.push({
      sessionId: record.sessionId,
      paneKey,
      account: account ? 'managed' : accountId ? 'unknown' : 'system',
      accountId,
      ...(account
        ? { email: account.email, label: claudeAccountShortLabel(account.email, emails) }
        : {}),
      ...(model ? { model } : {}),
      workspaceId: record.location.workspaceId,
      lastActivityAt: Math.max(record.lastTurn?.at ?? 0, record.updatedAt),
      ...(move
        ? {
            lastMove: {
              reason: move.reason,
              toAccountId: move.toAccountId,
              at: move.at,
              ...(move.detail ? { detail: move.detail } : {})
            }
          }
        : {})
    })
  }
  structuredSessions.sort((left, right) => right.lastActivityAt - left.lastActivityAt)
  return {
    structuredSessions,
    sessionMoves: moves.map((move) => {
      const sessionId = move.chat ? sessionIdByKey.get(move.ptyId) : undefined
      return sessionId ? { ...move, sessionId } : move
    })
  }
}
