import { useEffect, useState } from 'react'
import { claudeAuthProxyEnabled } from '../../../../shared/claude-account-switch-settings'
import { claudeAuthProxyHealthView } from '../../../../shared/claude-auth-proxy-health'
import { formatClaudeRelativeAge } from '../../../../shared/claude-relative-age'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import type { ClaudeAuthProxyHealth } from '../../../../shared/managed-account-types'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { Label } from '../ui/label'
import { Switch } from '../ui/switch'
import { SearchableSetting } from './SearchableSetting'

/** Wall clock for "9 minutes ago", refreshed every 30 s while the row is mounted. */
function useHalfMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])
  return now
}

function ClaudeAuthProxyHealthLine({
  health,
  now
}: {
  health: ClaudeAuthProxyHealth
  now: number
}): React.JSX.Element {
  const view = claudeAuthProxyHealthView(health, now)
  const unknown = translate(
    'accounts.claude.authProxy.healthUnknownSlots',
    'Requests from unknown slots: {{count}}',
    { count: view.unknownSlotRequests }
  )
  const error = view.lastError
    ? translate(
        'accounts.claude.authProxy.healthLastError',
        'Last upstream error: {{status}} {{method}} {{path}}, {{age}}',
        {
          status: view.lastError.status,
          method: view.lastError.method,
          path: view.lastError.path,
          age: formatClaudeRelativeAge(Math.min(view.lastError.at, now), now)
        }
      )
    : translate('accounts.claude.authProxy.healthNoError', 'No upstream errors')
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
  const clock = useHalfMinuteClock()
  const title = translate(
    'accounts.claude.authProxy.settingTitle',
    'Bill Claude through a local auth proxy'
  )
  const description = translate(
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
