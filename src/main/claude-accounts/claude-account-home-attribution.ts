import { normalizeClaudeConfigDir } from '../rate-limits/service/service-types'

/** Both live posts and transcripts use the execution host's path comparison rules. */
export function claudeAccountHomeKey(path: string | null | undefined): string | null {
  const normalized = normalizeClaudeConfigDir(path)
  return normalized && process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

export function resolveClaudeAccountHome(
  configDir: string,
  accounts: readonly { id: string }[],
  accountHome: (id: string) => string
): string | null {
  const key = claudeAccountHomeKey(configDir)
  if (!key) {
    return null
  }
  for (const account of accounts) {
    try {
      if (claudeAccountHomeKey(accountHome(account.id)) === key) {
        return account.id
      }
    } catch {
      // A malformed account id must not dark the live feed.
      continue
    }
  }
  return null
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
