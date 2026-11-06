import { appendClaudeAccountLog } from './claude-account-log'
import { publishClaudeAccountModelChanged } from './claude-account-plugin-publish'
import { rememberClaudeModelFlip } from './claude-model-flip-history'
import { claudePolicyModelLabel } from './claude-model-policy'
import type { ClaudeModelPolicyFlip, ClaudeModelPolicyUncover } from './claude-model-policy-ticker'
import { getClaudePaneAccount, setClaudePaneModel } from './claude-pane-account-registry'

/** Flip reason when covers-explicit turns off and a pane returns to the model its launch fixed. */
export const CLAUDE_MODEL_UNCOVERED_REASON = 'uncovered'

/**
 * One model-policy flip: the pane's model, the recent-moves row, the durable log, and the plugin
 * event. The proxy rewrites the request body, so only a pane with a slot changes model without a
 * restart; that row is `strategy: 'proxy'`. A pane without one takes the model on its next launch.
 * A flip over a pinned pane (covers-explicit) keeps the pin in the registry as `launchModel`.
 */
export function applyClaudeModelFlip(flip: ClaudeModelPolicyFlip): void {
  setClaudePaneModel(flip.ptyId, flip.to, 'policy')
  noteClaudeModelFlip(flip)
}

/**
 * The covered pane goes back to its own model and the proxy stops rewriting; the change, when
 * there is one, is a flip row like any other so the table says why the model moved.
 */
export function uncoverClaudePaneModel(pane: ClaudeModelPolicyUncover): void {
  const record = getClaudePaneAccount(pane.ptyId)
  const launchModel = record?.launchModel
  if (!launchModel) {
    return
  }
  const from = record.model ? claudePolicyModelLabel(record.model) : null
  setClaudePaneModel(pane.ptyId, launchModel, 'pinned')
  const to = claudePolicyModelLabel(launchModel)
  if (to && to !== from) {
    noteClaudeModelFlip({
      ...pane,
      from: from ?? 'unset',
      to,
      reason: CLAUDE_MODEL_UNCOVERED_REASON
    })
  }
}

function noteClaudeModelFlip(flip: ClaudeModelPolicyFlip): void {
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
