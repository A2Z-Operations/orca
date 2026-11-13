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

vi.unmock('react')

describe('restart pane persistence', () => {
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
        state.pendingPaneAccountRestarts = {
          ...state.pendingPaneAccountRestarts,
          ...Object.fromEntries(ptyIds.map((id) => [id, agent]))
        }
        publish()
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

  it('checkpoints the old PTY before deferred restart spawn and reattaches it on the next window', async () => {
    const { connectPanePty } = await import('../pty-connection/connect-pane-pty')
    const immediateFrame = vi.mocked(requestAnimationFrame).getMockImplementation()!
    vi.mocked(requestAnimationFrame).mockReturnValue(1)
    const replacementTransport = createMockTransport(null)
    transports.push(replacementTransport)
    const { restart, unmount } = await mountRestartPane()
    restart.handleRestartPane(2, { command: 'claude', launchAgent: 'claude' }, { focus: false })

    // Quit saves this snapshot before the deferred connect or disposal hand-back can run.
    const savedLayout = structuredClone(state.terminalLayoutsByTabId['tab-1'])
    const savedTabPtys = [...state.ptyIdsByTabId['tab-1']]
    expect(savedLayout.ptyIdsByLeafId).toEqual({ [LEAF_1]: 'pty-first', [LEAF_2]: 'pty-old' })
    expect(savedTabPtys).toEqual(['pty-first', 'pty-old'])
    expect(replacementTransport.connect).not.toHaveBeenCalled()

    await unmount()
    await flushAsyncTicks()
    vi.mocked(requestAnimationFrame).mockImplementation(immediateFrame)
    state.terminalLayoutsByTabId['tab-1'] = savedLayout
    state.ptyIdsByTabId['tab-1'] = savedTabPtys
    const restoredTransport = createMockTransport(null)
    transports.push(restoredTransport)
    const restoredDeps = buildPaneConnectionDeps(() => state, {
      restoredLeafId: LEAF_2,
      restoredPtyIdByLeafId: savedLayout.ptyIdsByLeafId
    })
    const binding = connectPanePty(
      ...mockPanePtyArgs(createPane(2), createManager(2), restoredDeps)
    )
    await flushAsyncTicks()
    expect(restoredTransport.getPtyId()).toBe('pty-old')
    expect(window.api.pty.kill).not.toHaveBeenCalled()
    binding.dispose()
  })

  it('retires the stopped predecessor from the saved layout after replacement spawn fails', async () => {
    const { spawnIpcPty } = await import('../pty-transport/ipc/ipc-pty-spawn-request')
    window.api.pty.spawn = vi.fn().mockRejectedValue(new Error('ENOENT'))
    window.api.pty.hasPty = vi.fn().mockResolvedValue(false)
    const replacement = createMockTransport(null)
    replacement.detach = vi.fn()
    replacement.connect = vi
      .fn()
      .mockImplementation((options: Parameters<PtyTransport['connect']>[0]) =>
        spawnIpcPty({}, options)
      )
    transports.push(replacement)
    const { restart, restartDeps, getErrors } = await mountRestartPane()
    restart.handleRestartPane(2, { command: 'claude', launchAgent: 'claude' }, { focus: false })
    await flushAsyncTicks()

    expect(state.terminalLayoutsByTabId['tab-1'].ptyIdsByLeafId).toEqual({
      [LEAF_1]: 'pty-first'
    })
    expect(state.ptyIdsByTabId['tab-1']).toEqual(['pty-first'])
    expect(getErrors()[2]).toEqual([{ message: expect.any(String), resourceLimit: false }])
    restartDeps.panePtyBindingsRef.current.get(2)?.dispose()
  })

  it.each([true, false])(
    'refuses a concurrent restart until predecessor liveness settles as %s',
    async (live) => {
      const { spawnIpcPty } = await import('../pty-transport/ipc/ipc-pty-spawn-request')
      const liveness = Promise.withResolvers<boolean>()
      window.api.pty.spawn = vi.fn().mockRejectedValue(new Error('ENOENT'))
      window.api.pty.hasPty = vi.fn(() => liveness.promise)
      const replacement = createMockTransport(null)
      replacement.detach = vi.fn()
      replacement.connect = vi
        .fn()
        .mockImplementation((options: Parameters<PtyTransport['connect']>[0]) =>
          spawnIpcPty({}, options)
        )
      let retriedPredecessor: string | null | undefined
      const successor = createMockTransport('pty-new')
      successor.connect = vi
        .fn()
        .mockImplementation(async (options: Parameters<PtyTransport['connect']>[0]) => {
          retriedPredecessor = options.claimReplacedPtyId?.() ?? null
          return { id: 'pty-new' }
        })
      transports.push(replacement, successor)
      const { restart, restartDeps, getErrors } = await mountRestartPane()
      restart.handleRestartPane(2, { command: 'claude', launchAgent: 'claude' }, { focus: false })
      await flushAsyncTicks()
      expect(window.api.pty.hasPty).toHaveBeenCalledWith('pty-old')
      restart.handleRestartPane(2, { command: 'sh' }, { focus: false })
      await flushAsyncTicks()

      expect(restartDeps.paneTransportsRef.current.get(2)).toBe(replacement)
      expect(state.terminalLayoutsByTabId['tab-1'].ptyIdsByLeafId).toEqual({
        [LEAF_1]: 'pty-first',
        [LEAF_2]: 'pty-old'
      })
      expect(state.ptyIdsByTabId['tab-1']).toEqual(['pty-first', 'pty-old'])
      expect(getErrors()[2]).toEqual([{ message: expect.any(String), resourceLimit: false }])

      liveness.resolve(live)
      await flushAsyncTicks(30)
      restart.handleRestartPane(2, { command: 'sh' }, { focus: false })
      await flushAsyncTicks()
      expect(restartDeps.paneTransportsRef.current.get(2)).toBe(successor)
      expect(retriedPredecessor).toBe(live ? 'pty-old' : null)
      restartDeps.panePtyBindingsRef.current.get(2)?.dispose()
    }
  )

  it('commits a successful secondary-pane replacement without keeping the old tab identity', async () => {
    const { connectPanePty } = await import('../pty-connection/connect-pane-pty')
    const transport = createMockTransport('pty-new')
    transport.connect.mockImplementation(async (options) => {
      if (typeof options.claimReplacedPtyId === 'function') {
        options.claimReplacedPtyId()
      }
      return { id: 'pty-new' }
    })
    transports.push(transport)
    const deps = buildPaneConnectionDeps(() => state, {
      startup: { command: 'claude', launchAgent: 'claude' },
      replacesPtyId: 'pty-old'
    })
    const binding = connectPanePty(...mockPanePtyArgs(createPane(2), createManager(2), deps))
    await flushAsyncTicks()
    expect(state.terminalLayoutsByTabId['tab-1'].ptyIdsByLeafId).toEqual({
      [LEAF_1]: 'pty-first',
      [LEAF_2]: 'pty-new'
    })
    expect(state.ptyIdsByTabId['tab-1']).toEqual(['pty-first', 'pty-new'])
    binding.dispose()
  })

  it.each([
    { switches: ['account-b'], expectedAccount: 'account-b' },
    { switches: ['account-b', 'account-c'], expectedAccount: 'account-c' }
  ])(
    'applies only $expectedAccount after an in-flight restart',
    async ({ switches, expectedAccount }) => {
      const spawning = Promise.withResolvers<{ id: string }>()
      const first = createMockTransport('pty-intermediate')
      first.detach = vi.fn()
      first.connect.mockImplementation((options: Parameters<PtyTransport['connect']>[0]) => {
        options.claimReplacedPtyId?.()
        return spawning.promise
      })
      const successor = successfulTransport('pty-switched')
      successor.connect.mockImplementation(
        async (options: Parameters<PtyTransport['connect']>[0]) => {
          options.claimReplacedPtyId?.()
          return { id: 'pty-switched' }
        }
      )
      transports.push(first, successor)
      const { restart, restartDeps } = await mountRestartPane()
      restart.handleRestartPane(2, { command: 'codex' }, { focus: false })
      await flushAsyncTicks()

      for (const account of switches) {
        restart.handleRestartPane(
          2,
          { command: 'codex', env: { CODEX_HOME: account } },
          { focus: false, queueIfRestarting: true }
        )
      }
      expect(transportOptions.map((options) => options.env)).toEqual([
        expect.not.objectContaining({ CODEX_HOME: expect.anything() })
      ])

      spawning.resolve({ id: 'pty-intermediate' })
      await flushAsyncTicks(30)
      expect(transportOptions.map((options) => options.env)).toEqual([
        expect.not.objectContaining({ CODEX_HOME: expect.anything() }),
        expect.objectContaining({ CODEX_HOME: expectedAccount })
      ])
      expect(state.terminalLayoutsByTabId['tab-1'].ptyIdsByLeafId).toEqual({
        [LEAF_1]: 'pty-first',
        [LEAF_2]: 'pty-switched'
      })
      expect(state.ptyIdsByTabId['tab-1']).toEqual(['pty-first', 'pty-switched'])
      restartDeps.panePtyBindingsRef.current.get(2)?.dispose()
    }
  )

  it.each([
    { live: true, expectedPtys: ['pty-first', 'pty-old'] },
    { live: false, expectedPtys: ['pty-first'] }
  ])(
    'keeps the pending switch failure visible when predecessor liveness is $live',
    async ({ live, expectedPtys }) => {
      const { spawnIpcPty } = await import('../pty-transport/ipc/ipc-pty-spawn-request')
      const liveness = Promise.withResolvers<boolean>()
      window.api.pty.spawn = vi.fn().mockRejectedValue(new Error('ENOENT'))
      window.api.pty.hasPty = vi.fn(() => liveness.promise)
      for (let index = 0; index < 2; index += 1) {
        const transport = createMockTransport(null)
        transport.detach = vi.fn()
        transport.connect = vi
          .fn()
          .mockImplementation(async (options: Parameters<PtyTransport['connect']>[0]) => {
            try {
              return await spawnIpcPty({}, options)
            } catch (error) {
              options.callbacks?.onError?.('ENOENT')
              throw error
            }
          })
        transports.push(transport)
      }
      const { restart, restartDeps, getErrors } = await mountRestartPane()
      restart.handleRestartPane(2, { command: 'codex' }, { focus: false })
      await flushAsyncTicks()
      restart.handleRestartPane(
        2,
        { command: 'codex', env: { CODEX_HOME: 'account-b' } },
        { focus: false, queueIfRestarting: true }
      )
      expect(transportOptions.map((options) => options.env)).toEqual([
        expect.not.objectContaining({ CODEX_HOME: expect.anything() })
      ])

      liveness.resolve(live)
      await flushAsyncTicks(40)
      expect(transportOptions.map((options) => options.env)).toEqual([
        expect.not.objectContaining({ CODEX_HOME: expect.anything() }),
        expect.objectContaining({ CODEX_HOME: 'account-b' })
      ])
      expect(getErrors()[2]).toEqual(
        expect.arrayContaining([{ message: 'ENOENT', resourceLimit: false }])
      )
      expect(state.ptyIdsByTabId['tab-1']).toEqual(expectedPtys)
      restartDeps.panePtyBindingsRef.current.get(2)?.dispose()
    }
  )

  it('preserves the newest layout-fallback Claude switch through unmount and remount', async () => {
    const spawning = Promise.withResolvers<{ id: string }>()
    const first = createMockTransport(null)
    first.detach = vi.fn()
    first.connect.mockImplementation(() => spawning.promise)
    transports.push(first)
    const mounted = await mountRestartPane()
    mounted.restart.handleRestartPane(2, { command: 'sh' }, { focus: false })
    await flushAsyncTicks()
    expect(first.getPtyId()).toBeNull()
    await act(async () => {
      queueAccountSwitch(['pty-old'], 'claude')
    })
    currentAccount = 'account-c'
    await act(async () => {
      queueAccountSwitch(['pty-old'], 'claude')
    })
    expect(state.pendingPaneAccountRestarts).toEqual({})
    await mounted.unmount()

    const lookup = Promise.withResolvers<null>()
    window.api.pty.findAgentSessionHolder = vi
      .fn()
      .mockResolvedValue(null)
      .mockReturnValueOnce(lookup.promise)
    const successor = successfulTransport('pty-switched')
    transports.push(successor)
    const remounted = await mountRestartPane()
    expect(window.api.pty.findAgentSessionHolder).toHaveBeenCalledWith({
      replacesPtyId: 'pty-old',
      resumeProviderSession: { key: 'session_id', id: 'claude-session' }
    })
    expect(successor.connect).not.toHaveBeenCalled()
    await act(async () => {
      lookup.resolve(null)
      await flushAsyncTicks(30)
    })
    expect(transportOptions.map((options) => options.env)).toEqual([
      expect.not.objectContaining({ CLAUDE_CONFIG_DIR: expect.anything() }),
      expect.objectContaining({ CLAUDE_CONFIG_DIR: 'account-c' })
    ])
    expect(state.terminalLayoutsByTabId['tab-1'].ptyIdsByLeafId).toEqual({
      [LEAF_1]: 'pty-first',
      [LEAF_2]: 'pty-switched'
    })
    spawning.resolve({ id: 'late-pty' })
    await flushAsyncTicks(30)
    await remounted.unmount()
  })

  it('keeps a queued Claude holder lookup ahead of kept-predecessor recovery', async () => {
    const { spawnIpcPty } = await import('../pty-transport/ipc/ipc-pty-spawn-request')
    const liveness = Promise.withResolvers<boolean>()
    const lookup = Promise.withResolvers<null>()
    window.api.pty.spawn = vi.fn().mockRejectedValue(new Error('ENOENT'))
    window.api.pty.hasPty = vi.fn(() => liveness.promise)
    window.api.pty.findAgentSessionHolder = vi
      .fn()
      .mockResolvedValue(null)
      .mockReturnValueOnce(lookup.promise)
    const first = createMockTransport(null)
    first.detach = vi.fn()
    first.connect.mockImplementation((options) => spawnIpcPty({}, options))
    const successor = successfulTransport('pty-switched')
    transports.push(first, successor)
    const mounted = await mountRestartPane()
    mounted.restart.handleRestartPane(2, { command: 'sh' }, { focus: false })
    await flushAsyncTicks(20)
    await act(async () => {
      queueAccountSwitch(['pty-old'], 'claude')
    })
    await act(async () => {
      liveness.resolve(true)
      await flushAsyncTicks(40)
    })
    expect(window.api.pty.findAgentSessionHolder).toHaveBeenCalledWith({
      replacesPtyId: 'pty-old',
      resumeProviderSession: { key: 'session_id', id: 'claude-session' }
    })
    expect(state.tabsByWorktree['wt-1'][0].generation ?? 0).toBe(0)
    expect(successor.connect).not.toHaveBeenCalled()
    await act(async () => {
      lookup.resolve(null)
      await flushAsyncTicks(30)
    })
    expect(mounted.restartDeps.paneTransportsRef.current.get(2)).toBe(successor)
    expect(state.terminalLayoutsByTabId['tab-1'].ptyIdsByLeafId?.[LEAF_2]).toBe('pty-switched')
    await mounted.unmount()
  })

  it.each(['remote:ssh@@old', 'remote:wsl@@old'])(
    'matches a Claude switch after %s loses its layout binding',
    async (oldPtyId) => {
      state.terminalLayoutsByTabId['tab-1'].ptyIdsByLeafId![LEAF_2] = oldPtyId
      state.ptyIdsByTabId['tab-1'] = ['pty-first', oldPtyId]
      const spawning = Promise.withResolvers<{ id: string }>()
      const lookup = Promise.withResolvers<null>()
      window.api.pty.findAgentSessionHolder = vi
        .fn()
        .mockResolvedValue(null)
        .mockReturnValueOnce(lookup.promise)
      const first = createMockTransport(null)
      first.connect.mockImplementation(() => spawning.promise)
      const successor = successfulTransport('remote:ssh@@switched')
      transports.push(first, successor)
      const mounted = await mountRestartPane(oldPtyId)
      mounted.restart.handleRestartPane(2, { command: 'sh' }, { focus: false })
      await flushAsyncTicks()
      expect(state.terminalLayoutsByTabId['tab-1'].ptyIdsByLeafId?.[LEAF_2]).toBeUndefined()
      await act(async () => {
        queueAccountSwitch([oldPtyId], 'claude')
      })
      expect(state.pendingPaneAccountRestarts).toEqual({})
      first.getPtyId.mockReturnValue('remote:ssh@@intermediate')
      await act(async () => {
        spawning.resolve({ id: 'remote:ssh@@intermediate' })
        await flushAsyncTicks(30)
      })
      expect(window.api.pty.findAgentSessionHolder).toHaveBeenCalledWith({
        replacesPtyId: 'remote:ssh@@intermediate',
        resumeProviderSession: { key: 'session_id', id: 'claude-session' }
      })
      await act(async () => {
        lookup.resolve(null)
        await flushAsyncTicks(30)
      })
      expect(transportOptions[1].env).toEqual(
        expect.objectContaining({ CLAUDE_CONFIG_DIR: 'account-b' })
      )
      expect(state.terminalLayoutsByTabId['tab-1'].ptyIdsByLeafId).toEqual({
        [LEAF_1]: 'pty-first',
        [LEAF_2]: 'remote:ssh@@switched'
      })
      await mounted.unmount()
    }
  )

  it('retries an unmounted Claude lookup only on the same leaf after remount', async () => {
    const oldLookup = Promise.withResolvers<null>()
    const newLookup = Promise.withResolvers<null>()
    window.api.pty.findAgentSessionHolder = vi
      .fn()
      .mockResolvedValue(null)
      .mockReturnValueOnce(oldLookup.promise)
      .mockReturnValueOnce(newLookup.promise)
    const mounted = await mountRestartPane()
    await act(async () => {
      queueAccountSwitch(['pty-old'], 'claude')
    })
    await mounted.unmount()
    const successor = successfulTransport('pty-switched')
    transports.push(successor)
    const remounted = await mountRestartPane()
    await act(async () => {
      oldLookup.resolve(null)
      await flushAsyncTicks(20)
    })
    expect(successor.connect).not.toHaveBeenCalled()
    await act(async () => {
      newLookup.resolve(null)
      await flushAsyncTicks(30)
    })
    expect(state.terminalLayoutsByTabId['tab-1'].ptyIdsByLeafId?.[LEAF_2]).toBe('pty-switched')
    await remounted.unmount()
  })

  it('discards a closed leaf with a delayed Claude lookup instead of restarting a reused pane id', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const lookup = Promise.withResolvers<null>()
    window.api.pty.findAgentSessionHolder = vi
      .fn()
      .mockResolvedValue(null)
      .mockReturnValueOnce(lookup.promise)
    const mounted = await mountRestartPane()
    await act(async () => {
      queueAccountSwitch(['pty-old'], 'claude')
    })
    const otherPane = createPane(2)
    otherPane.leafId = LEAF_1
    mounted.manager.getPanes.mockReturnValue([otherPane])
    mounted.restartDeps.cwd = '/tmp/other-folder'
    state.terminalLayoutsByTabId['tab-1'].root = { type: 'leaf', leafId: LEAF_1 }
    delete state.terminalLayoutsByTabId['tab-1'].ptyIdsByLeafId![LEAF_2]
    await act(async () => {
      publish()
    })
    await mounted.rerender()
    await act(async () => {
      lookup.resolve(null)
      await flushAsyncTicks(30)
    })
    expect(mounted.oldTransport.detach).not.toHaveBeenCalled()
    expect(transportOptions).toEqual([])
    expect(warn).toHaveBeenCalledWith('[terminal] discarded pending pane restart: pane removed', {
      tabId: 'tab-1',
      leafId: LEAF_2
    })
    await mounted.unmount()
  })

  it('drains onto the original leaf after a cwd rebuild reuses its numeric pane id', async () => {
    const firstLookup = Promise.withResolvers<null>()
    const nextLookup = Promise.withResolvers<null>()
    window.api.pty.findAgentSessionHolder = vi
      .fn()
      .mockResolvedValue(null)
      .mockReturnValueOnce(firstLookup.promise)
      .mockReturnValueOnce(nextLookup.promise)
    const mounted = await mountRestartPane()
    await act(async () => {
      queueAccountSwitch(['pty-old'], 'claude')
    })
    const otherPane = createPane(2)
    otherPane.leafId = LEAF_1
    const originalPane = createPane(3)
    originalPane.leafId = LEAF_2
    const manager = createManager(2)
    manager.getPanes.mockReturnValue([otherPane, originalPane])
    const [, typedManager] = mockPanePtyArgs(
      originalPane,
      manager,
      buildPaneConnectionDeps(() => state)
    )
    const unrelatedTransport = createMockTransport('pty-first')
    unrelatedTransport.detach = vi.fn()
    mounted.restartDeps.managerRef.current = typedManager
    mounted.transportsByPaneId.set(2, unrelatedTransport)
    mounted.transportsByPaneId.set(3, createMockTransport('pty-old'))
    mounted.restartDeps.cwd = '/tmp/new-cwd'
    const successor = successfulTransport('pty-switched')
    transports.push(successor)
    await mounted.rerender()
    await act(async () => {
      firstLookup.resolve(null)
      await flushAsyncTicks(30)
    })
    expect(successor.connect).not.toHaveBeenCalled()
    await act(async () => {
      nextLookup.resolve(null)
      await flushAsyncTicks(30)
    })
    expect(unrelatedTransport.detach).not.toHaveBeenCalled()
    expect(mounted.restartDeps.paneTransportsRef.current.get(2)).toBe(unrelatedTransport)
    expect(mounted.restartDeps.paneTransportsRef.current.get(3)).toBe(successor)
    expect(transportOptions[0]).toEqual(
      expect.objectContaining({
        cwd: '/tmp/new-cwd',
        leafId: LEAF_2,
        env: expect.objectContaining({ CLAUDE_CONFIG_DIR: 'account-b' })
      })
    )
    await mounted.unmount()
  })
})
