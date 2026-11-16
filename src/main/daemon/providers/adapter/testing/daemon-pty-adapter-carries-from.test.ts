import '../../../pty-subprocess/testing/mock-descendant-sweep'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { rmSync } from 'node:fs'
import type { DaemonPtyAdapter } from '../daemon-pty-adapter'
import type { DaemonServer } from '../../../server/daemon-server'
import { createMockSubprocess, startDaemonAdapterHarness } from './daemon-pty-adapter-test-harness'
import type * as DaemonHealthModule from '../../../health/daemon-health'
import type * as DaemonTccAttributionModule from '../../../permissions/daemon-tcc-attribution'
import type * as DaemonBundleStalenessModule from '../../../launch/daemon-bundle-staleness'

const {
  getMacDaemonSystemResolverHealthMock,
  getMacDaemonTccAttributionHealthMock,
  isDaemonStaleForCurrentBundleMock
} = vi.hoisted(() => ({
  getMacDaemonSystemResolverHealthMock: vi.fn(
    async (): Promise<'unknown' | 'unhealthy'> => 'unknown'
  ),
  getMacDaemonTccAttributionHealthMock: vi.fn(
    async (): Promise<'intact' | 'severed' | 'unknown'> => 'unknown'
  ),
  isDaemonStaleForCurrentBundleMock: vi.fn(async () => false)
}))

vi.mock('../../../health/daemon-health', async (importOriginal) => {
  const actual = await importOriginal<typeof DaemonHealthModule>()
  return {
    ...actual,
    getMacDaemonSystemResolverHealth: getMacDaemonSystemResolverHealthMock
  }
})

vi.mock('../../../permissions/daemon-tcc-attribution', async (importOriginal) => {
  const actual = await importOriginal<typeof DaemonTccAttributionModule>()
  return {
    ...actual,
    getMacDaemonTccAttributionHealth: getMacDaemonTccAttributionHealthMock
  }
})

vi.mock('../../../launch/daemon-bundle-staleness', async (importOriginal) => {
  const actual = await importOriginal<typeof DaemonBundleStalenessModule>()
  return {
    ...actual,
    isDaemonStaleForCurrentBundle: isDaemonStaleForCurrentBundleMock
  }
})

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

// #44 (a), observe only: a replacement spawn names the PTY it replaces (carriesFrom), main -> daemon -> host.
describe('DaemonPtyAdapter: carriesFrom (#44 restart carry-over)', () => {
  let dir: string
  let server: DaemonServer
  let adapter: DaemonPtyAdapter
  let payloads: Record<string, unknown>[]
  let hostOptions: Record<string, unknown>[]

  beforeEach(async () => {
    const harness = await startDaemonAdapterHarness(() => createMockSubprocess())
    dir = harness.dir
    server = harness.server
    adapter = harness.adapter
    payloads = []
    hostOptions = []
    // Spy on the wire (the adapter's private RPC client) and on the daemon's private host: what is sent, what arrives.
    const client = Reflect.get(adapter, 'client')
    const request: (...args: unknown[]) => Promise<unknown> = client.request.bind(client)
    vi.spyOn(client, 'request').mockImplementation(async (...args: unknown[]) => {
      if (args[0] === 'createOrAttach' && isRecord(args[1])) {
        payloads.push(args[1])
      }
      return request(...args)
    })
    const host = Reflect.get(server, 'host')
    const create: (opts: unknown) => Promise<unknown> = host.createOrAttach.bind(host)
    vi.spyOn(host, 'createOrAttach').mockImplementation(async (opts: unknown) => {
      if (isRecord(opts)) {
        hostOptions.push(opts)
      }
      return create(opts)
    })
    getMacDaemonSystemResolverHealthMock.mockResolvedValue('unknown')
    getMacDaemonTccAttributionHealthMock.mockResolvedValue('unknown')
    isDaemonStaleForCurrentBundleMock.mockResolvedValue(false)
  })

  afterEach(async () => {
    adapter?.dispose()
    await server?.shutdown()
    rmSync(dir, { recursive: true, force: true })
  })

  it('a spawn with carriesFrom sends it, and the daemon hands it to the host', async () => {
    await adapter.spawn({
      cols: 80,
      rows: 24,
      sessionId: 's2',
      launchAgent: 'claude',
      carriesFrom: 's1'
    })
    expect(payloads.at(-1)).toMatchObject({ sessionId: 's2', carriesFrom: 's1' })
    expect(hostOptions.at(-1)).toMatchObject({ sessionId: 's2', carriesFrom: 's1' })
  })

  it('a spawn without it sends nothing (an older daemon never sees the field)', async () => {
    await adapter.spawn({ cols: 80, rows: 24, sessionId: 's3', launchAgent: 'claude' })
    expect(payloads.at(-1)).not.toHaveProperty('carriesFrom')
    expect(hostOptions.at(-1)).not.toHaveProperty('carriesFrom')
  })
})
