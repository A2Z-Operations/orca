import type { ClaudeSessionMoveSummary } from '../../shared/managed-account-types'
import type { ClaudePolicyModel } from './claude-model-policy'

/** A later mover "stay" replaces one row per pane. Model flips live here so that row cannot erase them. */
const flips: ClaudeSessionMoveSummary[] = []
const MAX_FLIPS = 50

export type ClaudeModelFlipRecord = {
  ptyId: string
  paneKey: string | null
  accountId: string
  from: ClaudePolicyModel
  to: ClaudePolicyModel
  reason: string
  at: number
}

export function rememberClaudeModelFlip(flip: ClaudeModelFlipRecord): void {
  flips.unshift({
    ptyId: flip.ptyId,
    paneKey: flip.paneKey,
    fromAccountId: flip.accountId,
    toAccountId: flip.accountId,
    window: null,
    percent: null,
    line: null,
    reason: flip.reason,
    at: flip.at,
    kind: 'model',
    modelFrom: flip.from,
    modelTo: flip.to
  })
  if (flips.length > MAX_FLIPS) {
    flips.length = MAX_FLIPS
  }
}

export function claudeModelFlips(): ClaudeSessionMoveSummary[] {
  return [...flips]
}

export function resetClaudeModelFlips(): void {
  flips.length = 0
}
