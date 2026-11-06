import type { ClaudeAccountLogEntry } from '../../../../shared/claude-account-log-types'
import type { ClaudeSessionMoveSummary } from '../../../../shared/managed-account-types'
import { claudeMoveCategory, type ClaudeMoveCategory } from './claude-recent-moves-words'

/** Rows kept from the live list; older history comes from the durable log on request. */
export const CLAUDE_RECENT_MOVES_CAP = 200

export type ClaudeMoveLine =
  | { kind: 'row'; key: string; row: ClaudeSessionMoveSummary }
  | {
      kind: 'group'
      key: string
      rows: ClaudeSessionMoveSummary[]
      reason: string
      fromAccountId: string
      at: number
    }

export type ClaudeMoveFilter = {
  category: 'all' | ClaudeMoveCategory
  /** Rows whose from or to account is this one. */
  accountId: string | null
  query: string
}

export function claudeMoveRowKey(row: ClaudeSessionMoveSummary): string {
  return `${row.kind ?? 'move'}:${row.ptyId}:${row.at}:${row.reason}`
}

/** Mover decisions and model flips from `accounts.claudeAccountLog`; proxy rows are not sessions. */
export function claudeMoveRowsFromLog(
  entries: readonly ClaudeAccountLogEntry[]
): ClaudeSessionMoveSummary[] {
  const rows: ClaudeSessionMoveSummary[] = []
  for (const entry of entries) {
    if (entry.type === 'decision') {
      rows.push({
        ptyId: entry.ptyId,
        paneKey: entry.paneKey,
        fromAccountId: entry.fromAccountId,
        toAccountId: entry.toAccountId,
        window: entry.window ?? null,
        percent: entry.percent ?? null,
        line: null,
        reason: entry.reason,
        at: entry.at,
        ...(entry.strategy ? { strategy: entry.strategy } : {}),
        ...(entry.chat ? { chat: true as const } : {})
      })
    } else if (entry.type === 'flip') {
      rows.push({
        ptyId: entry.ptyId,
        paneKey: entry.paneKey,
        fromAccountId: entry.accountId,
        toAccountId: entry.accountId,
        window: null,
        percent: null,
        line: null,
        reason: entry.reason,
        at: entry.at,
        kind: 'model',
        modelFrom: entry.modelFrom,
        modelTo: entry.modelTo,
        ...(entry.strategy ? { strategy: entry.strategy } : {})
      })
    }
  }
  return rows
}

/** Newest first, one copy of each row: the live list (capped) then what was loaded from the log. */
export function mergeClaudeMoveRows(
  live: readonly ClaudeSessionMoveSummary[],
  loaded: readonly ClaudeSessionMoveSummary[]
): ClaudeSessionMoveSummary[] {
  const seen = new Set<string>()
  const merged: ClaudeSessionMoveSummary[] = []
  for (const row of [...live.slice(0, CLAUDE_RECENT_MOVES_CAP), ...loaded]) {
    const key = claudeMoveRowKey(row)
    if (!seen.has(key)) {
      seen.add(key)
      merged.push(row)
    }
  }
  return merged.sort((left, right) => right.at - left.at)
}

export function filterClaudeMoveRows(
  rows: readonly ClaudeSessionMoveSummary[],
  filter: ClaudeMoveFilter,
  searchText: (row: ClaudeSessionMoveSummary) => string
): ClaudeSessionMoveSummary[] {
  const query = filter.query.trim().toLowerCase()
  return rows.filter(
    (row) =>
      (filter.category === 'all' || claudeMoveCategory(row) === filter.category) &&
      (filter.accountId === null ||
        row.fromAccountId === filter.accountId ||
        row.toAccountId === filter.accountId) &&
      (query === '' || searchText(row).toLowerCase().includes(query))
  )
}

/**
 * One tick of the mover decides every live session at the same instant. Identical stays from that
 * tick (same time, reason, and account) fold into one line the table can expand.
 */
export function groupClaudeMoveRows(rows: readonly ClaudeSessionMoveSummary[]): ClaudeMoveLine[] {
  const lines: ClaudeMoveLine[] = []
  for (const row of rows) {
    const last = lines.at(-1)
    const previous = last?.kind === 'row' ? last.row : last?.kind === 'group' ? last.rows[0] : null
    const sameTick =
      previous !== null &&
      previous !== undefined &&
      claudeMoveCategory(row) === 'stay' &&
      claudeMoveCategory(previous) === 'stay' &&
      previous.at === row.at &&
      previous.reason === row.reason &&
      previous.fromAccountId === row.fromAccountId
    if (sameTick && last?.kind === 'group') {
      last.rows.push(row)
    } else if (sameTick && last?.kind === 'row') {
      lines[lines.length - 1] = {
        kind: 'group',
        key: `group:${claudeMoveRowKey(last.row)}`,
        rows: [last.row, row],
        reason: row.reason,
        fromAccountId: row.fromAccountId,
        at: row.at
      }
    } else {
      lines.push({ kind: 'row', key: claudeMoveRowKey(row), row })
    }
  }
  return lines
}
