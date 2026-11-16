import '../../../pty-subprocess/testing/mock-descendant-sweep'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { rmSync } from 'node:fs'
import type { DaemonPtyAdapter } from '../daemon-pty-adapter'
import { TerminalHost } from '../../../terminal-host/terminal-host'
import { DaemonClient } from '../../../transport/client/daemon-client'
import type { InternalCreateOrAttachOptions } from '../../../terminal-host/terminal-host-agent-session-claim'
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

// #44 (a), observe only: a replacement spawn names the PTY it replaces (carriesFrom), main -> daemon -> host.
describe('DaemonPtyAdapter: carriesFrom (#44 restart carry-over)', () => {
  let dir: string
  let socketPath: string
  let tokenPath: string
  let client: DaemonClient | undefined
  let server: DaemonServer
  let adapter: DaemonPtyAdapter
  let hostOptions: InternalCreateOrAttachOptions[]

  beforeEach(async () => {
    const harness = await startDaemonAdapterHarness(() => createMockSubprocess())
    dir = harness.dir
    socketPath = harness.socketPath
    tokenPath = harness.tokenPath
    server = harness.server
    adapter = harness.adapter
    hostOptions = []
    // What arrives at the daemon's host after the adapter, the wire and admission (no private field is read).
    const create = TerminalHost.prototype.createOrAttach
    vi.spyOn(TerminalHost.prototype, 'createOrAttach').mockImplementation(function (
      this: TerminalHost,
      opts: InternalCreateOrAttachOptions
    ) {
      hostOptions.push({ ...opts })
      return create.call(this, opts)
    })
    getMacDaemonSystemResolverHealthMock.mockResolvedValue('unknown')
    getMacDaemonTccAttributionHealthMock.mockResolvedValue('unknown')
    isDaemonStaleForCurrentBundleMock.mockResolvedValue(false)
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    client?.disconnect()
    client = undefined
    adapter?.dispose()
    await server?.shutdown()
    rmSync(dir, { recursive: true, force: true })
  })

  it('a spawn with carriesFrom reaches the daemon host (adapter payload, wire, admission)', async () => {
    await adapter.spawn({
      cols: 80,
      rows: 24,
      sessionId: 's2',
      launchAgent: 'claude',
      carriesFrom: 's1'
    })
    expect(hostOptions.at(-1)).toMatchObject({ sessionId: 's2', carriesFrom: 's1' })
  })

  it('a spawn without it sends nothing (an older daemon never sees the field)', async () => {
    await adapter.spawn({ cols: 80, rows: 24, sessionId: 's3', launchAgent: 'claude' })
    expect(hostOptions.at(-1)).not.toHaveProperty('carriesFrom')
  })

  it('#70 S1: an ATTACH never carries: the adapter drops the field on an attach-only spawn', async () => {
    await adapter.spawn({ cols: 80, rows: 24, sessionId: 's2', launchAgent: 'claude' })
    // What the adapter puts on the wire (the public request method), not only what admission lets through.
    const sent: unknown[] = []
    const request = DaemonClient.prototype.request
    vi.spyOn(DaemonClient.prototype, 'request').mockImplementation(function (
      this: DaemonClient,
      ...args: Parameters<DaemonClient['request']>
    ) {
      if (args[0] === 'createOrAttach') {
        sent.push(args[1])
      }
      return request.apply(this, args)
    })
    await adapter.spawn({
      cols: 80,
      rows: 24,
      sessionId: 's2',
      launchAgent: 'claude',
      attachOnly: true,
      carriesFrom: 's1'
    })
    expect(sent.at(-1)).toMatchObject({ sessionId: 's2', attachOnly: true })
    expect(sent.at(-1)).not.toHaveProperty('carriesFrom')
    expect(hostOptions.at(-1)).toMatchObject({ sessionId: 's2', attachOnly: true })
    expect(hostOptions.at(-1)).not.toHaveProperty('carriesFrom')
  })

  it('#70 S1: admission drops carriesFrom from an attach-only request, whatever a client sends', async () => {
    await adapter.spawn({ cols: 80, rows: 24, sessionId: 's2', launchAgent: 'claude' })
    client = new DaemonClient({ socketPath, tokenPath })
    await client.ensureConnected()
    await client.request('createOrAttach', {
      sessionId: 's2',
      cols: 80,
      rows: 24,
      attachOnly: true,
      launchAgent: 'claude',
      carriesFrom: 's1'
    })
    expect(hostOptions.at(-1)).toMatchObject({ sessionId: 's2', attachOnly: true })
    expect(hostOptions.at(-1)).not.toHaveProperty('carriesFrom')
  })
})
