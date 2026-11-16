import { afterEach, describe, expect, it, vi } from 'vitest'
import { ptyPaneKey } from './pane/key-state'
import { setupPtyIpcSuite } from './pty-ipc-test-harness'
import {
  installRestartHarness,
  leafId,
  paneKey,
  registerWithFakes,
  restartSpawnArgs,
  tabId
} from './pty-pane-owner-swap.test-fixture'

vi.mock('electron', () => import('./pty-ipc-mock-registry').then((m) => m.electronModuleMock()))
vi.mock('fs', () => import('./pty-ipc-mock-registry').then((m) => m.fsModuleMock()))
vi.mock('node-pty', () => import('./pty-ipc-mock-registry').then((m) => m.nodePtyModuleMock()))
vi.mock('node:child_process', async (importOriginal) =>
  (await import('./pty-ipc-mock-registry')).childProcessModuleMock(await importOriginal())
)
vi.mock('../../opencode/hook-service', () =>
  import('./pty-ipc-mock-registry').then((m) => m.openCodeHookServiceModuleMock())
)
vi.mock('../../mimo/hook-service', () =>
  import('./pty-ipc-mock-registry').then((m) => m.mimoHookServiceModuleMock())
)
vi.mock('../../agent-hooks/server/agent-hook-server', () =>
  import('./pty-ipc-mock-registry').then((m) => m.agentHookServerModuleMock())
)
vi.mock('../../pi/titlebar-extension-service', () =>
  import('./pty-ipc-mock-registry').then((m) => m.piTitlebarExtensionModuleMock())
)
vi.mock('../../pty/shell-startup/pwsh', () =>
  import('./pty-ipc-mock-registry').then((m) => m.pwshModuleMock())
)
vi.mock('../../wsl/filesystem/unc-path-access', async (importOriginal) =>
  (await import('./pty-ipc-mock-registry')).wslModuleMock(await importOriginal())
)
vi.mock('../../telemetry/client', () =>
  import('./pty-ipc-mock-registry').then((m) => m.telemetryClientModuleMock())
)
vi.mock('../../telemetry/classify-error', () =>
  import('./pty-ipc-mock-registry').then((m) => m.classifyErrorModuleMock())
)
vi.mock('../../cli/linux-terminal-orca-cli-shim', () =>
  import('./pty-ipc-mock-registry').then((m) => m.linuxCliShimModuleMock())
)
vi.mock('../../memory/pty-registry', () =>
  import('./pty-ipc-mock-registry').then((m) => m.ptyRegistryModuleMock())
)
vi.mock('../../agent-hooks/observations/migration-unsupported-pty-state', () =>
  import('./pty-ipc-mock-registry').then((m) => m.migrationUnsupportedPtyModuleMock())
)
vi.mock('../../codex/configuration/homes/codex-pane-account-registry', () =>
  import('./pty-ipc-mock-registry').then((m) => m.codexPaneAccountRegistryModuleMock())
)
vi.mock('../../codex/history/index/codex-state-db-backfill-recovery', () =>
  import('./pty-ipc-mock-registry').then((m) => m.codexBackfillRecoveryModuleMock())
)

// #44 (a) restart carry-over, #70 S3 (option B): on the WINDOW route main names the replaced PTY to the daemon
// (carriesFrom) only when it proved the PTY was this pane's. An unproven restart still runs exactly as before: no new
// refusal, it just carries nothing (the old pane's held set expires with its carry-unclaimed line).
describe('pty:spawn replacing a pane owner: carriesFrom only for a proven PTY', () => {
  const { handlers, mainWindow } = setupPtyIpcSuite()

  afterEach(() => ptyPaneKey.delete('pty-old'))

  function freshSpawnOptions(
    providerSpawn: ReturnType<typeof installRestartHarness>['providerSpawn']
  ) {
    const fresh = providerSpawn.mock.calls
      .map(([options]) => options)
      .filter((options) => !options.attachOnly)
      .map((options) => ({
        carriesFrom: 'carriesFrom' in options ? options.carriesFrom : undefined
      }))
    expect(fresh).toHaveLength(1)
    return fresh[0]!
  }

  it('a pane bound to the replaced PTY: carriesFrom is sent', async () => {
    const { providerSpawn, store, runtime } = installRestartHarness()
    registerWithFakes(mainWindow, runtime, store)
    await handlers.get('pty:spawn')!(null, restartSpawnArgs({ replacesPtyId: 'pty-old' }))
    expect(freshSpawnOptions(providerSpawn).carriesFrom).toBe('pty-old')
  })

  it('an UNBOUND pane with no pane-key record for that PTY: the restart still runs, with no carriesFrom', async () => {
    const { providerSpawn, shutdown, store, runtime } = installRestartHarness()
    delete store.getWorkspaceSession().terminalLayoutsByTabId[tabId].ptyIdsByLeafId[leafId]
    registerWithFakes(mainWindow, runtime, store)
    await handlers.get('pty:spawn')!(null, restartSpawnArgs({ replacesPtyId: 'pty-old' }))
    expect(shutdown).toHaveBeenCalled() // not refused: the window route behaves as before
    expect(freshSpawnOptions(providerSpawn).carriesFrom).toBeUndefined()
  })

  it("an unbound pane whose replaced PTY's own pane-key record names it: carriesFrom is sent", async () => {
    const { providerSpawn, store, runtime } = installRestartHarness()
    delete store.getWorkspaceSession().terminalLayoutsByTabId[tabId].ptyIdsByLeafId[leafId]
    ptyPaneKey.set('pty-old', paneKey)
    registerWithFakes(mainWindow, runtime, store)
    await handlers.get('pty:spawn')!(null, restartSpawnArgs({ replacesPtyId: 'pty-old' }))
    expect(freshSpawnOptions(providerSpawn).carriesFrom).toBe('pty-old')
  })
})
