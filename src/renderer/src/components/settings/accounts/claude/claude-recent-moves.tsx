import { useCallback, useMemo, useState } from 'react'
import type { ClaudeAccountLogEntry } from '../../../../../../shared/claude-account-log-types'
import type {
  ClaudeRateLimitAccountsState,
  ClaudeSessionMoveSummary
} from '../../../../../../shared/managed-account-types'
import type { RuntimeClientTarget } from '../../../../../../shared/runtime-client-target'
import { useTranslate } from '@/i18n/use-translate'
import { callRuntimeRpc } from '@/runtime/rpc/calls/runtime-rpc-call'
import { cn } from '@/lib/utils'
import { translateSearchKeyword } from '../../search/settings-search-keywords'
import { Button } from '../../../ui/button'
import { Input } from '../../../ui/input'
import { Label } from '../../../ui/label'
import { SearchableSetting } from '../../section-layout/SearchableSetting'
import { ClaudeAccountUsageStrip } from './claude-account-usage-strip'
import { ClaudeRecentMovesTable, type ClaudeMoveTableContext } from './claude-recent-moves-table'
import {
  CLAUDE_RECENT_MOVES_CAP,
  claudeMoveRowsFromLog,
  filterClaudeMoveRows,
  groupClaudeMoveRows,
  mergeClaudeMoveRows,
  type ClaudeMoveFilter
} from './claude-recent-moves-rows'
import { claudeMoveSessionName, useClaudeMoveTabNames } from './claude-recent-moves-session-name'
import { useHalfMinuteClock } from '../../use-half-minute-clock'

const CHIPS: readonly [ClaudeMoveFilter['category'], string, string][] = [
  ['all', 'accounts.claude.recentMoves.filterAll', 'All'],
  ['move', 'accounts.claude.recentMoves.filterMoves', 'Moves'],
  ['flip', 'accounts.claude.recentMoves.filterFlips', 'Flips'],
  ['stay', 'accounts.claude.recentMoves.filterStays', 'Stays']
]

/** Older hosts omit `sessionMoves`. An empty array is a host that has the list and nothing on it. */
/** The page before `oldest`, or null when the host could not answer. Module-level: the compiler cannot lower try/finally in a component. */
async function readOlderClaudeMoves(
  owner: RuntimeClientTarget,
  oldest: number | undefined
): Promise<ClaudeSessionMoveSummary[] | null> {
  try {
    // Why +1: the host reads strictly before this stamp. Rows that share the oldest row's
    // millisecond past the page limit would never come back; the merge drops the repeats.
    const before = oldest === undefined ? Date.now() : oldest + 1
    const result = await callRuntimeRpc<{ entries: ClaudeAccountLogEntry[] }>(
      owner,
      'accounts.claudeAccountLog',
      { before, limit: CLAUDE_RECENT_MOVES_CAP }
    )
    return claudeMoveRowsFromLog(result.entries)
  } catch {
    return null
  }
}

export function ClaudeRecentMoves({
  accounts,
  owner
}: {
  accounts: ClaudeRateLimitAccountsState
  /** The runtime whose durable log "Load older" reads. */
  owner: RuntimeClientTarget
}): React.JSX.Element | null {
  const t = useTranslate()
  const [category, setCategory] = useState<ClaudeMoveFilter['category']>('all')
  const [query, setQuery] = useState('')
  const [accountId, setAccountId] = useState<string | null>(null)
  const [loaded, setLoaded] = useState<ClaudeSessionMoveSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const tabs = useClaudeMoveTabNames()
  const now = useHalfMinuteClock()
  const moves = accounts.sessionMoves
  const rows = useMemo(() => mergeClaudeMoveRows(moves ?? [], loaded), [moves, loaded])
  const context: ClaudeMoveTableContext = useMemo(
    () => ({
      now,
      emailOf: (id) =>
        id === null ? '—' : (accounts.accounts.find((account) => account.id === id)?.email ?? id),
      sessionName: (row) => claudeMoveSessionName(row, tabs)
    }),
    [now, accounts.accounts, tabs]
  )
  const lines = useMemo(() => {
    const filtered = filterClaudeMoveRows(
      rows,
      { category, accountId, query },
      (row) =>
        `${context.sessionName(row).name} ${context.emailOf(row.fromAccountId)} ${context.emailOf(row.toAccountId)}`
    )
    return groupClaudeMoveRows(filtered)
  }, [rows, category, accountId, query, context])
  const loadOlder = useCallback(async () => {
    setLoading(true)
    setLoadFailed(false)
    const older = await readOlderClaudeMoves(owner, rows.at(-1)?.at)
    if (older) {
      setLoaded((previous) => [...previous, ...older])
    } else {
      setLoadFailed(true)
    }
    setLoading(false)
  }, [owner, rows])
  if (moves === undefined) {
    return null
  }
  const title = t('accounts.claude.sessionMover.recentMoves', 'Recent moves')
  const description = t(
    'accounts.claude.recentMoves.description',
    'What the mover and the model policy decided for each Claude session, newest first.'
  )
  return (
    <SearchableSetting
      title={title}
      description={description}
      keywords={[
        ...translateSearchKeyword('auto.components.settings.accounts.search.e14049e1a8', 'claude'),
        ...translateSearchKeyword('accounts.claude.sessionMover.keyword.move', 'move'),
        ...translateSearchKeyword('accounts.claude.sessionMover.keyword.session', 'session'),
        ...translateSearchKeyword('accounts.claude.sessionMover.keyword.strategy', 'strategy'),
        ...translateSearchKeyword('accounts.claude.sessionMover.recentMoves', 'Recent moves'),
        ...translateSearchKeyword('accounts.claude.sessionMover.keyword.rebalance', 'rebalance')
      ]}
      className="space-y-2 py-2"
    >
      <div className="space-y-0.5">
        <Label>{title}</Label>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <ClaudeAccountUsageStrip
        accounts={accounts}
        selectedAccountId={accountId}
        onSelectAccount={setAccountId}
      />
      <div className="flex flex-wrap items-center gap-2">
        {CHIPS.map(([value, key, fallback]) => (
          <Button
            key={value}
            type="button"
            size="xs"
            variant={category === value ? 'secondary' : 'ghost'}
            aria-pressed={category === value}
            onClick={() => setCategory(value)}
          >
            {t(key, fallback)}
          </Button>
        ))}
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('accounts.claude.recentMoves.search', 'Search session or email')}
          aria-label={t('accounts.claude.recentMoves.search', 'Search session or email')}
          variant="code"
          className="h-7 min-w-[160px] flex-1"
        />
      </div>
      {lines.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {t('accounts.claude.sessionMover.recentMovesEmpty', 'No Claude session moves.')}
        </p>
      ) : (
        <ClaudeRecentMovesTable
          lines={lines}
          context={context}
          expanded={expanded}
          onToggle={(key) =>
            setExpanded((previous) => {
              const next = new Set(previous)
              if (!next.delete(key)) {
                next.add(key)
              }
              return next
            })
          }
        />
      )}
      <div className="flex items-center gap-2">
        <Button type="button" size="xs" variant="outline" disabled={loading} onClick={loadOlder}>
          {t('accounts.claude.recentMoves.loadOlder', 'Load older')}
        </Button>
        <span className={cn('text-xs', loadFailed ? 'text-destructive' : 'text-muted-foreground')}>
          {loadFailed
            ? t('accounts.claude.recentMoves.loadFailed', 'Could not read the account log.')
            : t('accounts.claude.recentMoves.count', '{{count}} rows', {
                count: rows.length
              })}
        </span>
      </div>
    </SearchableSetting>
  )
}
