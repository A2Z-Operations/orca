import { bindPtyConnectionTestMocks } from '../test-fixtures/pty-connection-mocks.spec'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushAsyncTicks } from '../test-fixtures/pty-connection-test-async'
import { mainLayoutApplyTransport } from '../test-fixtures/pty-connection-test-main-pane-start-fixtures'
import {
  createMockTransport,
  createPane,
  createManager,
  LEAF_1,
  LEAF_2,
  type MockTransport
} from '../test-fixtures/pty-connection-test-pane-fixtures'
import {
  buildPaneConnectionDeps,
  type PtyConnectionAgentTitleMocks,
  bindPaneAgentTitleMocks
} from '../test-fixtures/pty-connection-test-deps'
import { createInitialStoreState } from '../test-fixtures/pty-connection-test-store-fixtures'
import type { StoreState } from '../test-fixtures/pty-connection-test-store-state'
import { formatAgentSessionHeldRefusal } from '../../../../../../shared/agent-session/lifecycle/held-agent-session-refusal'

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

      // Closing the tab disposes the pane before its deferred connect runs (a parked tab hands it back).
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

    /** A two-pane tab whose second pane is restarting; `closed` is the user having closed that pane. */
    function addRestartingSplitTab(tabId: string, options: { closed: boolean }): void {
      mockStoreState.tabsByWorktree['wt-1'].push({ id: tabId, ptyId: 'pty-first' })
      mockStoreState.terminalLayoutsByTabId = {
        ...mockStoreState.terminalLayoutsByTabId,
        [tabId]: {
          root: options.closed
            ? { type: 'leaf', leafId: LEAF_1 }
            : {
                type: 'split',
                direction: 'vertical',
                first: { type: 'leaf', leafId: LEAF_1 },
                second: { type: 'leaf', leafId: LEAF_2 }
              },
          activeLeafId: LEAF_1,
          expandedLeafId: null,
          // The restart already dropped the second pane's binding.
          ptyIdsByLeafId: { [LEAF_1]: 'pty-first' }
        }
      }
    }

    async function disposeUnsentSplitRestart(tabId: string) {
      const { connectPanePty } = await import('../connect-pane-pty')
      const agentTitleMocks =
        await vi.importMock<PtyConnectionAgentTitleMocks>('@/lib/agent-status')
      transportFactoryQueue.push(createMockTransport('pty-unsent'))
      const deps = createDeps({
        tabId,
        startup: claudeRestartStartup('session-split'),
        replacesPtyId: 'pty-second'
      })
      const args = mockPanePtyArgs(createPane(2), createManager(2), deps)
      bindPaneAgentTitleMocks(args[2], agentTitleMocks)
      connectPanePty(...args).dispose()
      await flushAsyncTicks()
      return deps
    }

    it('stops the agent of a split pane the user closed while its restart was unsent', async () => {
      installRestartStoreActions()
      addRestartingSplitTab('tab-split-closed', { closed: true })

      const deps = await disposeUnsentSplitRestart('tab-split-closed')

      expect(window.api.pty.kill).toHaveBeenCalledWith('pty-second')
      expect(mockStoreState.queuePaneAccountRestarts).not.toHaveBeenCalled()
      expect(deps.updateTabPtyId).not.toHaveBeenCalled()
      // No binding is written for a pane the layout no longer has.
      expect(mockStoreState.terminalLayoutsByTabId?.['tab-split-closed']?.ptyIdsByLeafId).toEqual({
        [LEAF_1]: 'pty-first'
      })
    })

    it('hands a split pane its live agent back while that pane is still in the layout', async () => {
      installRestartStoreActions()
      addRestartingSplitTab('tab-split-open', { closed: false })

      const deps = await disposeUnsentSplitRestart('tab-split-open')

      expect(window.api.pty.kill).not.toHaveBeenCalled()
      expect(deps.updateTabPtyId).toHaveBeenCalledWith('tab-split-open', 'pty-second')
      expect(mockStoreState.terminalLayoutsByTabId?.['tab-split-open']?.ptyIdsByLeafId).toEqual({
        [LEAF_1]: 'pty-first',
        [LEAF_2]: 'pty-second'
      })
      expect(mockStoreState.queuePaneAccountRestarts).toHaveBeenCalledWith(['pty-second'], 'claude')
    })

    it('leaves the old PTY of a refused mounted restart bound to its pane, with nothing queued again', async () => {
      const { connectPanePty } = await import('../connect-pane-pty')
      const agentTitleMocks =
        await vi.importMock<PtyConnectionAgentTitleMocks>('@/lib/agent-status')
      installRestartStoreActions()
      addRestartingTab('tab-agent-refused')
      const transport = createMockTransport(null)
      // As the IPC transport: main refused the held session before stopping the claimed PTY.
      transport.connect.mockImplementation(
        async (opts: {
          claimReplacedPtyId?: () => string | null
          onReplacedPtyKept?: (ptyId: string) => void
          callbacks: { onError?: (message: string) => void }
        }) => {
          const claimed = opts.claimReplacedPtyId?.()
          if (claimed) {
            opts.onReplacedPtyKept?.(claimed)
          }
          opts.callbacks.onError?.(
            'agent_session_held_by_live_terminal: This agent session is still running in the terminal "Z8 Features" (pty pty-holder).'
          )
          return undefined
        }
      )
      transportFactoryQueue.push(transport)
      const deps = createDeps({
        tabId: 'tab-agent-refused',
        startup: claudeRestartStartup('session-refused'),
        replacesPtyId: 'pty-live'
      })
      const args = mockPanePtyArgs(createPane(1), createManager(1), deps)
      bindPaneAgentTitleMocks(args[2], agentTitleMocks)

      connectPanePty(...args)
      await flushAsyncTicks()

      expect(transport.connect).toHaveBeenCalledTimes(1)
      expect(window.api.pty.kill).not.toHaveBeenCalled()
      expect(deps.updateTabPtyId).toHaveBeenCalledWith('tab-agent-refused', 'pty-live')
      expect(
        mockStoreState.terminalLayoutsByTabId?.['tab-agent-refused']?.ptyIdsByLeafId?.[LEAF_1]
      ).toBe('pty-live')
      // A refusal is final: the account restart is not queued to run into it again.
      expect(mockStoreState.queuePaneAccountRestarts).not.toHaveBeenCalled()
    })

    it('runs the refused-anyway chain end to end: pre-check clear, spawn refused, PTY kept, remount reattaches it', async () => {
      const { connectPanePty } = await import('../connect-pane-pty')
      const { restartUnlessSessionHeld } =
        await import('../../process-exit/restart-unless-session-held')
      const ipcTransportModule = await import('../../pty-transport/ipc/pty-transport')
      const realIpcTransport = await vi.importActual<typeof ipcTransportModule>(
        '../../pty-transport/ipc/pty-transport'
      )
      const agentTitleMocks =
        await vi.importMock<PtyConnectionAgentTitleMocks>('@/lib/agent-status')
      installRestartStoreActions()
      addRestartingTab('tab-agent-race')
      const sessionId = '7a1c0de5-0000-4000-8000-000000000000'
      // Main's wire format: another terminal took the session after the pre-check answered.
      const refusal = formatAgentSessionHeldRefusal('pty-holder', 'Z8 Features')
      const spawn = vi
        .fn()
        .mockRejectedValueOnce(
          new Error(`Error invoking remote method 'pty:spawn': Error: ${refusal}`)
        )
      Object.assign(window.api.pty, {
        spawn,
        onData: vi.fn(() => () => {}),
        onReplay: vi.fn(() => () => {}),
        onExit: vi.fn(() => () => {})
      })
      // The real IPC transport, so the refusal travels through its spawn request.
      vi.mocked(ipcTransportModule.createIpcPtyTransport).mockImplementationOnce((options) =>
        realIpcTransport.createIpcPtyTransport(options)
      )
      const deps = createDeps({
        tabId: 'tab-agent-race',
        startup: claudeRestartStartup(sessionId),
        replacesPtyId: 'pty-live'
      })
      let connection: ReturnType<typeof connectPanePty> | null = null
      const findHolder = vi.fn(async () => null)
      const refuse = vi.fn()

      restartUnlessSessionHeld({
        replacesPtyId: 'pty-live',
        resumeProviderSession: { key: 'session_id', id: sessionId },
        findHolder,
        isStillCurrent: () => true,
        restart: () => {
          const args = mockPanePtyArgs(createPane(1), createManager(1), deps)
          bindPaneAgentTitleMocks(args[2], agentTitleMocks)
          connection = connectPanePty(...args)
        },
        refuse
      })
      await flushAsyncTicks()
      await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(1))
      await flushAsyncTicks()

      // The pre-check saw no holder, so the restart ran; main refused before stopping anything.
      expect(findHolder).toHaveBeenCalledWith({
        resumeProviderSession: { key: 'session_id', id: sessionId },
        replacesPtyId: 'pty-live'
      })
      expect(refuse).not.toHaveBeenCalled()
      expect(spawn).toHaveBeenCalledWith(expect.objectContaining({ replacesPtyId: 'pty-live' }))
      // The kept PTY is bound to its pane again and nothing stops it or queues the restart again.
      expect(window.api.pty.kill).not.toHaveBeenCalled()
      expect(deps.updateTabPtyId).toHaveBeenCalledWith('tab-agent-race', 'pty-live')
      expect(
        mockStoreState.terminalLayoutsByTabId?.['tab-agent-race']?.ptyIdsByLeafId?.[LEAF_1]
      ).toBe('pty-live')
      expect(mockStoreState.queuePaneAccountRestarts).not.toHaveBeenCalled()

      // Remount (a tab switch): the old connection's dispose finds no unsent claim left to stop.
      connection!.dispose()
      await flushAsyncTicks()
      expect(window.api.pty.kill).not.toHaveBeenCalled()

      const remountTransport = createMockTransport(null)
      transportFactoryQueue.push(remountTransport)
      const remountDeps = createDeps({
        tabId: 'tab-agent-race',
        restoredLeafId: LEAF_1,
        restoredPtyIdByLeafId: { [LEAF_1]: 'pty-live' }
      })
      const remountArgs = mockPanePtyArgs(createPane(1), createManager(1), remountDeps)
      bindPaneAgentTitleMocks(remountArgs[2], agentTitleMocks)
      connectPanePty(...remountArgs)
      await flushAsyncTicks()

      // The pane reattaches the agent that kept running; no second resume spawn, nothing stopped.
      const reattached =
        remountTransport.attach.mock.calls.some(([opts]) => opts.existingPtyId === 'pty-live') ||
        remountTransport.connect.mock.calls.some(
          (call) => (call[0] as { sessionId?: string } | undefined)?.sessionId === 'pty-live'
        )
      expect(reattached).toBe(true)
      expect(spawn).toHaveBeenCalledTimes(1)
      expect(window.api.pty.kill).not.toHaveBeenCalled()
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
