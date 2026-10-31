import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { translate } from '@/i18n/i18n'
import { Label } from '../ui/label'
import { Switch } from '../ui/switch'
import { SearchableSetting } from './SearchableSetting'

export function ClaudeModelPolicySetting({
  settings,
  updateSettings
}: {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}): React.JSX.Element {
  const fable = settings.claudeModelPolicy?.fableLine ?? 90
  const weekly = settings.claudeModelPolicy?.weeklyGuard ?? 91
  const title = translate('accounts.claude.modelPolicy.settingTitle', 'Spend Fable first')
  const description = translate(
    'accounts.claude.modelPolicy.settingDescription',
    'Run Fable while its window is under {{fable}}% and the weekly window is under {{weekly}}%. Otherwise run Opus 5.5. A running session switches without a restart.',
    { fable, weekly }
  )
  return (
    <SearchableSetting
      title={title}
      description={description}
      keywords={['claude', 'fable', 'opus', 'model', 'policy']}
      className="flex items-center justify-between gap-4 py-2"
    >
      <div className="min-w-0 flex-1 space-y-0.5">
        <Label>{title}</Label>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch
        aria-label={title}
        checked={settings.claudeModelPolicy?.enabled !== false}
        onCheckedChange={(enabled) =>
          updateSettings({
            claudeModelPolicy: {
              enabled,
              fableLine: fable,
              weeklyGuard: weekly
            }
          })
        }
      />
    </SearchableSetting>
  )
}
