import type { getReleaseDownloadUrl } from './releases/updater-release-readiness'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadUpdaterModule, warmUpdaterModule } from './testing/updater-test-module-loader'
import { updaterMainWindow } from './testing/updater-test-main-window'

const { appMock, autoUpdaterMock, moduleFactories, resetUpdaterMocks } = await vi.hoisted(
  async () => (await import('./testing/updater-test-harness')).createUpdaterMocks()
)
const updaterDisabledReasonMock = vi.hoisted(() => vi.fn<() => string | null>(() => null))

vi.mock('electron', () => moduleFactories.electron())
vi.mock('electron-updater', () => moduleFactories.electronUpdater())
vi.mock('./electron-updater-loader', () => moduleFactories.electronUpdaterLoader())
vi.mock('../ipc/pty/kill-all', () => moduleFactories.ptyKillAll())
vi.mock('./linux-package/linux-update-package-type', () => moduleFactories.linuxUpdatePackageType())
vi.mock('./updater-lifecycle-diagnostics', () => moduleFactories.updaterLifecycleDiagnostics())
vi.mock('./releases/updater-changelog', () => moduleFactories.updaterChangelog())
vi.mock('./nudges/nudge-campaign', () => moduleFactories.updaterNudge())
vi.mock('./update-install-exit-watchdog', () => moduleFactories.updateInstallExitWatchdog())
vi.mock('./releases/updater-prerelease-feed', () => moduleFactories.updaterPrereleaseFeed())
vi.mock('./releases/updater-release-readiness', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getReleaseDownloadUrl: (
    await vi.importMock<{
      getReleaseDownloadUrl: typeof getReleaseDownloadUrl
    }>('./releases/updater-prerelease-feed')
  ).getReleaseDownloadUrl
}))
vi.mock('../local-builds/local-build-switch', () => moduleFactories.localBuildSwitch())
vi.mock('../local-builds/local-build-feed-server', () => moduleFactories.localBuildFeedServer())
vi.mock('./updater-disabled', () => ({ updaterDisabledReason: updaterDisabledReasonMock }))

warmUpdaterModule()

describe('updater on a self-built (disabled) build', () => {
  beforeEach(() => {
    resetUpdaterMocks()
    updaterDisabledReasonMock.mockReturnValue('self-built app without app-update.yml')
  })

  it('never checks the stock feed and sends no update-available status', async () => {
    vi.useFakeTimers()
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const send = vi.fn()
    appMock.isPackaged = true
    const { setupAutoUpdater, checkForUpdates, checkForUpdatesFromMenu, getUpdateStatus } =
      await loadUpdaterModule()

    setupAutoUpdater(updaterMainWindow(send), { getLastUpdateCheckAt: () => null })
    checkForUpdates()
    checkForUpdatesFromMenu()
    await vi.runAllTimersAsync()

    expect(logSpy).toHaveBeenCalledWith(
      '[updater] disabled for this build: self-built app without app-update.yml'
    )
    expect(autoUpdaterMock.checkForUpdates).not.toHaveBeenCalled()
    expect(autoUpdaterMock.setFeedURL).not.toHaveBeenCalled()
    expect(autoUpdaterMock.on).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
    expect(getUpdateStatus()).toEqual({ state: 'idle' })
    logSpy.mockRestore()
  })

  it('keeps the stock updater on when the build ships app-update.yml', async () => {
    vi.useFakeTimers()
    updaterDisabledReasonMock.mockReturnValue(null)
    appMock.isPackaged = true
    autoUpdaterMock.checkForUpdates.mockResolvedValue(undefined)
    const { setupAutoUpdater } = await loadUpdaterModule()

    setupAutoUpdater(updaterMainWindow(vi.fn()), { getLastUpdateCheckAt: () => null })

    expect(autoUpdaterMock.setFeedURL).toHaveBeenCalled()
  })
})
