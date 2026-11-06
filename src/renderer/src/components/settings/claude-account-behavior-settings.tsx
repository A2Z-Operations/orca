import type { GlobalSettings } from '../../../../shared/global-settings-types'
import type { ClaudeRateLimitAccountsState } from '../../../../shared/managed-account-types'
import { ClaudeRunningSessionSwitchSetting } from './claude-running-session-switch-setting'
import { ClaudeAccountPoolSetting } from './claude-account-pool-setting'
import { ClaudeModelPolicySetting } from './claude-model-policy-setting'
import { ClaudeModelPolicyCoversExplicitSetting } from './claude-model-policy-covers-explicit-setting'
import { ClaudeAuthProxySetting } from './claude-auth-proxy-setting'
import { ClaudeSessionMoverSetting } from './claude-session-mover-setting'
import { ClaudeRecentMoves } from './claude-recent-moves'

/**
 * The rows that govern running sessions, then what the mover did. Host settings are hidden while a
 * remote account scope is shown; the recent-moves list belongs to whichever runtime is listed.
 */
export function ClaudeAccountBehaviorSettings({
  settings,
  updateSettings,
  accounts,
  showHostSettings
}: {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
  accounts: ClaudeRateLimitAccountsState
  showHostSettings: boolean
}): React.JSX.Element {
  return (
    <>
      {showHostSettings ? (
        <>
          <ClaudeRunningSessionSwitchSetting settings={settings} updateSettings={updateSettings} />
          <ClaudeSessionMoverSetting settings={settings} updateSettings={updateSettings} />
          <ClaudeAccountPoolSetting settings={settings} updateSettings={updateSettings} />
          <ClaudeModelPolicySetting settings={settings} updateSettings={updateSettings} />
          <ClaudeModelPolicyCoversExplicitSetting
            settings={settings}
            updateSettings={updateSettings}
            evaluations={accounts.modelPolicyEvaluations}
          />
          <ClaudeAuthProxySetting
            settings={settings}
            updateSettings={updateSettings}
            health={accounts.authProxyHealth}
          />
        </>
      ) : null}
      <ClaudeRecentMoves moves={accounts.sessionMoves} />
    </>
  )
}
