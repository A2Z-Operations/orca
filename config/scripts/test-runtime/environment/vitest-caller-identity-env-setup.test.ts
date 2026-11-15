import { afterEach, expect, it, vi } from 'vitest'
import { WSL_HOSTS_GATE_STATE_ENV } from '../../../../src/shared/wsl-host-internal-gate'

afterEach(() => {
  vi.unstubAllEnvs()
})

async function runSetup(): Promise<readonly string[]> {
  vi.resetModules()
  const setup = await import('./vitest-caller-identity-env-setup')
  return setup.INHERITED_ORCA_TERMINAL_ENV
}

// orca #48: the Orca app running the test terminal publishes its resolved WSL hosts gate state to every process it
// starts, and readers prefer that inherited state over the gate a test sets; tests must see only their own gate.
it('clears the WSL hosts gate state an Orca terminal passes down', async () => {
  vi.stubEnv(WSL_HOSTS_GATE_STATE_ENV, 'closed')
  await runSetup()
  expect(process.env[WSL_HOSTS_GATE_STATE_ENV]).toBeUndefined()
})

it('clears every variable an Orca terminal exports, and none of the runner own ORCA_ settings', async () => {
  const inherited = await runSetup()
  for (const name of inherited) {
    vi.stubEnv(name, 'from-the-launching-terminal')
  }
  vi.stubEnv('ORCA_VITEST_RUNTIME', 'node')
  await runSetup()
  expect(inherited.filter((name) => process.env[name] !== undefined)).toEqual([])
  expect(process.env.ORCA_VITEST_RUNTIME).toBe('node')
})
