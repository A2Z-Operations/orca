import { readFileSync } from 'node:fs'
import type { ClaudeAccountLogEntry } from '../../shared/claude-account-log-types'
import { listRotatedFiles } from '../observability/local-file-sink'
import { CLAUDE_ACCOUNT_LOG_MAX_FILES, claudeAccountLogPath } from './claude-account-log'

export const CLAUDE_ACCOUNT_LOG_READ_DEFAULT_LIMIT = 500
export const CLAUDE_ACCOUNT_LOG_READ_MAX_LIMIT = 5_000

const TYPES = new Set(['decision', 'flip', 'proxy-unknown-slot', 'proxy-error'])

function isEntry(value: unknown): value is ClaudeAccountLogEntry {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    'at' in value &&
    typeof value.at === 'number' &&
    typeof value.type === 'string' &&
    TYPES.has(value.type)
  )
}

function parseLines(raw: string): ClaudeAccountLogEntry[] {
  const entries: ClaudeAccountLogEntry[] = []
  for (const line of raw.split('\n')) {
    if (!line) {
      continue
    }
    try {
      const parsed: unknown = JSON.parse(line)
      if (isEntry(parsed)) {
        entries.push(parsed)
      }
    } catch {
      // A line cut by a crash mid-write is skipped, not fatal.
    }
  }
  return entries
}

/** Oldest first, at or after `since` and before `before`, the newest `limit` rows across the rotated files. */
export function readClaudeAccountLog(
  options: { since?: number; before?: number; limit?: number; filePath?: string } = {}
): { path: string; entries: ClaudeAccountLogEntry[] } {
  const path = options.filePath ?? claudeAccountLogPath()
  const limit = Math.min(
    Math.max(1, Math.floor(options.limit ?? CLAUDE_ACCOUNT_LOG_READ_DEFAULT_LIMIT)),
    CLAUDE_ACCOUNT_LOG_READ_MAX_LIMIT
  )
  const since = options.since ?? 0
  const before = options.before ?? Number.POSITIVE_INFINITY
  const entries: ClaudeAccountLogEntry[] = []
  for (const file of listRotatedFiles(path, CLAUDE_ACCOUNT_LOG_MAX_FILES)) {
    let raw: string
    try {
      raw = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    entries.push(...parseLines(raw).filter((entry) => entry.at >= since && entry.at < before))
  }
  entries.sort((left, right) => left.at - right.at)
  return { path, entries: entries.slice(-limit) }
}
