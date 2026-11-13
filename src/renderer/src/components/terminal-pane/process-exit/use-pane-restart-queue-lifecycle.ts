import { useEffect, useEffectEvent } from 'react'
import type { RefObject } from 'react'
import type { PaneManager } from '@/lib/pane-manager/pane-manager'
import type { usePaneProcessRestart } from './use-pane-process-restart'
import {
  getTabRestartQueues,
  notifyPaneRestartQueues,
  subscribePaneRestartQueues
} from './pane-restart-queue'

export function usePaneRestartQueueLifecycle({
  tabId,
  cwd,
  managerRef,
  ownerRef,
  handleRestartPane
}: {
  tabId: string
  cwd: string | undefined
  managerRef: RefObject<PaneManager | null>
  ownerRef: RefObject<boolean>
  handleRestartPane: ReturnType<typeof usePaneProcessRestart>['handleRestartPane']
}): void {
  const drainPending = useEffectEvent(() => {
    for (const queue of getTabRestartQueues(tabId)) {
      if (queue.active || !queue.pending) {
        continue
      }
      const pane = managerRef.current?.getPanes().find((pane) => pane.leafId === queue.leafId)
      if (!pane) {
        continue
      }
      const pending = queue.pending
      queue.pending = undefined
      handleRestartPane(pane.id, pending.startup, pending.options)
    }
  })
  useEffect(() => {
    ownerRef.current = true
    const drain = () => {
      // Mount reconciliation installs the new manager later in the same effect flush.
      queueMicrotask(() => {
        if (ownerRef.current) {
          drainPending()
        }
      })
    }
    const unsubscribe = subscribePaneRestartQueues(drain)
    drain()
    return () => {
      ownerRef.current = false
      unsubscribe()
      for (const queue of getTabRestartQueues(tabId)) {
        if (queue.active?.owner === ownerRef && !queue.active.started) {
          if (!queue.pending) {
            queue.pending = queue.active
          }
          queue.active = undefined
        }
      }
      notifyPaneRestartQueues()
    }
  }, [ownerRef, tabId, cwd])
}
