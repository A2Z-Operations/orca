import { bindPtyConnectionTestMocks } from '../pty-connection/test-fixtures/pty-connection-mocks.spec'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
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
  let subscribers: ((state: StoreState) => void)[]

  beforeEach(async () => {
    vi.clearAllMocks()
    transports = []
    transportOptions = []
    subscribers = []
    state = {
      ...createInitialStoreState(() => state),
      ptyIdsByTabId: {},
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
    Object.assign(state, {
      consumeSuppressedPtyExit: vi.fn(() => false),
      isPtyShutdownPending: vi.fn(() => false),
      replaceTerminalLayoutPanePtyId: vi.fn(),
      queuePaneAccountRestarts: vi.fn()
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

  afterEach(restoreTerminalTestGlobals)

  async function mountRestartPane() {
    const { usePaneProcessRestart } = await import('./use-pane-process-restart')
    const oldTransport = createMockTransport('pty-old')
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
    manager.getPanes.mockReturnValue([pane])
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
      return null
    }
    renderToStaticMarkup(createElement(RestartHarness))
    return { restart: restart!, restartDeps, getErrors: () => errors }
  }

  it('checkpoints the old PTY before deferred restart spawn and reattaches it on the next window', async () => {
    const { connectPanePty } = await import('../pty-connection/connect-pane-pty')
    const immediateFrame = vi.mocked(requestAnimationFrame).getMockImplementation()!
    vi.mocked(requestAnimationFrame).mockReturnValue(1)
    const replacementTransport = createMockTransport(null)
    transports.push(replacementTransport)
    const { restart, restartDeps } = await mountRestartPane()
    restart.handleRestartPane(2, { command: 'claude', launchAgent: 'claude' }, { focus: false })

    // Quit saves this snapshot before the deferred connect or disposal hand-back can run.
    const savedLayout = structuredClone(state.terminalLayoutsByTabId['tab-1'])
    const savedTabPtys = [...state.ptyIdsByTabId['tab-1']]
    expect(savedLayout.ptyIdsByLeafId).toEqual({ [LEAF_1]: 'pty-first', [LEAF_2]: 'pty-old' })
    expect(savedTabPtys).toEqual(['pty-first', 'pty-old'])
    expect(replacementTransport.connect).not.toHaveBeenCalled()

    restartDeps.panePtyBindingsRef.current.get(2)?.dispose()
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
      const successor = createMockTransport('pty-switched')
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
})
