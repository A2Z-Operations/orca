import { translate } from '@/i18n/i18n'
import { setClaudeAutoSwitch } from '@/runtime/runtime-provider-accounts-client'
import { Label } from '../ui/label'
import { Switch } from '../ui/switch'
import { SearchableSetting } from './SearchableSetting'
import type { AccountsPaneSectionModel } from './accounts-pane-types'

export function renderClaudeAutoSwitchSetting(
  model: AccountsPaneSectionModel
): React.JSX.Element | null {
  const { accountOwner, claudeAccounts, claudeAction, runClaudeAccountAction } = model
  // Why the accounts' host: it runs the switch and keeps the setting, so a remote server's
  // accounts follow the server's own; an older host reports no setting and cannot change it.
  if (claudeAccounts.autoSwitchEnabled === undefined || model.visibleClaudeAccounts.length < 2) {
    return null
  }
  return (
    <SearchableSetting
      title={translate('accounts.claude.autoSwitch', 'Switch accounts before a usage limit')}
      description={translate(
        'accounts.claude.autoSwitchDescription',
        'When the selected account passes 90% of its 5-hour or weekly limit, new Claude sessions start on the account with the most room left. Running sessions keep their account.'
      )}
      keywords={['claude', 'account', 'auto', 'switch', 'rate limit', 'quota', 'usage']}
      className="flex items-center justify-between gap-4 py-2"
    >
      <div className="space-y-0.5">
        <Label>
          {translate('accounts.claude.autoSwitch', 'Switch accounts before a usage limit')}
        </Label>
        <p className="text-xs text-muted-foreground">
          {translate(
            'accounts.claude.autoSwitchDescription',
            'When the selected account passes 90% of its 5-hour or weekly limit, new Claude sessions start on the account with the most room left. Running sessions keep their account.'
          )}
        </p>
      </div>
      <Switch
        aria-label={translate('accounts.claude.autoSwitch', 'Switch accounts before a usage limit')}
        checked={claudeAccounts.autoSwitchEnabled}
        disabled={claudeAction !== 'idle'}
        onCheckedChange={(enabled) =>
          void runClaudeAccountAction('auto-switch', () =>
            setClaudeAutoSwitch(accountOwner, enabled)
          )
        }
      />
    </SearchableSetting>
  )
}
