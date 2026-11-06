import { join } from 'node:path'
import type { ClaudeAccountLogEntry } from '../../shared/claude-account-log-types'
import { createLocalFileSink, type LocalFileSink } from '../observability/local-file-sink'
import { getLogsDirectory } from '../observability/logs-directory'

/**
 * The one writer of the durable Claude account log: mover decisions, model flips, and auth-proxy
 * trouble, as ndjson next to the trace files. Live history is per pane and in memory; this file
 * is what a review reads after a restart. Same rotation as the traces, capped at 3 × 10 MB.
 */
export const CLAUDE_ACCOUNT_LOG_FILE = 'account-moves.log'
export const CLAUDE_ACCOUNT_LOG_MAX_BYTES = 10 * 1024 * 1024
export const CLAUDE_ACCOUNT_LOG_MAX_FILES = 3

export function claudeAccountLogPath(): string {
  return join(getLogsDirectory(), CLAUDE_ACCOUNT_LOG_FILE)
}

let sink: LocalFileSink | null = null

/** Opened by the account services. Unopened (tests, WSL guest) means appends are dropped. */
export function openClaudeAccountLog(filePath: string = claudeAccountLogPath()): void {
  if (sink) {
    return
  }
  try {
    sink = createLocalFileSink({
      filePath,
      maxBytes: CLAUDE_ACCOUNT_LOG_MAX_BYTES,
      maxFiles: CLAUDE_ACCOUNT_LOG_MAX_FILES
    })
  } catch (error) {
    // The log is a review aid. A read-only logs folder must not stop the account services.
    console.warn('[claude-account-log] could not open the account log', error)
  }
}

export function appendClaudeAccountLog(entry: ClaudeAccountLogEntry): void {
  sink?.push(entry)
}

export function closeClaudeAccountLog(): void {
  sink?.close()
  sink = null
}

const PROXY_FOLD_WINDOW_MS = 60_000

type ProxyRequest = {
  method: string
  path: string
  status: number
  accountId: string | null
  unknownSlot: boolean
}

/**
 * Unknown-slot requests and upstream errors (status ≥ 400). A dead pane retries every few seconds,
 * so identical rows fold for a minute and the next row carries how many it stands for.
 */
export function createClaudeAuthProxyAccountLogObserver(
  append: (entry: ClaudeAccountLogEntry) => void = appendClaudeAccountLog,
  now: () => number = Date.now
): (request: ProxyRequest) => void {
  const folds = new Map<string, { writtenAt: number; pending: number }>()
  const admit = (key: string, at: number): number | null => {
    const fold = folds.get(key)
    if (fold && at - fold.writtenAt < PROXY_FOLD_WINDOW_MS) {
      fold.pending += 1
      return null
    }
    folds.set(key, { writtenAt: at, pending: 0 })
    return (fold?.pending ?? 0) + 1
  }
  return (request) => {
    const at = now()
    if (request.unknownSlot) {
      const count = admit(`unknown ${request.method} ${request.path}`, at)
      if (count !== null) {
        append({
          type: 'proxy-unknown-slot',
          at,
          method: request.method,
          path: request.path,
          count
        })
      }
    }
    if (request.status >= 400) {
      const key = `error ${request.status} ${request.method} ${request.path} ${request.accountId ?? '-'}`
      const count = admit(key, at)
      if (count !== null) {
        append({
          type: 'proxy-error',
          at,
          method: request.method,
          path: request.path,
          status: request.status,
          accountId: request.accountId,
          count
        })
      }
    }
  }
}
