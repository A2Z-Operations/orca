export type ClaudeAccountSwitchRunningSessions = 'ask' | 'restart' | 'keep'

/** What the host does with a running Claude session whose own account nears a usage limit. */
export type ClaudeSessionMoverSetting = 'off' | 'ask' | 'move'

/** Absent or any value other than true leaves the auth proxy off. */
export function claudeAuthProxyEnabled(
  settings: { claudeAuthProxy?: boolean } | null | undefined
): boolean {
  return settings?.claudeAuthProxy === true
}

export type ClaudeAccountSwitchSettings = {
  /** Absent means 'ask'. */
  claudeAccountSwitchRunningSessions?: ClaudeAccountSwitchRunningSessions
  /** Absent means 'ask'. A headless host treats 'ask' as 'move'. */
  claudeSessionMover?: ClaudeSessionMoverSetting
  /** Absent means off. Only an explicit true turns the proxy on. */
  claudeAuthProxy?: boolean
}
