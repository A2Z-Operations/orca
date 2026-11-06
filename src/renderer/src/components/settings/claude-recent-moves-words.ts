import type { ClaudeSessionMoveSummary } from '../../../../shared/managed-account-types'

/** A translatable phrase: the component passes it to `translate`; tests read the fallback. */
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

const PREFIX = 'accounts.claude.recentMoves.decision'

const STAY_WORDS: Record<string, [string, string]> = {
  'under-line': [`${PREFIX}.underLine`, 'Stayed: under the line'],
  'no-target': [`${PREFIX}.noTarget`, 'Stayed: no account under the line'],
  cooldown: [`${PREFIX}.cooldown`, 'Stayed: moved recently'],
  'failed-recently': [`${PREFIX}.failedRecently`, 'Stayed: a move failed recently'],
  'prompt-cache': [`${PREFIX}.promptCache`, 'Stayed: turn just ended'],
  'no-usage': [`${PREFIX}.noUsage`, 'Stayed: no usage reading'],
  stay: [`${PREFIX}.stay`, 'Stayed'],
  off: [`${PREFIX}.off`, 'Mover is off'],
  pinned: [`${PREFIX}.pinned`, 'Pinned'],
  'read-usage': [`${PREFIX}.readUsage`, 'Reading usage'],
  'wait:mid-turn': [`${PREFIX}.waitMidTurn`, 'Waiting: mid-turn'],
  'wait:no-status': [`${PREFIX}.waitNoStatus`, 'Waiting: no status yet'],
  'wait:background-work': [`${PREFIX}.waitBackgroundWork`, 'Waiting: background work'],
  ask: [`${PREFIX}.ask`, 'Asked to move'],
  moving: [`${PREFIX}.moving`, 'Moving'],
  failed: [`${PREFIX}.failed`, 'Move failed'],
  skipped: [`${PREFIX}.skipped`, 'Move skipped'],
  rebalance: [`${PREFIX}.rebalance`, 'Moved to balance accounts']
}

const MODEL_NAMES: Record<string, string> = { fable: 'Fable', opus: 'Opus', unset: 'unset' }

const FLIP_WHY: Record<string, string> = {
  'fable-line': 'Fable window at its line',
  'weekly-guard': 'weekly window at its guard',
  hysteresis: 'still near a line',
  'window-reset': 'a window reset',
  'fable-headroom': 'Fable has room',
  uncovered: 'fixed model restored'
}

/** Plain words for the Decision column. Unknown reasons from newer hosts show as themselves. */
export function claudeMoveDecision(row: ClaudeSessionMoveSummary): ClaudeMovePhrase {
  if (row.kind === 'model') {
    const from = MODEL_NAMES[row.modelFrom ?? ''] ?? row.modelFrom ?? '-'
    const to = MODEL_NAMES[row.modelTo ?? ''] ?? row.modelTo ?? '-'
    return {
      key: `${PREFIX}.flip`,
      fallback: 'Switched model: {{from}} → {{to}} ({{why}})',
      values: { from, to, why: FLIP_WHY[row.reason] ?? row.reason }
    }
  }
  if (row.reason === 'moved') {
    return row.strategy === 'proxy'
      ? { key: `${PREFIX}.movedProxy`, fallback: 'Moved (no restart)' }
      : { key: `${PREFIX}.movedResume`, fallback: 'Moved (restarted)' }
  }
  const words = STAY_WORDS[row.reason]
  return words
    ? { key: words[0], fallback: words[1] }
    : { key: `${PREFIX}.other`, fallback: '{{reason}}', values: { reason: row.reason } }
}

/** Fallback text with `{{name}}` filled in, as `translate` does with no catalog entry. */
export function claudeMovePhraseText(phrase: ClaudeMovePhrase): string {
  return phrase.fallback.replace(/\{\{(\w+)\}\}/g, (match, name: string) =>
    phrase.values && name in phrase.values ? (phrase.values[name] ?? match) : match
  )
}
