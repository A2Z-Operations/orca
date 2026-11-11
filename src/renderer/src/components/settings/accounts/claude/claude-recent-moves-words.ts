import type { ClaudeSessionMoveSummary } from '../../../../../../shared/managed-account-types'
import { translate } from '@/i18n/i18n'

/** A translatable phrase: the component passes it to `translate`. */
export type ClaudeMovePhrase = {
  key: string
  fallback: string
  values?: Record<string, string>
}

export type ClaudeMoveCategory = 'move' | 'flip' | 'stay'

const MOVE_REASONS = new Set(['moving', 'moved', 'rebalance', 'failed', 'skipped', 'ask'])

export function claudeMoveCategory(row: ClaudeSessionMoveSummary): ClaudeMoveCategory {
  if (row.kind === 'model') {
    return 'flip'
  }
  return MOVE_REASONS.has(row.reason) ? 'move' : 'stay'
}

/** How the change lands: the proxy keeps the process; a resume restarts it. */
export function claudeMoveVia(row: ClaudeSessionMoveSummary): 'proxy' | 'restart' | null {
  if (row.strategy === 'proxy') {
    return 'proxy'
  }
  return row.strategy === 'resume' ? 'restart' : null
}

// Why literal keys: the catalog verifier reads them from source; a template prefix hides them.
const STAY_WORDS: Record<string, [string, string]> = {
  'under-line': ['accounts.claude.recentMoves.decision.underLine', 'Stayed: under the line'],
  'no-target': [
    'accounts.claude.recentMoves.decision.noTarget',
    'Stayed: no account under the line'
  ],
  cooldown: ['accounts.claude.recentMoves.decision.cooldown', 'Stayed: moved recently'],
  'failed-recently': [
    'accounts.claude.recentMoves.decision.failedRecently',
    'Stayed: a move failed recently'
  ],
  'prompt-cache': ['accounts.claude.recentMoves.decision.promptCache', 'Stayed: turn just ended'],
  'no-usage': ['accounts.claude.recentMoves.decision.noUsage', 'Stayed: no usage reading'],
  stay: ['accounts.claude.recentMoves.decision.stay', 'Stayed'],
  off: ['accounts.claude.recentMoves.decision.off', 'Mover is off'],
  pinned: ['accounts.claude.recentMoves.decision.pinned', 'Pinned'],
  'read-usage': ['accounts.claude.recentMoves.decision.readUsage', 'Reading usage'],
  'wait:mid-turn': ['accounts.claude.recentMoves.decision.waitMidTurn', 'Waiting: mid-turn'],
  'wait:no-status': ['accounts.claude.recentMoves.decision.waitNoStatus', 'Waiting: no status yet'],
  'wait:background-work': [
    'accounts.claude.recentMoves.decision.waitBackgroundWork',
    'Waiting: background work'
  ],
  ask: ['accounts.claude.recentMoves.decision.ask', 'Asked to move'],
  moving: ['accounts.claude.recentMoves.decision.moving', 'Moving'],
  failed: ['accounts.claude.recentMoves.decision.failed', 'Move failed'],
  skipped: ['accounts.claude.recentMoves.decision.skipped', 'Move skipped'],
  rebalance: ['accounts.claude.recentMoves.decision.rebalance', 'Moved to balance accounts']
}

const MODEL_NAMES: Record<string, [string, string]> = {
  fable: ['accounts.claude.recentMoves.decision.model.fable', 'Fable'],
  opus: ['accounts.claude.recentMoves.decision.model.opus', 'Opus'],
  unset: ['accounts.claude.recentMoves.decision.model.unset', 'unset']
}

const FLIP_WHY: Record<string, [string, string]> = {
  'fable-line': [
    'accounts.claude.recentMoves.decision.flipWhy.fableLine',
    'Fable window at its line'
  ],
  'weekly-guard': [
    'accounts.claude.recentMoves.decision.flipWhy.weeklyGuard',
    'weekly window at its guard'
  ],
  hysteresis: ['accounts.claude.recentMoves.decision.flipWhy.hysteresis', 'still near a line'],
  'window-reset': ['accounts.claude.recentMoves.decision.flipWhy.windowReset', 'a window reset'],
  'fable-headroom': [
    'accounts.claude.recentMoves.decision.flipWhy.fableHeadroom',
    'Fable has room'
  ],
  uncovered: ['accounts.claude.recentMoves.decision.flipWhy.uncovered', 'fixed model restored']
}

/** A catalog word for a known token; a token newer hosts add shows as itself. */
function word(words: Record<string, [string, string]>, token: string | undefined): string {
  const entry = words[token ?? '']
  return entry ? translate(entry[0], entry[1]) : (token ?? '-')
}

/** Plain words for the Decision column. Unknown reasons from newer hosts show as themselves. */
export function claudeMoveDecision(row: ClaudeSessionMoveSummary): ClaudeMovePhrase {
  if (row.kind === 'model') {
    return {
      key: 'accounts.claude.recentMoves.decision.flip',
      fallback: 'Switched model: {{from}} → {{to}} ({{why}})',
      values: {
        from: word(MODEL_NAMES, row.modelFrom),
        to: word(MODEL_NAMES, row.modelTo),
        why: word(FLIP_WHY, row.reason)
      }
    }
  }
  if (row.reason === 'moved') {
    return row.strategy === 'proxy'
      ? { key: 'accounts.claude.recentMoves.decision.movedProxy', fallback: 'Moved (no restart)' }
      : { key: 'accounts.claude.recentMoves.decision.movedResume', fallback: 'Moved (restarted)' }
  }
  const words = STAY_WORDS[row.reason]
  return words
    ? { key: words[0], fallback: words[1] }
    : {
        key: 'accounts.claude.recentMoves.decision.other',
        fallback: '{{reason}}',
        values: { reason: row.reason }
      }
}
