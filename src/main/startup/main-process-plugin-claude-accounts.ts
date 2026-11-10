import { bindPluginClaudeAccountEvents } from '../plugins/plugin-claude-account-events'
import { projectPluginClaudeAccounts } from '../plugins/plugin-claude-account-projection'
import { listClaudePaneAccounts } from '../claude-accounts/claude-pane-account-registry'
import { normalizeClaudeRuntimeSelection } from '../claude-accounts/runtime-selection'
import type { PluginClaudeAccountView } from '../../shared/plugins/workers/plugin-claude-account-contract'
import { mainProcessState as state } from './main-process-state'

function readDesktopPluginClaudeAccounts(): PluginClaudeAccountView[] {
  try {
    const settings = state.store?.getSettings()
    const rateLimits = state.rateLimits?.getState()
    if (!settings || !rateLimits) {
      return []
    }
    return projectPluginClaudeAccounts({
      accounts: settings.claudeManagedAccounts,
      activeAccountId: normalizeClaudeRuntimeSelection(settings).host,
      rateLimits,
      panes: listClaudePaneAccounts()
    })
  } catch {
    return []
  }
}

/** Fork: plugins holding `accounts.read` hear the desktop's Claude account view and its usage changes. */
export function bindDesktopPluginClaudeAccountEvents(): void {
  bindPluginClaudeAccountEvents({
    emit: (event, payload) => {
      state.pluginService?.emitEvent(event, payload)
    },
    readAccounts: readDesktopPluginClaudeAccounts,
    subscribeRateLimits: (listener) =>
      state.rateLimits?.onStateChange(() => listener()) ?? (() => undefined)
  })
}
