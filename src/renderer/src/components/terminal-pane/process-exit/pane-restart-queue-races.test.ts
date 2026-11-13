import { bindPtyConnectionTestMocks } from '../pty-connection/test-fixtures/pty-connection-mocks.spec'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement, useSyncExternalStore } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Window } from 'happy-dom'
import type { AppState } from '@/store/types'
import { flushAsyncTicks } from '../pty-connection/test-fixtures/pty-connection-test-async'
import {
  createMockTransport,
  createPane,
  createManager,
  LEAF_1,
  LEAF_2,
  type MockTransport
} from '../pty-connection/test-fixtures/pty-connection-test-pane-fixtures'
import { buildPaneConnectionDeps } from '../pty-connection/test-fixtures/pty-connection-test-deps'
import { createInitialStoreState } from '../pty-connection/test-fixtures/pty-connection-test-store-fixtures'
import type { StoreState } from '../pty-connection/test-fixtures/pty-connection-test-store-state'
import {
  installTerminalTestGlobals,
  restoreTerminalTestGlobals
} from '../pty-connection/test-fixtures/pty-connection-test-environment'
import type { PtyTransport } from '../pty-transport/pty-transport-types'
import {
  appendPaneTerminalError,
  type TerminalErrorsByPaneId
} from '../errors/terminal-error-accumulation'
import { mockPanePtyArgs } from '../pty-connection/test-fixtures/pty-connection-test-connect-mock-pane'
import { noteUnsentRestartHandoff, recordQueuedPaneAccountRestart } from './unsent-restart-handoff'

vi.unmock('react')

describe('restart queue races', () => {
  let state: StoreState & Required<Pick<StoreState, 'ptyIdsByTabId' | 'terminalLayoutsByTabId'>>
  let transports: MockTransport[]
  let transportOptions: Record<string, unknown>[]
  let roots: Root[]
  let currentAccount: string
  let subscribers: ((state: StoreState) => void)[]

  beforeEach(async () => {
    vi.clearAllMocks()
    transports = []
    transportOptions = []
    subscribers = []
    roots = []
    currentAccount = 'account-b'
    state = {
      ...createInitialStoreState(() => state),
      ptyIdsByTabId: {},
      pendingPaneAccountRestarts: {},
      terminalLayoutsByTabId: {}
    }
    bindPtyConnectionTestMocks({
      getState: () => state,
      getTransportQueue: () => transports,
      getTransportOptions: () => transportOptions,
      getStoreSubscribers: () => subscribers,
      setStoreSubscribers: (next) => {
        subscribers = next
      }
    })
    await installTerminalTestGlobals()
    const dom = new Window()
    Object.assign(dom, { api: window.api })
    vi.stubGlobal('window', dom)
    vi.stubGlobal('document', dom.document)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const subscribe = (listener: () => void) => {
      subscribers.push(listener)
      return () => {
        subscribers = subscribers.filter((entry) => entry !== listener)
      }
    }
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the terminal fixture supplies all state and actions read by the restart hooks.
    const getState = () => state as unknown as AppState
    vi.doMock('@/store/index', () => ({
      useAppStore: Object.assign(
        (selector: (value: AppState) => unknown) =>
          useSyncExternalStore(subscribe, () => selector(getState())),
        { getState, subscribe }
      )
    }))
    Object.assign(state, {
      consumeSuppressedPtyExit: vi.fn(() => false),
      isPtyShutdownPending: vi.fn(() => false),
      replaceTerminalLayoutPanePtyId: vi.fn(),
      remountTerminalTabForRecovery: vi.fn(() => {
        state.tabsByWorktree['wt-1'][0].generation = 1
        publish()
        return { remounted: true }
      }),
      queuePaneAccountRestarts: vi.fn((ptyIds: string[], agent: 'claude' | 'codex') => {
        queueAccountSwitch(ptyIds, agent)
      }),
      consumePendingPaneAccountRestart: vi.fn((ptyId: string) => {
        const agent = state.pendingPaneAccountRestarts?.[ptyId] ?? null
        delete state.pendingPaneAccountRestarts?.[ptyId]
        publish()
        return agent
      })
    })
    state.tabsByWorktree['wt-1'] = [{ id: 'tab-1', ptyId: 'pty-first' }]
    state.ptyIdsByTabId['tab-1'] = ['pty-first', 'pty-old']
    state.terminalLayoutsByTabId['tab-1'] = {
      root: {
        type: 'split',
        direction: 'vertical',
        first: { type: 'leaf', leafId: LEAF_1 },
        second: { type: 'leaf', leafId: LEAF_2 }
      },
      activeLeafId: LEAF_2,
      expandedLeafId: null,
      ptyIdsByLeafId: { [LEAF_1]: 'pty-first', [LEAF_2]: 'pty-old' }
    }
  })

  function queueAccountSwitch(ptyIds: string[], agent: 'claude' | 'codex') {
    for (const ptyId of ptyIds) {
      recordQueuedPaneAccountRestart(ptyId)
    }
    state.pendingPaneAccountRestarts = {
      ...state.pendingPaneAccountRestarts,
      ...Object.fromEntries(ptyIds.map((id) => [id, agent]))
    }
    publish()
  }

  function successfulTransport(ptyId: string) {
    const transport = createMockTransport(ptyId)
    transport.connect.mockImplementation(async (options) => {
      options.claimReplacedPtyId?.()
      return { id: ptyId }
    })
    return transport
  }

  function publish() {
    for (const listener of subscribers) {
      listener(state)
    }
  }

  afterEach(async () => {
    await act(async () => {
      for (const root of roots) {
        root.unmount()
      }
      state.tabsByWorktree = {}
      publish()
      await flushAsyncTicks(30)
    })
    await restoreTerminalTestGlobals()
    vi.unstubAllGlobals()
    vi.doUnmock('@/store/index')
  })

  async function mountRestartPane(oldPtyId = 'pty-old') {
    const { usePaneProcessRestart } = await import('./use-pane-process-restart')
    const { useReadyPaneAccountRestarts } =
      await import('../account-restart/use-ready-pane-account-restarts')
    const oldTransport = createMockTransport(oldPtyId)
    oldTransport.detach = vi.fn()
    const pane = createPane(2)
    const manager = createManager(2)
    const deps = buildPaneConnectionDeps(() => state, {
      clearTabPtyId: vi.fn((tabId: string, ptyId: string) => {
        state.ptyIdsByTabId[tabId] = state.ptyIdsByTabId[tabId].filter((id) => id !== ptyId)
      }),
      clearExitedPanePtyLayoutBinding: vi.fn((_: number, ptyId: string) => {
        const bindings = state.terminalLayoutsByTabId['tab-1'].ptyIdsByLeafId!
        if (bindings[LEAF_2] === ptyId) {
          delete bindings[LEAF_2]
        }
      }),
      syncPanePtyLayoutBinding: vi.fn((_: number, ptyId: string | null) => {
        const layout = state.terminalLayoutsByTabId['tab-1']
        if (ptyId) {
          layout.ptyIdsByLeafId![LEAF_2] = ptyId
        } else {
          delete layout.ptyIdsByLeafId![LEAF_2]
        }
      })
    })
    const [, typedManager, typedDeps] = mockPanePtyArgs(pane, manager, deps)
    const firstPane = createPane(1)
    manager.getPanes.mockImplementation(() => [firstPane, pane].map((entry) => ({ ...entry })))
    deps.paneTransportsRef.current.set(1, createMockTransport('pty-first'))
    deps.paneTransportsRef.current.set(2, oldTransport)
    let errors: TerminalErrorsByPaneId = {}
    const restartDeps: Parameters<typeof usePaneProcessRestart>[0] = {
      ...typedDeps,
      clearTabPtyId: (tabId, ptyId) => {
        if (ptyId) {
          typedDeps.clearTabPtyId(tabId, ptyId)
        }
      },
      cwd: '/tmp/wt-1',
      managerRef: { current: typedManager },
      panePtyBindingsRef: { current: new Map() },
      clearCodexRestartNotice: vi.fn(),
      suppressPtyExit: vi.fn(),
      handlePaneProcessDied: vi.fn(),
      onPtyErrorRef: {
        current: (paneId, message) => {
          errors = appendPaneTerminalError(errors, paneId, message)
        }
      },
      onPtyErrorClearedRef: { current: vi.fn() },
      onPtyRecoveryStateRef: { current: vi.fn() },
      setTerminalError: vi.fn(),
      setTerminalErrorsByPaneId: (update) => {
        errors = typeof update === 'function' ? update(errors) : update
      },
      showRestoredSessionBanner: vi.fn()
    }
    let restart: ReturnType<typeof usePaneProcessRestart> | undefined
    function RestartHarness() {
      restart = usePaneProcessRestart(restartDeps)
      useReadyPaneAccountRestarts({
        managerRef: restartDeps.managerRef,
        paneTransportsRef: restartDeps.paneTransportsRef,
        tabId: 'tab-1',
        panePtyLayoutBindings: state.terminalLayoutsByTabId['tab-1']?.ptyIdsByLeafId,
        consumePendingPaneAccountRestart: (ptyId) => {
          const agent = state.pendingPaneAccountRestarts?.[ptyId] ?? null
          delete state.pendingPaneAccountRestarts?.[ptyId]
          publish()
          return agent
        },
        buildAccountRestartStartup: () => ({
          command: 'claude',
          launchAgent: 'claude',
          startupCommandDelivery: 'shell-ready',
          env: { CLAUDE_CONFIG_DIR: currentAccount },
          resumeProviderSession: { key: 'session_id', id: 'claude-session' }
        }),
        handleRestartPane: restart.handleRestartPane
      })
      return null
    }
    const root = createRoot(document.createElement('div'))
    roots.push(root)
    await act(async () => {
      root.render(createElement(RestartHarness))
    })
    return {
      restart: restart!,
      restartDeps,
      transportsByPaneId: deps.paneTransportsRef.current,
      manager,
      pane,
      oldTransport,
      getErrors: () => errors,
      rerender: async () => {
        await act(async () => {
          root.render(createElement(RestartHarness))
        })
      },
      unmount: async () => {
        await act(async () => {
          root.unmount()
          roots = roots.filter((entry) => entry !== root)
          for (const binding of restartDeps.panePtyBindingsRef.current.values()) {
            binding.dispose()
          }
          restartDeps.managerRef.current = null
        })
      }
    }
  }

  it('keeps the frozen Claude startup when an unsent hand-back requeues the move', async () => {
    const heldFrames: FrameRequestCallback[] = []
    const firstLookup = Promise.withResolvers<null>()
    const drainedLookup = Promise.withResolvers<null>()
    window.api.pty.findAgentSessionHolder = vi
      .fn()
      .mockResolvedValue(null)
      .mockReturnValueOnce(firstLookup.promise)
      .mockReturnValueOnce(drainedLookup.promise)
    // The parked spawn installs its transport before connect; the remount needs its own.
    const parked = successfulTransport('pty-parked')
    const successor = successfulTransport('pty-switched')
    transports.push(parked)
    const mounted = await mountRestartPane()
    currentAccount = 'account-b'
    await act(async () => {
      queueAccountSwitch(['pty-old'], 'claude')
    })
    vi.mocked(requestAnimationFrame).mockImplementation((callback) => {
      heldFrames.push(callback)
      return heldFrames.length
    })
    await act(async () => {
      firstLookup.resolve(null)
      await flushAsyncTicks(10)
    })
    expect(parked.connect).not.toHaveBeenCalled()
    currentAccount = 'account-c'
    await act(async () => {
      queueAccountSwitch(['pty-old'], 'claude')
    })
    expect(state.pendingPaneAccountRestarts).toEqual({})
    currentAccount = 'account-d'
    await mounted.unmount()
    expect(state.pendingPaneAccountRestarts).toEqual({ 'pty-old': 'claude' })

    vi.mocked(requestAnimationFrame).mockImplementation((callback) => {
      callback(0)
      return 1
    })
    transports.push(successor)
    const remounted = await mountRestartPane()
    await act(async () => {
      drainedLookup.resolve(null)
      await flushAsyncTicks(30)
    })
    expect(parked.connect).not.toHaveBeenCalled()
    expect(successor.connect).toHaveBeenCalledTimes(1)
    expect(transportOptions.map((options) => options.env)).toEqual([
      expect.objectContaining({ CLAUDE_CONFIG_DIR: 'account-b' }),
      expect.objectContaining({ CLAUDE_CONFIG_DIR: 'account-c' })
    ])
    await remounted.unmount()
  })

  it('ignores an unsent Claude hand-back and still runs a newer switch behind the drained startup', async () => {
    const spawning = Promise.withResolvers<{ id: string }>()
    const first = createMockTransport('pty-intermediate')
    first.detach = vi.fn()
    first.connect.mockImplementation((options: Parameters<PtyTransport['connect']>[0]) => {
      options.claimReplacedPtyId?.()
      return spawning.promise
    })
    const drainedLookup = Promise.withResolvers<null>()
    window.api.pty.findAgentSessionHolder = vi.fn().mockReturnValue(drainedLookup.promise)
    const successor = successfulTransport('pty-switched')
    const newer = successfulTransport('pty-newer')
    transports.push(first, successor, newer)
    const mounted = await mountRestartPane()
    mounted.restart.handleRestartPane(2, { command: 'sh' }, { focus: false })
    await flushAsyncTicks()
    currentAccount = 'account-c'
    await act(async () => {
      queueAccountSwitch(['pty-old'], 'claude')
    })
    expect(state.pendingPaneAccountRestarts).toEqual({})
    await act(async () => {
      spawning.resolve({ id: 'pty-intermediate' })
      await flushAsyncTicks(20)
    })
    expect(successor.connect).not.toHaveBeenCalled()
    currentAccount = 'account-d'
    noteUnsentRestartHandoff('pty-old')
    await act(async () => {
      queueAccountSwitch(['pty-old'], 'claude')
    })
    currentAccount = 'account-e'
    await act(async () => {
      queueAccountSwitch(['pty-old'], 'claude')
    })
    await act(async () => {
      drainedLookup.resolve(null)
      await flushAsyncTicks(40)
    })
    expect(successor.connect).toHaveBeenCalledTimes(1)
    expect(newer.connect).toHaveBeenCalledTimes(1)
    expect(transportOptions.map((options) => options.env)).toEqual([
      expect.not.objectContaining({ CLAUDE_CONFIG_DIR: expect.anything() }),
      expect.objectContaining({ CLAUDE_CONFIG_DIR: 'account-c' }),
      expect.objectContaining({ CLAUDE_CONFIG_DIR: 'account-e' })
    ])
    await mounted.unmount()
  })

  it('keeps a queued Claude switch when the tab moves to another worktree bucket', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const lookup = Promise.withResolvers<null>()
    window.api.pty.findAgentSessionHolder = vi
      .fn()
      .mockResolvedValue(null)
      .mockReturnValueOnce(lookup.promise)
    const successor = successfulTransport('pty-switched')
    transports.push(successor)
    const mounted = await mountRestartPane()
    await act(async () => {
      queueAccountSwitch(['pty-old'], 'claude')
    })
    const [tab] = state.tabsByWorktree['wt-1']
    state.tabsByWorktree = { 'wt-2': [tab] }
    await act(async () => {
      publish()
    })
    await act(async () => {
      lookup.resolve(null)
      await flushAsyncTicks(30)
    })
    expect(warn).not.toHaveBeenCalledWith(
      '[terminal] discarded pending pane restart: pane removed',
      expect.anything()
    )
    expect(state.terminalLayoutsByTabId['tab-1'].ptyIdsByLeafId?.[LEAF_2]).toBe('pty-switched')
    await mounted.unmount()
  })
})
