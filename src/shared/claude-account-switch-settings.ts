/** What a Claude account switch does to Claude sessions still on the old account. */
export type ClaudeAccountSwitchRunningSessions = 'ask' | 'restart' | 'keep'

/** What the host does with a running Claude session whose own account nears a usage limit. */
export type ClaudeSessionMoverSetting = 'off' | 'ask' | 'move'

/** Absent means off. When on, Orca-made Claude launches pick the account with the most headroom. */
export type ClaudeAccountPoolSetting = 'off' | 'on'

/** Absent means on. An explicit false leaves the auth proxy off. */
export function claudeAuthProxyEnabled(
  settings: { claudeAuthProxy?: boolean } | null | undefined
): boolean {
  return settings?.claudeAuthProxy !== false
}

export type ClaudeAccountSwitchSettings = {
  /** Absent means 'ask'. */
  claudeAccountSwitchRunningSessions?: ClaudeAccountSwitchRunningSessions
  /** Absent means 'ask'; a headless host treats 'ask' as 'move' because nobody can answer there. */
  claudeSessionMover?: ClaudeSessionMoverSetting
  /** Absent means on. Only an explicit false turns the proxy off. */
  claudeAuthProxy?: boolean
  /** Absent means off. The selected account stays what non-pooled launches and the status bar show. */
  claudeAccountPool?: ClaudeAccountPoolSetting
}
