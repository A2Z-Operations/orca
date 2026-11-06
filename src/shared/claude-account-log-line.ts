import type { ClaudeAccountLogEntry } from './claude-account-log-types'

/** One row of `orca account moves --log`. Oldest first, the order the log holds. */
export function formatClaudeAccountLogLine(entry: ClaudeAccountLogEntry): string {
  const at = new Date(entry.at).toISOString()
  switch (entry.type) {
    case 'decision': {
      const pane = entry.paneKey ?? entry.ptyId
      const detail = entry.detail ? `  (${entry.detail})` : ''
      return `${at}  ${pane}  ${entry.fromAccountId} → ${entry.toAccountId ?? '-'}  ${entry.reason}  ${entry.strategy ?? '-'}${detail}`
    }
    case 'flip':
      return `${at}  ${entry.paneKey ?? entry.ptyId}  ${entry.modelFrom} → ${entry.modelTo}  ${entry.reason}  ${entry.strategy ?? '-'}  model`
    case 'proxy-unknown-slot':
      return `${at}  proxy  unknown slot  ${entry.method} ${entry.path}  ×${entry.count}`
    case 'proxy-error':
      return `${at}  proxy  ${entry.status}  ${entry.method} ${entry.path}  ${entry.accountId ?? '-'}  ×${entry.count}`
  }
}
