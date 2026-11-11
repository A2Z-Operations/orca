import { claudeAuthProxyEnabled } from '../../../../../../shared/claude-account-switch-settings'
import { claudeAuthProxyHealthView } from '../../../../../../shared/claude-auth-proxy-health'
import { formatClaudeRelativeAge } from '../../../../../../shared/claude-relative-age'
import type { GlobalSettings } from '../../../../../../shared/global-settings-types'
import type { ClaudeAuthProxyHealth } from '../../../../../../shared/managed-account-types'
import { useTranslate } from '@/i18n/use-translate'
import { cn } from '@/lib/utils'
import { Label } from '../../../ui/label'
import { Switch } from '../../../ui/switch'
import { SearchableSetting } from '../../section-layout/SearchableSetting'
import { useHalfMinuteClock } from '../../use-half-minute-clock'

function ClaudeAuthProxyHealthLine({
  health,
  now
}: {
  health: ClaudeAuthProxyHealth
  now: number
}): React.JSX.Element {
  const t = useTranslate()
  const view = claudeAuthProxyHealthView(health, now)
  const unknown = t(
    'accounts.claude.authProxy.healthUnknownSlots',
    'Requests from unknown slots after startup: {{count}}',
    { count: view.unknownSlotRequests }
  )
  const error = view.lastError
    ? t(
        'accounts.claude.authProxy.healthLastError',
        'Last upstream error: {{status}} {{method}} {{path}}, {{age}}',
        {
          status: view.lastError.status,
          method: view.lastError.method,
          path: view.lastError.path,
          age: formatClaudeRelativeAge(Math.min(view.lastError.at, now), now)
        }
      )
    : t('accounts.claude.authProxy.healthNoError', 'No upstream errors')
  return (
    <p
      data-testid="claude-auth-proxy-health"
      data-warn={view.warn ? 'true' : 'false'}
      className={cn(
        'text-xs',
        view.warn ? 'font-medium text-status-warning' : 'text-muted-foreground'
      )}
    >
      {`${unknown} · ${error}`}
    </p>
  )
}

export function ClaudeAuthProxySetting({
  settings,
  updateSettings,
  health,
  now
}: {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
  /** Absent from older hosts and while no listener runs. */
  health?: ClaudeAuthProxyHealth
  /** Tests pin the clock. The pane re-renders when the account list refreshes. */
  now?: number
}): React.JSX.Element {
  const t = useTranslate()
  const clock = useHalfMinuteClock()
  const title = t(
    'accounts.claude.authProxy.settingTitle',
    'Bill Claude through a local auth proxy'
  )
  const description = t(
    'accounts.claude.authProxy.settingDescription',
    'A running Claude session can change accounts without restarting. The next request uses the new account.'
  )
  return (
    <SearchableSetting
      title={title}
      description={description}
      keywords={['claude', 'account', 'proxy', 'auth', 'restart', 'session']}
      className="flex items-center justify-between gap-4 py-2"
    >
      <div className="min-w-0 flex-1 space-y-0.5">
        <Label>{title}</Label>
        <p className="text-xs text-muted-foreground">{description}</p>
        {health?.listening ? (
          <ClaudeAuthProxyHealthLine health={health} now={now ?? clock} />
        ) : null}
      </div>
      <Switch
        aria-label={title}
        checked={claudeAuthProxyEnabled(settings)}
        onCheckedChange={(enabled) => updateSettings({ claudeAuthProxy: enabled })}
      />
    </SearchableSetting>
  )
}
