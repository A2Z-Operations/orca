import { appendClaudeAccountLog } from './claude-account-log'
import { publishClaudeAccountModelChanged } from './claude-account-plugin-publish'
import { rememberClaudeModelFlip } from './claude-model-flip-history'
import type { ClaudeModelPolicyFlip } from './claude-model-policy-ticker'
import { getClaudePaneAccount, setClaudePaneModel } from './claude-pane-account-registry'

/**
 * One model-policy flip: the pane's model, the recent-moves row, the durable log, and the plugin
 * event. The proxy rewrites the request body, so only a pane with a slot changes model without a
 * restart; that row is `strategy: 'proxy'`. A pane without one takes the model on its next launch.
 */
export function applyClaudeModelFlip(flip: ClaudeModelPolicyFlip): void {
  setClaudePaneModel(flip.ptyId, flip.to, 'policy')
  const strategy = getClaudePaneAccount(flip.ptyId)?.proxySlot ? ('proxy' as const) : undefined
  rememberClaudeModelFlip({ ...flip, ...(strategy ? { strategy } : {}) })
  appendClaudeAccountLog({
    type: 'flip',
    at: flip.at,
    ptyId: flip.ptyId,
    paneKey: flip.paneKey,
    accountId: flip.accountId,
    modelFrom: flip.from,
    modelTo: flip.to,
    reason: flip.reason,
    kind: 'model',
    ...(strategy ? { strategy } : {})
  })
  // The plugin contract names two models. A takeover from an unrecorded model is not a change it can name.
  if (flip.from !== 'unset') {
    publishClaudeAccountModelChanged({
      ptyId: flip.ptyId,
      accountId: flip.accountId,
      from: flip.from,
      to: flip.to,
      reason: flip.reason
    })
  }
}
