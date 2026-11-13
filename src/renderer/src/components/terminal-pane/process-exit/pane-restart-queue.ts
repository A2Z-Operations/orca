import { useAppStore } from '@/store'
import { getTerminalTabOwnerWorktreeId } from '@/store/terminals/terminal-tab-owner-index'
import { makePaneKey } from '../../../../../shared/workspace-layout/stable-pane-id'
import { layoutContainsLeafId } from '../../../../../shared/workspace-layout/terminal-pane-tree'
import type { PtyConnectionDeps } from '../pty-connection/pty-connection-deps'
import { clearUnsentRestartHandoff } from './unsent-restart-handoff'

export { noteUnsentRestartHandoff, takeUnsentRestartHandoff } from './unsent-restart-handoff'

export type PaneRestartOptions = {
  focus: boolean
  queueIfRestarting?: boolean
}

/** `handoff` is a parked restart's re-queue. `fromPending` is the drain starting what it took. */
export type PaneRestartCallOptions = PaneRestartOptions & {
  handoff?: boolean
  fromPending?: boolean
}

export type PaneRestartRequest = {
  startup: PtyConnectionDeps['startup']
  options: PaneRestartOptions
}

export type PaneRestartAttempt = PaneRestartRequest & {
  owner: object
  started: boolean
  /** Taken from `pending` by the drain, so a later hand-back must not run behind it. */
  drained: boolean
}

export function storedRestartOptions(options: PaneRestartCallOptions): PaneRestartOptions {
  return {
    focus: options.focus,
    ...(options.queueIfRestarting ? { queueIfRestarting: true } : {})
  }
}

export type PaneRestartClaim =
  | { kind: 'start'; attempt: PaneRestartAttempt }
  | { kind: 'queued' }
  | { kind: 'busy' }

export function claimPaneRestartAttempt(
  queue: PaneRestartQueue,
  startup: PtyConnectionDeps['startup'],
  options: PaneRestartCallOptions,
  owner: object
): PaneRestartClaim {
  const kept = storedRestartOptions(options)
  // The parked spawn re-queues its move. A startup already waiting, or the one the drain just
  // started from that wait, is newer and must not be cleared or run a second time.
  if (options.handoff && (queue.pending || queue.active?.drained)) {
    return { kind: 'queued' }
  }
  if (queue.active) {
    if (options.queueIfRestarting) {
      queue.pending = { startup, options: kept }
      return { kind: 'queued' }
    }
    return { kind: 'busy' }
  }
  if (options.queueIfRestarting) {
    queue.pending = undefined
  }
  const attempt: PaneRestartAttempt = {
    startup,
    options: kept,
    owner,
    started: false,
    drained: options.fromPending === true
  }
  queue.active = attempt
  return { kind: 'start', attempt }
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

/** The bucket that still contains the tab. Another bucket owning it is a move, not a close. */
export function restartTabOwnerWorktreeId(
  tabsByWorktree: Readonly<Record<string, readonly { id: string }[]>>,
  worktreeId: string,
  tabId: string
): string | null {
  if (tabsByWorktree[worktreeId]?.some((tab) => tab.id === tabId)) {
    return worktreeId
  }
  return getTerminalTabOwnerWorktreeId(tabsByWorktree, tabId)
}

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
    const ownerWorktreeId = restartTabOwnerWorktreeId(
      state.tabsByWorktree,
      queue.worktreeId,
      queue.tabId
    )
    if (
      ownerWorktreeId &&
      layoutContainsLeafId(state.terminalLayoutsByTabId[tabId]?.root ?? null, leafId)
    ) {
      queue.worktreeId = ownerWorktreeId
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
      clearUnsentRestartHandoff(ptyId)
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
