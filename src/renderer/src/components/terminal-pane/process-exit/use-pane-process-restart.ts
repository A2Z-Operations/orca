import { useCallback, useRef } from 'react'
import { useAppStore } from '../../../store'
import { makePaneKey } from '../../../../../shared/workspace-layout/stable-pane-id'
import { connectPanePty } from '../pty-connection/connect-pane-pty'
import { releasePaneTransportForRestart } from './pane-restart-transport-handoff'
import {
  appendPaneTerminalError,
  clearPaneTerminalError
} from '../errors/terminal-error-accumulation'
import {
  getPaneRestartQueue,
  getTabRestartQueues,
  settlePaneRestart,
  type PaneRestartAttempt
} from './pane-restart-queue'
import { usePaneRestartQueueLifecycle } from './use-pane-restart-queue-lifecycle'
import { restartUnlessSessionHeld } from './restart-unless-session-held'
import type { PtyConnectionDeps } from '../pty-connection/pty-connection-deps'
import type { TerminalPaneCloseController } from '../layout/close/use-terminal-pane-close-actions'

export function usePaneProcessRestart({
  clearCodexRestartNotice,
  clearExitedPanePtyLayoutBinding,
  clearRuntimePaneTitle,
  clearTabPtyId,
  cwd,
  dispatchNotification,
  isActiveRef,
  isVisibleRef,
  markTerminalBell,
  handlePaneProcessDied,
  managerRef,
  onAgentExitedRef,
  onPtyErrorClearedRef,
  onPtyErrorRef,
  onPtyExitRef,
  onPtyRecoveryStateRef,
  paneKittyKeyboardModesRef,
  paneLastThemeModeRef,
  paneMode2031Ref,
  panePtyBindingsRef,
  paneTransportsRef,
  replayingPanesRef,
  setCacheTimerStartedAt,
  setRuntimePaneTitle,
  setTerminalError,
  setTerminalErrorsByPaneId,
  showRestoredSessionBanner,
  suppressPtyExit,
  syncPanePtyLayoutBinding,
  tabId,
  updateTabPtyId,
  updateTabTitle,
  worktreeId
}: Pick<
  TerminalPaneCloseController,
  | 'clearCodexRestartNotice'
  | 'clearExitedPanePtyLayoutBinding'
  | 'clearRuntimePaneTitle'
  | 'clearTabPtyId'
  | 'cwd'
  | 'dispatchNotification'
  | 'isActiveRef'
  | 'isVisibleRef'
  | 'markTerminalBell'
  | 'handlePaneProcessDied'
  | 'managerRef'
  | 'onAgentExitedRef'
  | 'onPtyErrorClearedRef'
  | 'onPtyErrorRef'
  | 'onPtyExitRef'
  | 'onPtyRecoveryStateRef'
  | 'paneKittyKeyboardModesRef'
  | 'paneLastThemeModeRef'
  | 'paneMode2031Ref'
  | 'panePtyBindingsRef'
  | 'paneTransportsRef'
  | 'replayingPanesRef'
  | 'setCacheTimerStartedAt'
  | 'setRuntimePaneTitle'
  | 'setTerminalError'
  | 'setTerminalErrorsByPaneId'
  | 'showRestoredSessionBanner'
  | 'suppressPtyExit'
  | 'syncPanePtyLayoutBinding'
  | 'tabId'
  | 'updateTabPtyId'
  | 'updateTabTitle'
  | 'worktreeId'
>) {
  const owner = useRef(true)
  const getRestartPtyId = useCallback(
    (paneId: number) => {
      const pane = managerRef.current?.getPanes().find((candidate) => candidate.id === paneId)
      return (
        paneTransportsRef.current.get(paneId)?.getPtyId() ??
        (pane
          ? useAppStore.getState().terminalLayoutsByTabId[tabId]?.ptyIdsByLeafId?.[pane.leafId]
          : undefined)
      )
    },
    [managerRef, paneTransportsRef, tabId]
  )
  const restartPaneNow = useCallback(
    (paneId: number, attempt: PaneRestartAttempt) => {
      const { startup, options } = attempt
      const manager = managerRef.current
      const pane = manager?.getPanes().find((candidate) => candidate.id === paneId)
      if (!manager || !pane) {
        return
      }
      attempt.started = true
      const transport = paneTransportsRef.current.get(paneId)
      const panePtyBinding = panePtyBindingsRef.current.get(paneId)
      const existingPtyId = getRestartPtyId(paneId)
      if (existingPtyId) {
        suppressPtyExit(existingPtyId)
        clearCodexRestartNotice(existingPtyId)
      }
      panePtyBinding?.dispose()
      panePtyBindingsRef.current.delete(paneId)
      const replacesPtyId = releasePaneTransportForRestart(transport, existingPtyId)
      // A pending local replacement must remain discoverable in the quit checkpoint.
      if (!replacesPtyId) {
        if (existingPtyId) {
          clearTabPtyId(tabId, existingPtyId)
        }
        syncPanePtyLayoutBinding(paneId, null)
      }
      paneTransportsRef.current.delete(paneId)
      setCacheTimerStartedAt(makePaneKey(tabId, pane.leafId), null)
      setTerminalError(null)
      setTerminalErrorsByPaneId((current) => clearPaneTerminalError(current, paneId))
      const newPaneBinding = connectPanePty(pane, manager, {
        tabId,
        worktreeId,
        cwd,
        startup,
        ...(replacesPtyId ? { replacesPtyId } : {}),
        onRestartSettled: () => settlePaneRestart(tabId, pane.leafId, attempt),
        hasPendingRestart: () => {
          const queue = getTabRestartQueues(tabId).find((entry) => entry.leafId === pane.leafId)
          return Boolean(queue?.pending || (queue?.active && queue.active !== attempt))
        },
        mountFollowsTerminalPark: false,
        paneTransportsRef,
        paneMode2031Ref,
        paneKittyKeyboardModesRef,
        paneLastThemeModeRef,
        replayingPanesRef,
        isActiveRef,
        isVisibleRef,
        onPtyExitRef,
        onAgentExitedRef,
        onPtyErrorRef,
        onPtyErrorClearedRef,
        onPaneProcessDied: handlePaneProcessDied,
        onPtyRecoveryStateRef,
        clearTabPtyId,
        consumeSuppressedPtyExit: useAppStore.getState().consumeSuppressedPtyExit,
        isPtyShutdownPending: useAppStore.getState().isPtyShutdownPending,
        updateTabTitle,
        setRuntimePaneTitle,
        clearRuntimePaneTitle,
        updateTabPtyId,
        markTerminalBell,
        onShowSessionRestoredBanner: showRestoredSessionBanner,
        dispatchNotification,
        setCacheTimerStartedAt,
        syncPanePtyLayoutBinding,
        clearExitedPanePtyLayoutBinding
      })
      panePtyBindingsRef.current.set(paneId, newPaneBinding)
      if (options.focus) {
        manager.setActivePane(paneId, { focus: true })
      }
    },
    [
      clearCodexRestartNotice,
      clearExitedPanePtyLayoutBinding,
      clearRuntimePaneTitle,
      clearTabPtyId,
      cwd,
      dispatchNotification,
      handlePaneProcessDied,
      getRestartPtyId,
      isActiveRef,
      isVisibleRef,
      markTerminalBell,
      managerRef,
      onAgentExitedRef,
      onPtyErrorClearedRef,
      onPtyErrorRef,
      onPtyExitRef,
      onPtyRecoveryStateRef,
      paneKittyKeyboardModesRef,
      paneLastThemeModeRef,
      paneMode2031Ref,
      panePtyBindingsRef,
      paneTransportsRef,
      replayingPanesRef,
      setCacheTimerStartedAt,
      setRuntimePaneTitle,
      setTerminalError,
      showRestoredSessionBanner,
      suppressPtyExit,
      syncPanePtyLayoutBinding,
      tabId,
      updateTabPtyId,
      updateTabTitle,
      worktreeId,
      setTerminalErrorsByPaneId
    ]
  )

  const handleRestartPane = useCallback(
    function restartPane(
      paneId: number,
      startup: PtyConnectionDeps['startup'],
      options: { focus: boolean; queueIfRestarting?: boolean }
    ): void {
      const manager = managerRef.current
      const pane = manager?.getPanes().find((candidate) => candidate.id === paneId)
      if (!owner.current || !manager || !pane) {
        console.warn('[terminal] discarded pending pane restart: pane removed', { tabId, paneId })
        return
      }
      const queue = getPaneRestartQueue(tabId, worktreeId, pane.leafId)
      if (queue.active) {
        if (options.queueIfRestarting) {
          queue.pending = { startup, options }
          return
        }
        setTerminalErrorsByPaneId((current) =>
          appendPaneTerminalError(
            current,
            paneId,
            'A restart is already in progress for this pane.'
          )
        )
        return
      }
      if (options.queueIfRestarting) {
        queue.pending = undefined
      }
      const attempt: PaneRestartAttempt = { startup, options, owner, started: false }
      queue.active = attempt
      const restartingPtyId = getRestartPtyId(paneId)
      if (restartingPtyId) {
        queue.ptyIds.add(restartingPtyId)
      }
      restartUnlessSessionHeld({
        replacesPtyId: restartingPtyId,
        resumeProviderSession: startup?.resumeProviderSession,
        findHolder: window.api?.pty?.findAgentSessionHolder,
        isStillCurrent: () => {
          if (queue.active !== attempt) {
            return false
          }
          const samePane =
            owner.current &&
            managerRef.current === manager &&
            manager
              .getPanes()
              .some((candidate) => candidate.id === paneId && candidate.leafId === pane.leafId)
          if (!samePane) {
            if (!queue.pending) {
              queue.pending = { startup, options }
            }
            settlePaneRestart(tabId, pane.leafId, attempt)
            return false
          }
          const current = getRestartPtyId(paneId) === restartingPtyId
          if (!current) {
            if (!queue.pending) {
              queue.pending = { startup, options }
            }
            settlePaneRestart(tabId, pane.leafId, attempt)
          }
          return current
        },
        restart: () => restartPaneNow(paneId, attempt),
        // The old PTY keeps its pane; the pane says why it did not restart.
        refuse: (refusal) => {
          settlePaneRestart(tabId, pane.leafId, attempt)
          setTerminalErrorsByPaneId((current) => appendPaneTerminalError(current, paneId, refusal))
        }
      })
    },
    [
      getRestartPtyId,
      restartPaneNow,
      setTerminalErrorsByPaneId,
      managerRef,
      owner,
      tabId,
      worktreeId
    ]
  )
  usePaneRestartQueueLifecycle({ tabId, cwd, managerRef, ownerRef: owner, handleRestartPane })
  return { handleRestartPane }
}
