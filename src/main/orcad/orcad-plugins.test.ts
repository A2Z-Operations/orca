import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from 'esbuild'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Store } from '../persistence/loading-store/store'
import { ProfileStateSqliteAuthority } from '../persistence/profile-state/profile-state-sqlite-authority'
import { OrcaRuntimeService } from '../runtime/orca-runtime'
import { readPluginClaudeAccounts } from '../plugins/plugin-claude-account-events'
import type { PluginClaudeAccountView } from '../../shared/plugins/workers/plugin-claude-account-contract'
import type { OrcadPluginClaudeAccountSource } from './orcad-account-services'
import { eraseRpcMethods, isStreamingMethod, type RpcContext } from '../runtime/rpc/core'
import { PLUGIN_METHODS } from '../runtime/rpc/methods/plugins/plugins'
import { PluginApprovalRequiredError } from '../../shared/plugins/approval/plugin-cli-approval'
import { parsePluginManifest } from '../../shared/plugins/manifest/plugin-manifest'
import { installFakeAppEnvironment } from '../../../config/scripts/test-runtime/environment/vitest-host-ports-setup'
import {
  headlessUnavailableContributions,
  headlessUnavailableLine,
  startOrcadPlugins,
  type OrcadPluginsHandle
} from './orcad-plugins'
import type { OrcadRuntimeCleanup } from './orcad-runtime-lifetime'
import '../../shared/rpc-contract/plugins-params'

const HOST_VERSION = '1.4.256'

const directories: string[] = []
const stores: Store[] = []
let cleanups: OrcadRuntimeCleanup[] = []
// The real worker host, bundled once as `build-orcad.mjs` ships it beside `orcad-server.js`.
let bundledHostEntryPath = ''
let bundleRoot = ''

async function tempDirectory(prefix: string): Promise<string> {
  const directory = await realpath(await mkdtemp(join(tmpdir(), prefix)))
  directories.push(directory)
  return directory
}

beforeAll(async () => {
  bundleRoot = await realpath(await mkdtemp(join(tmpdir(), 'orcad-plugins-host-bundle-')))
  bundledHostEntryPath = join(bundleRoot, 'plugin-host-entry.cjs')
  await build({
    entryPoints: [join(process.cwd(), 'src', 'main', 'plugins', 'workers', 'plugin-host-entry.ts')],
    outfile: bundledHostEntryPath,
    bundle: true,
    platform: 'node',
    target: 'node18',
    format: 'cjs',
    logLevel: 'silent'
  })
}, 30_000)

afterAll(async () => {
  await rm(bundleRoot, { recursive: true, force: true })
})

beforeEach(async () => {
  const home = await tempDirectory('orcad-plugins-home-')
  const userData = await tempDirectory('orcad-plugins-data-')
  vi.stubEnv('HOME', home)
  vi.stubEnv('USERPROFILE', home)
  vi.stubEnv('ORCA_USER_DATA_PATH', userData)
  installFakeAppEnvironment({
    getPath: (name) => (name === 'home' ? home : name === 'temp' ? tmpdir() : userData)
  })
})

afterEach(async () => {
  for (const cleanup of cleanups.toReversed()) {
    await cleanup({ failed: false })
  }
  cleanups = []
  for (const store of stores.splice(0)) {
    store.freezeWrites()
  }
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true })
  }
})

async function startHeadless(
  options: { claudeAccounts?: OrcadPluginClaudeAccountSource; hostEntryPath?: string } = {}
): Promise<{
  runtime: OrcaRuntimeService
  store: Store
  handle: OrcadPluginsHandle
  userDataPath: string
}> {
  const directory = await tempDirectory('orcad-plugins-profile-')
  const userDataPath = await tempDirectory('orcad-plugins-userdata-')
  const store = new Store({
    dataFile: join(directory, 'orca-data.json'),
    profileStateAuthority: new ProfileStateSqliteAuthority(
      join(directory, 'profile-state.db'),
      'orcad-plugins'
    )
  })
  stores.push(store)
  const runtime = new OrcaRuntimeService(store)
  const hookServer = { getStatusSnapshot: () => [], subscribeEnrichedStatus: () => () => {} }
  const handle = startOrcadPlugins({
    runtime,
    store,
    hookServer,
    registerCleanup: (cleanup) => cleanups.push(cleanup),
    userDataPath,
    hostVersion: HOST_VERSION,
    hostEntryPath: options.hostEntryPath ?? join(userDataPath, 'missing-plugin-host-entry.js'),
    // Never reach the safety list or the catalogs from a test.
    networkAllowed: false,
    claudeAccounts: options.claudeAccounts
  })
  await handle.pluginService.whenReady()
  return { runtime, store, handle, userDataPath }
}

// oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: plugin handlers read only the injected service.
const context: RpcContext = { runtime: {} as RpcContext['runtime'], caller: { kind: 'local-cli' } }

async function call(name: string, params: unknown): Promise<unknown> {
  const found = eraseRpcMethods(PLUGIN_METHODS).find((candidate) => candidate.name === name)
  if (!found || isStreamingMethod(found)) {
    throw new Error(`Missing request method ${name}`)
  }
  return found.handler(found.params ? found.params.parse(params) : params, context)
}

const PANEL_PLUGIN = {
  manifestVersion: 2,
  id: 'notes',
  publisher: 'acme',
  name: 'Notes',
  version: '1.0.0',
  execution: 'sandboxed-ui',
  engines: { orca: `>=${HOST_VERSION}` },
  contributes: {
    panels: [{ id: 'notes', title: 'Notes', entry: 'panel.html' }],
    statusBarItems: [{ id: 'notes-count', text: 'Notes' }]
  },
  capabilities: []
}

const WORKER_PLUGIN = {
  manifestVersion: 2,
  id: 'counter',
  publisher: 'acme',
  name: 'Counter',
  version: '1.0.0',
  execution: 'trusted-worker',
  pluginApi: 1,
  main: 'main.mjs',
  engines: { orca: `>=${HOST_VERSION}` },
  contributes: { commands: [{ id: 'bump', title: 'Bump' }] },
  capabilities: [{ kind: 'storage:own' }]
}

async function writeWorkerPlugin(): Promise<string> {
  const folder = await tempDirectory('orcad-plugins-worker-dev-')
  await mkdir(folder, { recursive: true })
  await writeFile(join(folder, 'orca-plugin.json'), JSON.stringify(WORKER_PLUGIN))
  await writeFile(
    join(folder, 'main.mjs'),
    `export default function activate(orca) {
      orca.commands.register('bump', async () => {
        const { value } = await orca.host.call('storage.get', { key: 'bumps' })
        const bumps = (value ?? 0) + 1
        await orca.host.call('storage.set', { key: 'bumps', value: bumps })
        return { bumps, pid: process.pid }
      })
    }`
  )
  return folder
}

async function devLoadApproved(folder: string): Promise<void> {
  const refusal = await call('plugins.devLoad', { path: folder }).catch((error: unknown) => error)
  expect(refusal).toBeInstanceOf(PluginApprovalRequiredError)
  const fingerprint =
    refusal instanceof PluginApprovalRequiredError ? refusal.data.approvalFingerprint : ''
  await expect(
    call('plugins.devLoad', { path: folder, approvalFingerprint: fingerprint })
  ).resolves.toMatchObject({ added: true })
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function writePanelPlugin(): Promise<string> {
  const folder = await tempDirectory('orcad-plugins-dev-')
  await mkdir(folder, { recursive: true })
  await writeFile(join(folder, 'orca-plugin.json'), JSON.stringify(PANEL_PLUGIN))
  await writeFile(join(folder, 'panel.html'), '<p>notes</p>')
  return folder
}

describe('headless serve plugin service', () => {
  it('binds the plugin service so plugins.list answers instead of "not available"', async () => {
    await startHeadless()
    await expect(call('plugins.list', null)).resolves.toEqual([])
  })

  it('writes the plugin system switch through the store like the desktop', async () => {
    const { store } = await startHeadless()
    await expect(call('plugins.setSystemEnabled', { enabled: false })).resolves.toMatchObject({
      enabled: false,
      plugins: []
    })
    expect(store.getSettings().pluginSystemEnabled).toBe(false)
    await expect(call('plugins.setSystemEnabled', { enabled: true })).resolves.toMatchObject({
      enabled: true,
      plugins: []
    })
    expect(store.getSettings().pluginSystemEnabled).toBe(true)
  })

  it('reports frame DevTools as desktop-only instead of crashing', async () => {
    await startHeadless()
    await expect(call('plugins.devInspect', { pluginKey: 'acme.notes' })).rejects.toThrow(
      'only available in the Orca desktop app'
    )
  })

  it('loads and approves a dev folder, then logs the contributions no window shows', async () => {
    const { store, handle } = await startHeadless()
    await call('plugins.setSystemEnabled', { enabled: true })
    const folder = await writePanelPlugin()

    // First load adds the folder but keeps the code inert until approved, as on the desktop.
    const refusal = await call('plugins.devLoad', { path: folder }).catch((error: unknown) => error)
    expect(refusal).toBeInstanceOf(PluginApprovalRequiredError)
    expect(store.getSettings().devPluginPaths).toEqual([folder])
    const fingerprint =
      refusal instanceof PluginApprovalRequiredError ? refusal.data.approvalFingerprint : ''
    expect(fingerprint).not.toBe('')

    await expect(
      call('plugins.devLoad', { path: folder, approvalFingerprint: fingerprint })
    ).resolves.toMatchObject({ added: true, approval: 'approve-flag' })
    expect(store.getSettings().pluginConsents).toHaveProperty('acme.notes')
    await handle.pluginService.whenReady()
    const list = await call('plugins.list', null)
    expect(list).toMatchObject([{ pluginKey: 'acme.notes', isDev: true, status: 'idle' }])

    await vi.waitFor(async () => {
      const logs = await call('plugins.getLogs', { pluginKey: 'acme.notes' })
      expect(logs).toMatchObject({
        lines: expect.arrayContaining([
          expect.objectContaining({
            level: 'warn',
            line: expect.stringContaining(
              '1 panel(s), 1 status bar item(s) declared but this host has no window'
            )
          })
        ])
      })
    })
    // Once per install: a later change event does not repeat the line.
    const before = await call('plugins.getLogs', { pluginKey: 'acme.notes' })
    await handle.pluginService.refresh()
    await handle.pluginService.whenReady()
    await expect(call('plugins.getLogs', { pluginKey: 'acme.notes' })).resolves.toEqual(before)
  })

  // Forks a real worker process from the bundled host entry; seconds on a loaded machine.
  it('activates a trusted-worker plugin and answers its storage host calls, then disposes the worker at stop', async () => {
    const { handle } = await startHeadless({ hostEntryPath: bundledHostEntryPath })
    await call('plugins.setSystemEnabled', { enabled: true })
    await devLoadApproved(await writeWorkerPlugin())
    await handle.pluginService.whenReady()
    // Approved and inert: the worker starts on its first command, as on the desktop.
    await expect(call('plugins.list', null)).resolves.toMatchObject([
      { pluginKey: 'acme.counter', isDev: true, status: 'idle' }
    ])

    const first = await call('plugins.invokeCommand', {
      pluginKey: 'acme.counter',
      commandId: 'bump'
    })
    expect(first).toMatchObject({ bumps: 1, pid: expect.any(Number) })
    await expect(call('plugins.list', null)).resolves.toMatchObject([
      { pluginKey: 'acme.counter', status: 'running' }
    ])
    // storage.set/get round-trip over the worker channel: the second call reads the first write.
    await expect(
      call('plugins.invokeCommand', { pluginKey: 'acme.counter', commandId: 'bump' })
    ).resolves.toMatchObject({ bumps: 2 })
    const pid = (first as { pid: number }).pid
    expect(pid).not.toBe(process.pid)
    expect(isAlive(pid)).toBe(true)

    for (const cleanup of cleanups.splice(0).toReversed()) {
      await cleanup({ failed: false })
    }
    await vi.waitFor(() => {
      expect(isAlive(pid)).toBe(false)
    })
  }, 30_000)

  it('answers accounts.read with an empty list when this host owns no accounts', async () => {
    // A WSL guest: `createOrcadAccountServices` returns null, so no source is bound.
    await startHeadless()
    expect(readPluginClaudeAccounts()).toEqual({ accounts: [] })
  })

  it("serves this host's Claude accounts to plugins and emits usage changes until stop", async () => {
    const accountView = (usedPercent: number): PluginClaudeAccountView => ({
      id: 'acct-1',
      label: 'one@example.com',
      assignedSessionCount: 0,
      usage: {
        session: { usedPercent, windowMinutes: 300, resetsAt: null },
        weekly: null,
        fableWeekly: null,
        updatedAt: 1
      }
    })
    let accounts = [accountView(10)]
    const rateLimits = { notify: null as (() => void) | null }
    const unsubscribe = vi.fn()
    const { handle } = await startHeadless({
      claudeAccounts: {
        readAccounts: () => accounts,
        subscribeRateLimits: (listener) => {
          rateLimits.notify = listener
          return unsubscribe
        }
      }
    })
    const emitted = vi.spyOn(handle.pluginService, 'emitEvent')
    // `accounts.read` host calls read through this binding, as on the desktop.
    expect(readPluginClaudeAccounts()).toEqual({ accounts: [accountView(10)] })

    accounts = [accountView(55)]
    expect(rateLimits.notify).not.toBeNull()
    rateLimits.notify?.()
    expect(emitted).toHaveBeenCalledWith(
      'accounts.usage.changed',
      expect.objectContaining({ accountId: 'acct-1' })
    )

    for (const cleanup of cleanups.splice(0).toReversed()) {
      await cleanup({ failed: false })
    }
    expect(unsubscribe).toHaveBeenCalledTimes(1)
    expect(readPluginClaudeAccounts()).toEqual({ accounts: [] })
  })

  it('unbinds the RPC services when the host stops', async () => {
    await startHeadless()
    for (const cleanup of cleanups.splice(0).toReversed()) {
      await cleanup({ failed: false })
    }
    await expect(call('plugins.list', null)).rejects.toThrow(
      'Plugin service is not available on this runtime'
    )
  })
})

describe('headlessUnavailableContributions', () => {
  function manifest(contributes: Record<string, unknown>) {
    const parsed = parsePluginManifest({
      ...PANEL_PLUGIN,
      execution: 'declarative',
      contributes
    })
    if (!parsed.ok) {
      throw new Error(parsed.error)
    }
    return parsed.manifest
  }

  it('is empty for a plugin that only runs code and commands', () => {
    expect(
      headlessUnavailableContributions(
        manifest({ commands: [{ id: 'hello', title: 'Hello', action: 'workspace.rename' }] })
      )
    ).toEqual([])
  })

  it('names each window-only contribution family it finds', () => {
    const unavailable = headlessUnavailableContributions(
      manifest({
        statusBarItems: [
          { id: 'a', text: 'A' },
          { id: 'b', text: 'B' }
        ]
      })
    )
    expect(unavailable).toEqual(['2 status bar item(s)'])
    expect(headlessUnavailableLine(unavailable)).toContain('this host has no window to show them')
  })
})
