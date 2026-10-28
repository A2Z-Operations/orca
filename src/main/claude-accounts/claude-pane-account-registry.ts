import { claudeAccountHomeKey } from './claude-account-home-attribution'
import { normalizeClaudeConfigDir } from '../rate-limits/service/service-types'

/**
 * Which managed Claude account each live PTY runs on.
 *
 * Why: `CLAUDE_CONFIG_DIR` is baked into a PTY's environment at spawn, so the account a session runs
 * on is fixed for its life; the session mover needs that account to read the right usage and to
 * know where a resume must NOT land. Kept in memory: a PTY that outlives the app is re-learned from
 * the hook server's transcript path (`inferClaudeAccountIdFromTranscript`).
 */

export type ClaudePaneAccountSource = 'spawn' | 'transcript'

export type ClaudePaneAccountRecord = {
  ptyId: string
  paneKey: string | null
  /**
   * The managed account whose quota this pane consumes. A System-default pane records the account
   * covered by System default, because that login IS the account's.
   */
  accountId: string
  /** The folder the session runs in; null when it was not known. */
  configDir: string | null
  launchedAt: number
  /**
   * The folder was chosen by the launch itself (claude-pick, a shell's own CLAUDE_CONFIG_DIR), not
   * by Orca's routing. Such a session is moved only once its account is AT the line.
   */
  pinned: boolean
  source: ClaudePaneAccountSource
}

const records = new Map<string, ClaudePaneAccountRecord>()

export function recordClaudePaneAccount(record: ClaudePaneAccountRecord): void {
  records.set(record.ptyId, record)
}

export function forgetClaudePaneAccount(ptyId: string): void {
  records.delete(ptyId)
}

export function getClaudePaneAccount(ptyId: string): ClaudePaneAccountRecord | null {
  return records.get(ptyId) ?? null
}

export function listClaudePaneAccounts(): ClaudePaneAccountRecord[] {
  return [...records.values()]
}

export function listClaudePaneAccountsByAccount(accountId: string): ClaudePaneAccountRecord[] {
  return listClaudePaneAccounts().filter((record) => record.accountId === accountId)
}

export type ClaudeAccountHomes = { id: string; homes: readonly (string | null | undefined)[] }

/**
 * The account whose folder holds the transcript (`<CLAUDE_CONFIG_DIR>/projects/<project>/<file>`).
 * STRICTER than the renderer's resolveClaudeSessionAccountId on purpose: it requires `<project>/<file>`
 * after `/projects/`, so a path that merely contains a `projects` folder is not read as a transcript.
 * Do not "fix" either side to match the other. Null: a folder no managed account owns (System
 * default). Undefined: no transcript, so the caller cannot know.
 */
export function inferClaudeAccountIdFromTranscript(
  transcriptPath: string | undefined,
  accounts: readonly ClaudeAccountHomes[]
): { accountId: string; configDir: string } | null | undefined {
  const transcript = normalizeClaudeConfigDir(transcriptPath) ?? ''
  const projectsIndex = transcript.lastIndexOf('/projects/')
  // Why: Claude writes `<CLAUDE_CONFIG_DIR>/projects/<project>/<session>.jsonl`; a path without the
  // project folder is not a transcript, so its account cannot be read from it.
  if (projectsIndex <= 0 || !transcript.slice(projectsIndex + '/projects/'.length).includes('/')) {
    return undefined
  }
  // Why: report the folder as Claude wrote it; only the comparison ignores Windows case.
  const configDir = transcript.slice(0, projectsIndex)
  const comparableConfigDir = claudeAccountHomeKey(configDir)
  for (const account of accounts) {
    if (account.homes.some((home) => claudeAccountHomeKey(home) === comparableConfigDir)) {
      return { accountId: account.id, configDir }
    }
  }
  return null
}

export const _internals = {
  reset: (): void => {
    records.clear()
  }
}
