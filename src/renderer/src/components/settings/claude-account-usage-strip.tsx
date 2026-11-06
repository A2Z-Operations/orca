import { formatClaudeRelativeAge } from '../../../../shared/claude-relative-age'
import type { ClaudeRateLimitAccountsState } from '../../../../shared/managed-account-types'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import {
  claudeAccountUsageState,
  type ClaudeAccountUsageState,
  type ClaudeUsageRow
} from './claude-account-usage-state'
import { useHalfMinuteClock } from './use-half-minute-clock'

const STATE_WORDS: Record<ClaudeAccountUsageState, [string, string]> = {
  ok: ['accounts.claude.usageStrip.state.ok', 'ok'],
  'near-line': ['accounts.claude.usageStrip.state.nearLine', 'near line'],
  'at-line': ['accounts.claude.usageStrip.state.atLine', 'at line'],
  'sign-in': ['accounts.claude.usageStrip.state.signIn', 'sign-in needed'],
  refreshing: ['accounts.claude.usageStrip.state.refreshing', 'refreshing'],
  unreadable: ['accounts.claude.usageStrip.state.unreadable', 'unreadable']
}

const STATE_TONE: Record<ClaudeAccountUsageState, string> = {
  ok: 'text-muted-foreground',
  'near-line': 'text-status-warning',
  'at-line': 'text-destructive',
  'sign-in': 'text-destructive',
  refreshing: 'text-muted-foreground',
  unreadable: 'text-status-warning'
}

function Bar({ label, value }: { label: string; value: number | null | undefined }) {
  const percent = typeof value === 'number' ? Math.max(0, Math.min(100, Math.round(value))) : null
  return (
    <span className="flex items-center gap-1" title={`${label} ${percent ?? '-'}%`}>
      <span className="w-9 text-[10px] text-muted-foreground">{label}</span>
      <span className="relative h-1.5 w-14 overflow-hidden rounded-full bg-primary/15">
        <span
          className="absolute inset-y-0 left-0 rounded-full bg-primary/70"
          style={{ width: `${percent ?? 0}%` }}
        />
      </span>
      <span className="w-8 text-right font-mono text-[10px]">
        {percent === null ? '–' : `${percent}%`}
      </span>
    </span>
  )
}

/** One row per managed account; clicking a row filters the recent-moves table to it. */
export function ClaudeAccountUsageStrip({
  accounts,
  selectedAccountId,
  onSelectAccount
}: {
  accounts: ClaudeRateLimitAccountsState
  selectedAccountId: string | null
  onSelectAccount: (accountId: string | null) => void
}): React.JSX.Element | null {
  const now = useHalfMinuteClock()
  if (accounts.accounts.length === 0) {
    return null
  }
  const rows = new Map<string, ClaudeUsageRow>(
    (accounts.usageWindows ?? []).map((row) => [row.accountId, row])
  )
  return (
    <div className="space-y-1" data-testid="claude-account-usage-strip">
      <p className="text-xs font-medium">
        {translate('accounts.claude.usageStrip.title', 'Accounts')}
      </p>
      <ul className="divide-y divide-border/50 rounded-md border border-border/60">
        {accounts.accounts.map((account) => {
          const row = rows.get(account.id)
          const state = claudeAccountUsageState(account, row)
          const selected = selectedAccountId === account.id
          const [key, fallback] = STATE_WORDS[state]
          return (
            <li key={account.id}>
              <button
                type="button"
                aria-pressed={selected}
                onClick={() => onSelectAccount(selected ? null : account.id)}
                className={cn(
                  'flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-2 py-1 text-left text-xs hover:bg-accent/60',
                  selected && 'bg-accent'
                )}
              >
                <span className="min-w-0 flex-1 truncate" title={account.email}>
                  {account.email}
                </span>
                <Bar
                  label={translate('accounts.claude.usageStrip.window.session', '5h')}
                  value={row?.session}
                />
                <Bar
                  label={translate('accounts.claude.usageStrip.window.weekly', 'week')}
                  value={row?.weekly}
                />
                {typeof row?.fable === 'number' ? (
                  <Bar
                    label={translate('accounts.claude.usageStrip.window.fable', 'fable')}
                    value={row.fable}
                  />
                ) : null}
                <span className="w-24 text-[10px] text-muted-foreground">
                  {row?.readAt ? formatClaudeRelativeAge(Math.min(row.readAt, now), now) : '–'}
                </span>
                <span className={cn('w-24 text-[10px] font-medium', STATE_TONE[state])}>
                  {translate(key, fallback)}
                  {state === 'unreadable' && row?.unavailable ? ` (${row.unavailable})` : ''}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
