import { beforeAll } from 'vitest'
import { resolveLoginShellEnvironment } from '../../startup/login-shell-environment'
import { createPtyIpcSuiteEnvironment } from './pty-ipc-suite-environment'
import { createPtyIpcProviderFixtures } from './pty-ipc-provider-fixtures'
import { createPtyIpcListenerAccessors } from './pty-ipc-listener-accessors'
import { createPtyIpcSpawnDrivers } from './pty-ipc-spawn-drivers'

export type PtyIpcSuiteFixtures = ReturnType<typeof createPtyIpcSuiteEnvironment> &
  ReturnType<typeof createPtyIpcProviderFixtures> &
  ReturnType<typeof createPtyIpcListenerAccessors> &
  ReturnType<typeof createPtyIpcSpawnDrivers>

export function setupPtyIpcSuite(): PtyIpcSuiteFixtures {
  // Plain shell spawns wait on this probe. A cold login shell can outlast vi.waitFor.
  beforeAll(async () => {
    await resolveLoginShellEnvironment()
  })
  const environment = createPtyIpcSuiteEnvironment()
  const providers = createPtyIpcProviderFixtures({ mainWindow: environment.mainWindow })
  const listeners = createPtyIpcListenerAccessors({
    handlers: environment.handlers,
    mainWindow: environment.mainWindow as never,
    mainWindowIpcEvent: environment.mainWindowIpcEvent
  })
  const spawns = createPtyIpcSpawnDrivers({
    handlers: environment.handlers,
    mainWindow: environment.mainWindow,
    createMockProc: providers.createMockProc as never
  })
  return { ...environment, ...providers, ...listeners, ...spawns }
}
