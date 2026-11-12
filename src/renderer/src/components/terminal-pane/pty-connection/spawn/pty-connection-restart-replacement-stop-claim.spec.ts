import { bindPtyConnectionTestMocks } from '../test-fixtures/pty-connection-mocks.spec'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushAsyncTicks } from '../test-fixtures/pty-connection-test-async'
import { mainLayoutApplyTransport } from '../test-fixtures/pty-connection-test-main-pane-start-fixtures'
import {
  createMockTransport,
  createPane,
  createManager,
  LEAF_1,
  type MockTransport
} from '../test-fixtures/pty-connection-test-pane-fixtures'
import {
  buildPaneConnectionDeps,
  type PtyConnectionAgentTitleMocks,
  bindPaneAgentTitleMocks
} from '../test-fixtures/pty-connection-test-deps'
import { createInitialStoreState } from '../test-fixtures/pty-connection-test-store-fixtures'
import type { StoreState } from '../test-fixtures/pty-connection-test-store-state'

import {
  installTerminalTestGlobals,
  restoreTerminalTestGlobals
} from '../test-fixtures/pty-connection-test-environment'
import { mockPanePtyArgs } from '../test-fixtures/pty-connection-test-connect-mock-pane'

export function registerPtyConnectionRestartReplacementDisposeTests(): void {
  let mockStoreState: StoreState
  let transportFactoryQueue: MockTransport[] = []
  let createdTransportOptions: Record<string, unknown>[] = []
  let storeSubscribers: ((state: StoreState) => void)[] = []

  function createDeps(overrides: Record<string, unknown> = {}) {
    return buildPaneConnectionDeps(() => mockStoreState, overrides)
  }
  describe('connectPanePty', () => {
    beforeEach(async () => {
      vi.clearAllMocks()
      transportFactoryQueue = []
      createdTransportOptions = []
      storeSubscribers = []
      mockStoreState = createInitialStoreState(() => mockStoreState)
      bindPtyConnectionTestMocks({
        getState: () => mockStoreState,
        getTransportQueue: () => transportFactoryQueue,
        getTransportOptions: () => createdTransportOptions,
        getStoreSubscribers: () => storeSubscribers,
        setStoreSubscribers: (subscribers) => {
          storeSubscribers = subscribers
        }
      })
      await installTerminalTestGlobals()
      ;(await mainLayoutApplyTransport()).reset()
    })

    afterEach(async () => {
      await restoreTerminalTestGlobals()
    })

    it('stops the replaced PTY itself when the pane is disposed before a spawn carried the stop', async () => {
      const { connectPanePty } = await import('../connect-pane-pty')
      const agentTitleMocks6 =
        await vi.importMock<PtyConnectionAgentTitleMocks>('@/lib/agent-status')
      transportFactoryQueue.push(createMockTransport('pty-restarted'))
      const deps = createDeps({
        tabId: 'tab-restart-closed',
        startup: { command: 'codex', launchAgent: 'codex' },
        replacesPtyId: 'pty-replaced'
      })
      const args = mockPanePtyArgs(createPane(2), createManager(1), deps)
      bindPaneAgentTitleMocks(args[2], agentTitleMocks6)

      // Closing the tab (or parking it) disposes the pane before its deferred connect runs.
      connectPanePty(...args).dispose()
      await flushAsyncTicks()

      expect(window.api.pty.kill).toHaveBeenCalledWith('pty-replaced')
    })

    /** A tab whose pane's restart cleared its binding, as `handleRestartPane` leaves it. */
    function addRestartingTab(tabId: string): void {
      mockStoreState.tabsByWorktree['wt-1'].push({ id: tabId, ptyId: null })
      mockStoreState.terminalLayoutsByTabId = {
        ...mockStoreState.terminalLayoutsByTabId,
        [tabId]: {
          root: { type: 'leaf', leafId: LEAF_1 },
          activeLeafId: LEAF_1,
          expandedLeafId: null,
          ptyIdsByLeafId: {}
        }
      }
    }

    function installRestartStoreActions(): void {
      mockStoreState.queuePaneAccountRestarts = vi.fn()
      mockStoreState.replaceTerminalLayoutPanePtyId = vi.fn(
        (tabId: string, leafId: string, ptyId: string) => {
          const layout = mockStoreState.terminalLayoutsByTabId?.[tabId]
          if (layout) {
            layout.ptyIdsByLeafId = { ...layout.ptyIdsByLeafId, [leafId]: ptyId }
          }
        }
      )
    }

    function claudeRestartStartup(sessionId: string) {
      return {
        command: `claude --resume ${sessionId}`,
        launchAgent: 'claude',
        resumeProviderSession: { key: 'session_id', id: sessionId }
      }
    }

    it('gives N parked panes their live agent PTYs back instead of stopping them', async () => {
      const { connectPanePty } = await import('../connect-pane-pty')
      const agentTitleMocks =
        await vi.importMock<PtyConnectionAgentTitleMocks>('@/lib/agent-status')
      installRestartStoreActions()
      const tabIds = ['tab-agent-a', 'tab-agent-b', 'tab-agent-c']
      const deps = tabIds.map((tabId, index) => {
        addRestartingTab(tabId)
        transportFactoryQueue.push(createMockTransport(`pty-unsent-${index}`))
        return createDeps({
          tabId,
          startup: claudeRestartStartup(`session-${index}`),
          replacesPtyId: `pty-live-${index}`
        })
      })

      // An account switch restarts every pane; parking the hidden tabs disposes them before any spawn.
      for (const paneDeps of deps) {
        const args = mockPanePtyArgs(createPane(1), createManager(1), paneDeps)
        bindPaneAgentTitleMocks(args[2], agentTitleMocks)
        connectPanePty(...args).dispose()
      }
      await flushAsyncTicks()

      expect(window.api.pty.kill).not.toHaveBeenCalled()
      tabIds.forEach((tabId, index) => {
        expect(deps[index].updateTabPtyId).toHaveBeenCalledWith(tabId, `pty-live-${index}`)
        expect(deps[index].consumeSuppressedPtyExit).toHaveBeenCalledWith(`pty-live-${index}`)
        // The saved tab names its live PTY again, so a restore reattaches it rather than spawning.
        expect(mockStoreState.terminalLayoutsByTabId?.[tabId]?.ptyIdsByLeafId?.[LEAF_1]).toBe(
          `pty-live-${index}`
        )
        expect(mockStoreState.queuePaneAccountRestarts).toHaveBeenCalledWith(
          [`pty-live-${index}`],
          'claude'
        )
      })
    })

    it('keeps the handed-back pane resumable so a later restore carries its resume command', async () => {
      const { connectPanePty } = await import('../connect-pane-pty')
      const agentTitleMocks =
        await vi.importMock<PtyConnectionAgentTitleMocks>('@/lib/agent-status')
      installRestartStoreActions()
      addRestartingTab('tab-agent-resume')
      transportFactoryQueue.push(createMockTransport('pty-unsent'))
      const deps = createDeps({
        tabId: 'tab-agent-resume',
        startup: claudeRestartStartup('5510c93a-0000-4000-8000-000000000000'),
        replacesPtyId: 'pty-live'
      })
      const args = mockPanePtyArgs(createPane(1), createManager(1), deps)
      bindPaneAgentTitleMocks(args[2], agentTitleMocks)

      connectPanePty(...args).dispose()
      await flushAsyncTicks()

      expect(
        mockStoreState.sleepingAgentSessionsByPaneKey[`tab-agent-resume:${LEAF_1}`]
      ).toMatchObject({
        agent: 'claude',
        tabId: 'tab-agent-resume',
        providerSession: { id: '5510c93a-0000-4000-8000-000000000000' }
      })
    })

    it('stops the replaced PTY when another PTY has since taken the pane', async () => {
      const { connectPanePty } = await import('../connect-pane-pty')
      const agentTitleMocks =
        await vi.importMock<PtyConnectionAgentTitleMocks>('@/lib/agent-status')
      installRestartStoreActions()
      addRestartingTab('tab-agent-taken')
      const layout = mockStoreState.terminalLayoutsByTabId?.['tab-agent-taken']
      if (layout) {
        layout.ptyIdsByLeafId = { [LEAF_1]: 'pty-newer' }
      }
      transportFactoryQueue.push(createMockTransport('pty-unsent'))
      const deps = createDeps({
        tabId: 'tab-agent-taken',
        startup: claudeRestartStartup('session-taken'),
        replacesPtyId: 'pty-old'
      })
      const args = mockPanePtyArgs(createPane(1), createManager(1), deps)
      bindPaneAgentTitleMocks(args[2], agentTitleMocks)

      connectPanePty(...args).dispose()
      await flushAsyncTicks()

      expect(window.api.pty.kill).toHaveBeenCalledWith('pty-old')
      expect(mockStoreState.queuePaneAccountRestarts).not.toHaveBeenCalled()
    })
  })
}
