import { useAppStore } from '@/store'
import { makePaneKey } from '../../../../../shared/workspace-layout/stable-pane-id'
import { layoutContainsLeafId } from '../../../../../shared/workspace-layout/terminal-pane-tree'
import type { PtyConnectionDeps } from '../pty-connection/pty-connection-deps'

export type PaneRestartRequest = {
  startup: PtyConnectionDeps['startup']
  options: { focus: boolean; queueIfRestarting?: boolean }
}

export type PaneRestartAttempt = PaneRestartRequest & {
  owner: object
  started: boolean
}

type PaneRestartQueue = {
  tabId: string
  worktreeId: string
  leafId: string
  ptyIds: Set<string>
  pending?: PaneRestartRequest
  active?: PaneRestartAttempt
  unsubscribe: () => void
}

const queues = new Map<string, PaneRestartQueue>()
const listeners = new Set<() => void>()

export function notifyPaneRestartQueues(): void {
  for (const listener of listeners) {
    listener()
  }
}

export function subscribePaneRestartQueues(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getPaneRestartQueue(
  tabId: string,
  worktreeId: string,
  leafId: string
): PaneRestartQueue {
  const key = makePaneKey(tabId, leafId)
  const existing = queues.get(key)
  if (existing) {
    return existing
  }
  const queue: PaneRestartQueue = {
    tabId,
    worktreeId,
    leafId,
    ptyIds: new Set(),
    unsubscribe: () => {}
  }
  queues.set(key, queue)
  queue.unsubscribe = useAppStore.subscribe(() => {
    const state = useAppStore.getState()
    if (
      state.tabsByWorktree[worktreeId]?.some((tab) => tab.id === tabId) &&
      layoutContainsLeafId(state.terminalLayoutsByTabId[tabId]?.root ?? null, leafId)
    ) {
      releaseIdlePaneRestartQueue(queue)
      return
    }
    // A closed pane must not pass its queued account to a reused numeric pane slot.
    if (queue.pending || queue.active) {
      console.warn('[terminal] discarded pending pane restart: pane removed', { tabId, leafId })
    }
    queues.delete(key)
    queue.unsubscribe()
    queue.pending = undefined
    queue.active = undefined
    for (const ptyId of queue.ptyIds) {
      if (state.pendingPaneAccountRestarts[ptyId]) {
        console.warn('[terminal] discarded pending account switch: pane removed', { tabId, leafId })
        state.consumePendingPaneAccountRestart(ptyId)
      }
    }
    notifyPaneRestartQueues()
  })
  return queue
}

export function getTabRestartQueues(tabId: string): PaneRestartQueue[] {
  return [...queues.values()].filter((queue) => queue.tabId === tabId)
}

export function getRestartingPanePtyIds(tabId: string, leafId: string): readonly string[] {
  return [...(queues.get(makePaneKey(tabId, leafId))?.ptyIds ?? [])]
}

export function releaseIdlePaneRestartQueue(queue: PaneRestartQueue): void {
  if (queue.active || queue.pending) {
    return
  }
  const pending = useAppStore.getState().pendingPaneAccountRestarts
  if ([...queue.ptyIds].some((ptyId) => pending[ptyId])) {
    return
  }
  queues.delete(makePaneKey(queue.tabId, queue.leafId))
  queue.unsubscribe()
}

export function settlePaneRestart(
  tabId: string,
  leafId: string,
  attempt: PaneRestartAttempt
): void {
  // Drain after the old spawn has finished binding and removed its pending-spawn entry.
  queueMicrotask(() => {
    const queue = queues.get(makePaneKey(tabId, leafId))
    if (!queue || queue.active !== attempt) {
      return
    }
    queue.active = undefined
    notifyPaneRestartQueues()
    releaseIdlePaneRestartQueue(queue)
  })
}
