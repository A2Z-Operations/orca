import { getTabRestartQueues } from '../process-exit/pane-restart-queue'
import type { AppState } from '@/store/types'
import { isClaudePaneMidTurn } from '@/lib/agent-session/accounts/claude/claude-session-account-move'
import { makePaneKey } from '../../../../../shared/workspace-layout/stable-pane-id'

/** PTYs whose queued account restart can run now: Codex at once, this tab's Claude once its turn ends. */
export function selectReadyAccountRestartPtyIds(state: AppState, tabId: string): string[] {
  const pending = state.pendingPaneAccountRestarts
  const ready = Object.keys(pending).filter((ptyId) => pending[ptyId] === 'codex')
  const ptyIdsByLeafId = state.terminalLayoutsByTabId[tabId]?.ptyIdsByLeafId ?? {}
  for (const [leafId, ptyId] of Object.entries(ptyIdsByLeafId)) {
    if (pending[ptyId] === 'claude' && !isClaudePaneMidTurn(state, makePaneKey(tabId, leafId))) {
      ready.push(ptyId)
    }
  }
  for (const queue of getTabRestartQueues(tabId)) {
    if (isClaudePaneMidTurn(state, makePaneKey(tabId, queue.leafId))) {
      continue
    }
    for (const ptyId of queue.ptyIds) {
      if (pending[ptyId] === 'claude' && !ready.includes(ptyId)) {
        ready.push(ptyId)
      }
    }
  }
  return ready
}

/** Whether `ptyId`'s queued restart can run against the store as it is now. */
export function isAccountRestartReady(
  state: AppState,
  tabId: string,
  leafId: string,
  ptyId: string
): boolean {
  const queued = state.pendingPaneAccountRestarts[ptyId]
  return (
    queued === 'codex' ||
    (queued === 'claude' && !isClaudePaneMidTurn(state, makePaneKey(tabId, leafId)))
  )
}
