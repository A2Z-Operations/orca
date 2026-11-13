import { useCallback, useEffect, useRef } from 'react'
import { useAppStore } from '../../../store'
import { makePaneKey } from '../../../../../shared/workspace-layout/stable-pane-id'
import { connectPanePty } from '../pty-connection/connect-pane-pty'
import { releasePaneTransportForRestart } from './pane-restart-transport-handoff'
import {
  appendPaneTerminalError,
  clearPaneTerminalError
} from '../errors/terminal-error-accumulation'
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
  const restartingPanesRef = useRef(new Set<number>())
  const pendingRestartsRef = useRef(new Map<number, () => void>())
  useEffect(() => () => pendingRestartsRef.current.clear(), [])
  const settlePaneRestart = useCallback((paneId: number) => {
    // Let the previous spawn finish binding and remove its pending-spawn entry first.
    queueMicrotask(() => {
      restartingPanesRef.current.delete(paneId)
      const pending = pendingRestartsRef.current.get(paneId)
      pendingRestartsRef.current.delete(paneId)
      pending?.()
    })
  }, [])
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
    (paneId: number, startup: PtyConnectionDeps['startup'], options: { focus: boolean }) => {
      const manager = managerRef.current
      const pane = manager?.getPanes().find((candidate) => candidate.id === paneId)
      if (!manager || !pane) {
        restartingPanesRef.current.delete(paneId)
        pendingRestartsRef.current.delete(paneId)
        return
      }
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
        onRestartSettled: () => settlePaneRestart(paneId),
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
      settlePaneRestart,
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
      if (restartingPanesRef.current.has(paneId)) {
        if (options.queueIfRestarting) {
          pendingRestartsRef.current.set(paneId, () => restartPane(paneId, startup, options))
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
      restartingPanesRef.current.add(paneId)
      const restartingPtyId = getRestartPtyId(paneId)
      restartUnlessSessionHeld({
        replacesPtyId: restartingPtyId,
        resumeProviderSession: startup?.resumeProviderSession,
        findHolder: window.api?.pty?.findAgentSessionHolder,
        isStillCurrent: () => {
          const current = getRestartPtyId(paneId) === restartingPtyId
          if (!current) {
            settlePaneRestart(paneId)
          }
          return current
        },
        restart: () => restartPaneNow(paneId, startup, options),
        // The old PTY keeps its pane; the pane says why it did not restart.
        refuse: (refusal) => {
          settlePaneRestart(paneId)
          setTerminalErrorsByPaneId((current) => appendPaneTerminalError(current, paneId, refusal))
        }
      })
    },
    [getRestartPtyId, restartPaneNow, setTerminalErrorsByPaneId, settlePaneRestart]
  )
  return { handleRestartPane }
}
