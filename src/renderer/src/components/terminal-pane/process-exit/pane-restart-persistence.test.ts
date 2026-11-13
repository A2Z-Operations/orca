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
import { mockPanePtyArgs } from '../pty-connection/test-fixtures/pty-connection-test-connect-mock-pane'

vi.unmock('react')

describe('restart pane persistence', () => {
  let state: StoreState & Required<Pick<StoreState, 'ptyIdsByTabId' | 'terminalLayoutsByTabId'>>
  let transports: MockTransport[]
  let subscribers: ((state: StoreState) => void)[]

  beforeEach(async () => {
    vi.clearAllMocks()
    transports = []
    subscribers = []
    state = {
      ...createInitialStoreState(() => state),
      ptyIdsByTabId: {},
      terminalLayoutsByTabId: {}
    }
    bindPtyConnectionTestMocks({
      getState: () => state,
      getTransportQueue: () => transports,
      getTransportOptions: () => [],
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

  it('checkpoints the old PTY before deferred restart spawn and reattaches it on the next window', async () => {
    const { usePaneProcessRestart } = await import('./use-pane-process-restart')
    const { connectPanePty } = await import('../pty-connection/connect-pane-pty')
    const immediateFrame = vi.mocked(requestAnimationFrame).getMockImplementation()!
    vi.mocked(requestAnimationFrame).mockReturnValue(1)
    const oldTransport = createMockTransport('pty-old')
    oldTransport.detach = vi.fn()
    const replacementTransport = createMockTransport(null)
    transports.push(replacementTransport)
    const pane = createPane(2)
    const manager = createManager(2)
    const deps = buildPaneConnectionDeps(() => state, {
      clearTabPtyId: vi.fn((tabId: string, ptyId: string) => {
        state.ptyIdsByTabId[tabId] = state.ptyIdsByTabId[tabId].filter((id) => id !== ptyId)
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
    deps.paneTransportsRef.current.set(2, oldTransport)
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
      onPtyErrorRef: { current: vi.fn() },
      onPtyErrorClearedRef: { current: vi.fn() },
      onPtyRecoveryStateRef: { current: vi.fn() },
      setTerminalError: vi.fn(),
      setTerminalErrorsByPaneId: vi.fn(),
      showRestoredSessionBanner: vi.fn()
    }
    let restart: ReturnType<typeof usePaneProcessRestart> | undefined
    function RestartHarness() {
      restart = usePaneProcessRestart(restartDeps)
      return null
    }
    renderToStaticMarkup(createElement(RestartHarness))
    restart!.handleRestartPane(2, { command: 'claude', launchAgent: 'claude' }, { focus: false })

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
})
