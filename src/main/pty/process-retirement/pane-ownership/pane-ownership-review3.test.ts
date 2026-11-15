import { describe, expect, it } from 'vitest'
import { PaneOwnershipObserver, type PaneOwnershipObserverDeps } from './pane-ownership-observer'
import { CLOSE_UNFINISHED_MS } from './pane-ownership-closing'
import { FdReadFailed, type FdInfo, type FdKind } from './pane-ownership-fds'
import type { OwnershipRow } from './pane-ownership-table'

// Fable read of PR 47 (O1-O4): what the observe log says about wiring, failed fd reads, the ps pace, unfinished closes.
const HOST = 900
const UID = 501
const OLD = 'Sat Nov 15 07:00:00 2026'
const T0 = Date.UTC(2026, 10, 15, 8, 0, 0)

function row(pid: number, ppid: number): OwnershipRow {
  return { pid, ppid, pgid: pid, uid: UID, startedAt: OLD, comm: `p${pid}` }
}

function fd(n: number, kind: FdKind, id: string): FdInfo {
  return { fd: n, kind, id, peer: null }
}

type FdAnswer = (pids: number[], fds: number[] | 'all') => Map<number, FdInfo[]>

function setup(opts: {
  tables: OwnershipRow[][]
  fds?: FdAnswer
  via?: 'in-process' | 'ps'
  alive?: () => boolean
}) {
  const logs: { event: string; details: Record<string, unknown> }[] = []
  const calls: { pids: number[]; fds: number[] | 'all' }[] = []
  const clock = { now: T0 }
  let call = 0
  const deps: PaneOwnershipObserverDeps = {
    listAgentRoots: () =>
      (opts.alive ?? (() => true))() ? [{ sessionId: 's1', rootPid: 10 }] : [],
    readTable: async () => ({
      rows: [row(HOST, 1), ...(opts.tables[Math.min(call++, opts.tables.length - 1)] ?? [])],
      capturedAtMs: clock.now,
      via: opts.via ?? 'in-process'
    }),
    readFds: async (pids, fds) => {
      calls.push({ pids, fds })
      return (opts.fds ?? (() => new Map()))(pids, fds)
    },
    readStartTicks: null,
    listDurableJobs: async () => [],
    readMode: async () => ({ mode: 'observe', requested: null }),
    log: (event, details) => logs.push({ event, details }),
    hostUid: UID,
    hostPid: HOST,
    now: () => clock.now
  }
  const obs = new PaneOwnershipObserver(deps)
  const tickAt = async (ms: number): Promise<void> => {
    clock.now += ms
    await obs.tick()
  }
  const entries = () =>
    new Map(
      logs.filter((l) => l.event === 'pane-ownership-entry').map((l) => [l.details.pid, l.details])
    )
  return { obs, logs, calls, clock, tickAt, entries }
}

describe('pane ownership, Fable read of PR 47', () => {
  it('O1: the root is read in the SAME call as the due entry, so the at-record comparison is never stale', async () => {
    const { obs, tickAt, entries } = setup({
      tables: [[row(10, 5), row(20, 10)]],
      fds: (pids) =>
        new Map(
          pids.map((pid) => [pid, pid === 10 ? [fd(5, 'pipe', 'P1')] : [fd(1, 'pipe', 'P1')]])
        )
    })
    await tickAt(1_000)
    await tickAt(1_000) // 20 due, read together with 10
    await tickAt(4_000)
    await obs.observeClose('s1', 'close')
    expect(entries().get(20)).toMatchObject({
      fdsAtRecordRead: 'ok',
      sharesWithAgentAtRecord: true,
      fdsAtCloseRead: 'ok',
      sharesWithAgent: true,
      agentIdsDropped: 0,
      rootReadAgeMs: 4_000
    })
  })

  it('O1: the root ids are REPLACED at each read; an id a recorded entry still refers to is kept, a stale one is not', async () => {
    let rootHolds = [fd(5, 'pipe', 'P1'), fd(6, 'pipe', 'X1')]
    const { obs, tickAt, entries } = setup({
      tables: [
        [row(10, 5), row(20, 10)],
        [row(10, 5), row(20, 10)],
        [row(10, 5), row(20, 10), row(21, 10)]
      ],
      fds: (pids, which) =>
        new Map(
          pids.map((pid) => {
            if (pid === 10) {
              return [pid, rootHolds]
            }
            if (pid === 20) {
              return [pid, [fd(1, 'pipe', 'P1')]]
            }
            return [pid, [fd(1, 'pipe', which === 'all' ? 'P2' : 'X1')]]
          })
        )
    })
    await tickAt(1_000)
    await tickAt(1_000) // 20 due: root P1 + X1
    rootHolds = [fd(5, 'pipe', 'P2')]
    await tickAt(1_000) // 21 recorded
    await tickAt(1_000) // 21 due: root now P2 only; P1 kept (20 refers to it), X1 dropped
    await obs.observeClose('s1', 'close')
    expect(entries().get(20)).toMatchObject({ sharesWithAgent: true })
    expect(entries().get(21)).toMatchObject({
      sharesWithAgentAtRecord: true, // P2, read in the same call
      sharesWithAgent: false // its X1 at close is no longer held by the root
    })
  })

  it('O1: ids beyond the cap are counted, never lost without a word', async () => {
    const many = Array.from({ length: 300 }, (_, i) => fd(10 + i, 'pipe', `P${i}`))
    const { obs, logs, tickAt, entries } = setup({
      tables: [[row(10, 5), row(20, 10)]],
      fds: (pids) => new Map(pids.map((pid) => [pid, pid === 10 ? many : [fd(1, 'pipe', 'P0')]]))
    })
    await tickAt(1_000)
    await tickAt(1_000)
    await obs.observeClose('s1', 'close')
    expect(entries().get(20)).toMatchObject({ agentIdsDropped: 44 })
    expect(logs.find((l) => l.event === 'pane-ownership-close')!.details).toMatchObject({
      agentIdsDropped: 44
    })
  })

  it('O2: a failed fd read is counted, logged once and backs off; the entry is marked failed, never "no fds"', async () => {
    const { obs, logs, tickAt, entries } = setup({
      tables: [[row(10, 5), row(20, 10)]],
      fds: (_pids, which) => {
        if (which === 'all') {
          throw new FdReadFailed('timeout')
        }
        return new Map()
      }
    })
    await tickAt(1_000)
    await tickAt(1_000) // 20 due: the read fails
    expect(logs.filter((l) => l.event === 'pane-ownership-fds-failing')).toHaveLength(1)
    expect(obs.status().fdFailures).toBe(1)
    await obs.observeClose('s1', 'close')
    expect(entries().get(20)).toMatchObject({
      fdsAtRecord: null,
      fdsAtRecordRead: 'failed',
      sharesWithAgentAtRecord: null
    })
  })

  it('O2: entries due during the back-off stay pending and are read once it is over; recovery is logged', async () => {
    let fail = true
    const { obs, logs, calls, tickAt, entries } = setup({
      tables: [
        [row(10, 5), row(20, 10)],
        [row(10, 5), row(20, 10)],
        [row(10, 5), row(20, 10), row(21, 10)],
        [row(10, 5), row(20, 10), row(21, 10)]
      ],
      fds: (pids) => {
        if (fail) {
          fail = false
          throw new FdReadFailed('timeout')
        }
        return new Map(pids.map((pid) => [pid, [fd(1, 'pipe', 'Q')]]))
      }
    })
    await tickAt(1_000)
    await tickAt(1_000) // 20 due: the read fails, back off 2 s
    await tickAt(500) // 21 recorded
    await tickAt(500) // 21 due inside the back-off: no helper call
    expect(calls).toHaveLength(1)
    await tickAt(1_500) // back-off over: 20 (again) and 21 in one call
    expect(calls).toHaveLength(2)
    expect(calls[1].pids).toEqual([20, 21, 10])
    expect(logs.filter((l) => l.event === 'pane-ownership-fds-failing')).toHaveLength(1)
    expect(logs.filter((l) => l.event === 'pane-ownership-fds-recovered')).toHaveLength(1)
    await obs.observeClose('s1', 'close')
    expect(entries().get(20)).toMatchObject({ fdsAtRecordRead: 'ok' })
    expect(entries().get(21)).toMatchObject({ fdsAtRecordRead: 'ok' })
  })

  it('O2: a failed read at close leaves the close fds and the yes/no unknown (null), never "no fds"', async () => {
    const { obs, logs, tickAt, entries } = setup({
      tables: [[row(10, 5), row(20, 10)]],
      fds: (_pids, which) => {
        if (which !== 'all') {
          throw new FdReadFailed('timeout')
        }
        return new Map()
      }
    })
    await tickAt(1_000)
    await obs.observeClose('s1', 'close')
    expect(entries().get(20)).toMatchObject({
      fdsAtClose: null,
      fdsAtCloseRead: 'failed',
      sharesWithAgent: null
    })
    expect(logs.find((l) => l.event === 'pane-ownership-close')!.details).toMatchObject({
      fdsAtCloseRead: 'failed'
    })
  })

  it('O3: a table read through ps ticks every 5 s and says so in the start line; in process stays at 1 s', async () => {
    const ps = setup({ tables: [[row(10, 5)]], via: 'ps' })
    await ps.tickAt(1_000)
    expect(ps.obs.nextDelayMs()).toBe(5_000)
    expect(ps.logs.find((l) => l.event === 'pane-ownership-start')!.details).toMatchObject({
      reader: 'ps',
      intervalMs: 5_000
    })
    const inProcess = setup({ tables: [[row(10, 5)]], via: 'in-process' })
    await inProcess.tickAt(1_000)
    expect(inProcess.obs.nextDelayMs()).toBe(1_000)
  })

  it('O4: a pane whose close did not finish is logged and sampled again', async () => {
    const { obs, logs, tickAt } = setup({ tables: [[row(10, 5), row(20, 10)]] })
    await tickAt(1_000)
    obs.noteClose('s1', 'close')
    await obs.observeClose('s1', 'close')
    await tickAt(10_000) // still closing: not sampled
    expect(obs.status().panes).toBe(0)
    await tickAt(CLOSE_UNFINISHED_MS)
    expect(logs.find((l) => l.event === 'pane-ownership-close-unfinished')!.details).toMatchObject({
      sessionId: 's1',
      reason: 'close',
      observed: true
    })
    expect(obs.status()).toMatchObject({ panes: 1, closesUnfinished: 1 })
  })

  it('O4: a close whose root is gone is simply over (no unfinished line)', async () => {
    let alive = true
    const { obs, logs, tickAt } = setup({
      tables: [[row(10, 5), row(20, 10)]],
      alive: () => alive
    })
    await tickAt(1_000)
    obs.noteClose('s1', 'close')
    await obs.observeClose('s1', 'close')
    alive = false
    await tickAt(CLOSE_UNFINISHED_MS + 1_000)
    expect(logs.some((l) => l.event === 'pane-ownership-close-unfinished')).toBe(false)
  })
})
