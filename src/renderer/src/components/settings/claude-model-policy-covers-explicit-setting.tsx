import type { GlobalSettings } from '../../../../shared/global-settings-types'
import type { ClaudeModelPolicyEvaluation } from '../../../../shared/managed-account-types'
import { claudeFixedModelSessionCount } from '../../../../shared/claude-model-policy-view'
import { translate } from '@/i18n/i18n'
import { Label } from '../ui/label'
import { Switch } from '../ui/switch'
import { SearchableSetting } from './SearchableSetting'

/** Off by default: a session launched with its own model keeps it. */
export function ClaudeModelPolicyCoversExplicitSetting({
  settings,
  updateSettings,
  evaluations
}: {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
  evaluations: readonly ClaudeModelPolicyEvaluation[] | undefined
}): React.JSX.Element | null {
  if (settings.claudeModelPolicy?.enabled === false) {
    return null
  }
  const fixed = claudeFixedModelSessionCount(evaluations)
  const title = translate(
    'accounts.claude.modelPolicy.coversExplicitTitle',
    'Also switch sessions launched with a fixed model'
  )
  const description = translate(
    'accounts.claude.modelPolicy.coversExplicitDescription',
    'A session started with --model or ANTHROPIC_MODEL set to Fable or Opus follows the same lines. Other models are never switched.'
  )
  return (
    <SearchableSetting
      title={title}
      description={description}
      keywords={['claude', 'fable', 'opus', 'model', 'policy', 'explicit', 'fixed']}
      className="flex items-center justify-between gap-4 py-2 pl-4"
    >
      <div className="min-w-0 flex-1 space-y-0.5">
        <Label>{title}</Label>
        <p className="text-xs text-muted-foreground">{description}</p>
        {fixed > 0 ? (
          <p data-testid="claude-fixed-model-sessions" className="text-xs text-muted-foreground">
            {translate(
              'accounts.claude.modelPolicy.fixedModelSessions',
              '{{count}} live sessions were launched with a fixed model.',
              { count: fixed }
            )}
          </p>
        ) : null}
      </div>
      <Switch
        aria-label={title}
        checked={settings.claudeModelPolicyCoversExplicit === true}
        onCheckedChange={(covers) => updateSettings({ claudeModelPolicyCoversExplicit: covers })}
      />
    </SearchableSetting>
  )
}
