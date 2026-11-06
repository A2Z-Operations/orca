import { ChevronDown, ChevronRight } from 'lucide-react'
import { formatClaudeRelativeAge } from '../../../../shared/claude-relative-age'
import type { ClaudeSessionMoveSummary } from '../../../../shared/managed-account-types'
import { translate } from '@/i18n/i18n'
import { ClaudeIcon } from '../status-bar/icons'
import type { ClaudeMoveLine } from './claude-recent-moves-rows'
import type { ClaudeMoveSessionName } from './claude-recent-moves-session-name'
import {
  claudeMoveDecision,
  claudeMoveVia,
  type ClaudeMovePhrase
} from './claude-recent-moves-words'

export type ClaudeMoveTableContext = {
  now: number
  emailOf: (accountId: string | null) => string
  sessionName: (row: ClaudeSessionMoveSummary) => ClaudeMoveSessionName
}

function phrase(value: ClaudeMovePhrase): string {
  return translate(value.key, value.fallback, value.values)
}

const CELL = 'px-2 py-1 align-top'

function MoveRow({
  row,
  context,
  nested = false
}: {
  row: ClaudeSessionMoveSummary
  context: ClaudeMoveTableContext
  nested?: boolean
}): React.JSX.Element {
  const session = context.sessionName(row)
  const moved =
    row.kind !== 'model' && row.toAccountId !== null && row.toAccountId !== row.fromAccountId
  const via = claudeMoveVia(row)
  return (
    <tr className="border-t border-border/50" data-testid="claude-move-row">
      <td className={CELL} title={new Date(row.at).toISOString()}>
        {formatClaudeRelativeAge(Math.min(row.at, context.now), context.now)}
      </td>
      <td className={CELL} title={session.ids}>
        <span className={`flex min-w-0 items-center gap-1 ${nested ? 'pl-4' : ''}`}>
          <ClaudeIcon size={12} />
          <span className="truncate">{session.name}</span>
        </span>
      </td>
      <td className={`${CELL} break-all`}>
        {context.emailOf(row.fromAccountId)}
        {moved ? ` → ${context.emailOf(row.toAccountId)}` : ''}
      </td>
      <td className={CELL}>
        {row.kind === 'model' ? `${row.modelFrom ?? '-'} → ${row.modelTo ?? '-'}` : ''}
      </td>
      <td className={CELL}>{phrase(claudeMoveDecision(row))}</td>
      <td className={CELL}>
        {via === 'proxy'
          ? translate('accounts.claude.recentMoves.viaProxy', 'proxy')
          : via === 'restart'
            ? translate('accounts.claude.recentMoves.viaRestart', 'restart')
            : ''}
      </td>
    </tr>
  )
}

export function ClaudeRecentMovesTable({
  lines,
  context,
  expanded,
  onToggle
}: {
  lines: readonly ClaudeMoveLine[]
  context: ClaudeMoveTableContext
  expanded: ReadonlySet<string>
  onToggle: (key: string) => void
}): React.JSX.Element {
  return (
    <div className="max-h-[420px] overflow-y-auto rounded-md border border-border/60 scrollbar-sleek">
      <table className="w-full table-fixed text-xs">
        <thead className="sticky top-0 bg-background text-left text-[11px] text-muted-foreground">
          <tr>
            <th className="w-[16%] px-2 py-1 font-medium">
              {translate('accounts.claude.recentMoves.when', 'When')}
            </th>
            <th className="w-[24%] px-2 py-1 font-medium">
              {translate('accounts.claude.recentMoves.session', 'Session')}
            </th>
            <th className="w-[24%] px-2 py-1 font-medium">
              {translate('accounts.claude.recentMoves.account', 'Account')}
            </th>
            <th className="w-[10%] px-2 py-1 font-medium">
              {translate('accounts.claude.recentMoves.model', 'Model')}
            </th>
            <th className="w-[18%] px-2 py-1 font-medium">
              {translate('accounts.claude.recentMoves.decisionColumn', 'Decision')}
            </th>
            <th className="w-[8%] px-2 py-1 font-medium">
              {translate('accounts.claude.recentMoves.via', 'Via')}
            </th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => {
            if (line.kind === 'row') {
              return <MoveRow key={line.key} row={line.row} context={context} />
            }
            const open = expanded.has(line.key)
            const first = line.rows[0]
            return [
              <tr
                key={line.key}
                className="border-t border-border/50"
                data-testid="claude-move-group"
              >
                <td className={CELL} title={new Date(line.at).toISOString()}>
                  {formatClaudeRelativeAge(Math.min(line.at, context.now), context.now)}
                </td>
                <td className={CELL} colSpan={5}>
                  <button
                    type="button"
                    aria-expanded={open}
                    onClick={() => onToggle(line.key)}
                    className="flex items-center gap-1 text-left hover:underline"
                  >
                    {open ? (
                      <ChevronDown className="size-3" />
                    ) : (
                      <ChevronRight className="size-3" />
                    )}
                    {translate(
                      'accounts.claude.recentMoves.group',
                      '{{count}} sessions stayed on {{email}} — {{decision}}',
                      {
                        count: line.rows.length,
                        email: context.emailOf(line.fromAccountId),
                        decision: first ? phrase(claudeMoveDecision(first)) : line.reason
                      }
                    )}
                  </button>
                </td>
              </tr>,
              ...(open
                ? line.rows.map((row) => (
                    <MoveRow key={`${line.key}:${row.ptyId}`} row={row} context={context} nested />
                  ))
                : [])
            ]
          })}
        </tbody>
      </table>
    </div>
  )
}
