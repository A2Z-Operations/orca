import type { ClaudeSessionMoveSummary } from './managed-account-types'

/** One row of `orca account moves`. Callers that want newest first sort before this. */
export function formatClaudeSessionMoveLine(move: ClaudeSessionMoveSummary): string {
  const pane = move.sessionId ?? move.paneKey ?? move.ptyId
  if (move.kind === 'model') {
    return `${new Date(move.at).toISOString()}  ${pane}  ${move.modelFrom ?? '-'} → ${move.modelTo ?? '-'}  ${move.reason}  ${move.strategy ?? '-'}  model`
  }
  const to = move.toAccountId ?? '-'
  const strategy = move.strategy ?? '-'
  const chat = move.chat ? '  chat' : ''
  // A move's detail is the new pane id; a skip or failure's says why.
  const reason =
    move.detail && (move.reason === 'skipped' || move.reason === 'failed')
      ? `${move.reason} (${move.detail})`
      : move.reason
  return `${new Date(move.at).toISOString()}  ${pane}  ${move.fromAccountId} → ${to}  ${reason}  ${strategy}${chat}`
}

/** The text `orca account moves` prints for a non-empty list. */
export function formatClaudeSessionMoveList(moves: readonly ClaudeSessionMoveSummary[]): string {
  return moves.map((move) => formatClaudeSessionMoveLine(move)).join('\n')
}
