import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  PaneOwnershipObserver,
  SAMPLER_FAILURES_BEFORE_LOG,
  type PaneOwnershipObserverDeps
} from './pane-ownership-observer'
import { readLinuxKeepMarkers } from './pane-ownership-marker'
import type { OwnershipRow } from './pane-ownership-table'
import type { FdInfo } from './pane-ownership-fds'

const HOST = 900
const UID = 501
const OLD = 'Sat Nov 15 07:00:00 2026'
const NOW_MS = Date.UTC(2026, 10, 15, 8, 0, 0)

function row(pid: number, ppid: number, extra: Partial<OwnershipRow> = {}): OwnershipRow {
  return { pid, ppid, pgid: pid, uid: UID, startedAt: OLD, comm: `p${pid}`, ...extra }
}

function observer(over: Partial<PaneOwnershipObserverDeps> & { tables?: OwnershipRow[][] } = {}) {
  const logs: { event: string; details: Record<string, unknown> }[] = []
  const tables = over.tables ?? []
  let call = 0
  const deps: PaneOwnershipObserverDeps = {
    listAgentRoots: () => [{ sessionId: 's1', rootPid: 10 }],
    readTable: async () => ({
      rows: [row(HOST, 1), ...(tables[Math.min(call++, tables.length - 1)] ?? [])],
      capturedAtMs: (over.now ?? (() => NOW_MS))()
    }),
    readFds: async () => new Map<number, FdInfo[]>(),
    readStartTicks: null,
    listDurableJobs: async () => [],
    readMode: async () => ({ mode: 'observe', requested: null }),
    log: (event, details) => logs.push({ event, details }),
    hostUid: UID,
    hostPid: HOST,
    now: () => NOW_MS,
    ...over
  }
  return { obs: new PaneOwnershipObserver(deps), logs }
}

describe('pane ownership observer (#44 stage 2)', () => {
  it('H1: observe logs a recorded, still-present orphan as would-signal and has no way to signal it', async () => {
    const { obs, logs } = observer({
      tables: [[row(10, 5), row(20, 10)], [row(10, 5), row(20, 1)], [row(20, 1)]]
    })
    await obs.tick()
    await obs.tick()
    obs.noteClose('s1', 'close')
    await obs.observeClose('s1', 'close')
    const entry = logs.find((l) => l.event === 'pane-ownership-entry')!
    expect(entry.details).toMatchObject({
      pid: 20,
      verdict: 'would-signal',
      reason: 'close',
      leftTree: 'reparented-to-1'
    })
    expect(logs.find((l) => l.event === 'pane-ownership-close')!.details).toMatchObject({
      present: 1,
      gone: 0
    })
  })

  it('Linux: a failed first start-ticks read is retried once and the close marker sees that value', async () => {
    const calls: number[] = []
    const { obs, logs } = observer({
      tables: [[row(10, 5), row(20, 10)], [row(20, 1)]],
      readStartTicks: async (pid) => {
        calls.push(pid)
        return calls.length === 1 ? null : '4242'
      },
      // Same fail-closed reader as production: unknown ticks stay null, so the retry is what makes the marker real.
      readKeepMarkers: (targets) =>
        readLinuxKeepMarkers(targets, async (path) =>
          path.endsWith('/stat') ? `9 (x) S ${'0 '.repeat(18)}4242 0` : 'ORCA_PANE_KEEP=1\0'
        )
    })
    await obs.tick()
    await obs.observeClose('s1', 'close')
    expect(calls).toEqual([20, 20])
    expect(logs.find((l) => l.event === 'pane-ownership-entry')!.details).toMatchObject({
      pid: 20,
      startTicks: '4242',
      marker: true,
      verdict: 'kept: marker'
    })
  })

  it('S1: nothing in pane-ownership/ imports a signal or kill function, and the observer is given none', () => {
    const dir = __dirname
    for (const file of readdirSync(dir).filter(
      (f) => f.endsWith('.ts') && !f.endsWith('.test.ts')
    )) {
      const source = readFileSync(join(dir, file), 'utf8')
      expect(source, file).not.toMatch(
        /process\.kill|sendSignal|SignalSender|pidfd_send_signal|\.kill\(/
      )
      expect(source, file).not.toMatch(
        /from '\.\.\/pty-descendant-(termination|exit-verification)'|terminal-session-teardown|local-pty-termination/
      )
    }
    const { obs } = observer()
    expect(Object.getOwnPropertyNames(Object.getPrototypeOf(obs))).not.toEqual(
      expect.arrayContaining(['kill', 'signal'])
    )
  })

  it('M2: a durable job recorded under the pane is kept, every time, also when its meta file appears only later', async () => {
    let jobs: { id: string; pid: number; startedAtMs: number }[] = []
    const { obs, logs } = observer({
      tables: [
        [row(10, 5), row(70, 10, { startedAt: 'Sat Nov 15 07:30:00 2026' })],
        [row(10, 5), row(70, 1, { startedAt: 'Sat Nov 15 07:30:00 2026' })]
      ],
      listDurableJobs: async () => jobs
    })
    await obs.tick() // recorded before the meta file exists
    jobs = [{ id: 'j1', pid: 70, startedAtMs: Date.UTC(2026, 10, 15, 7, 30, 1) }]
    await obs.observeClose('s1', 'close')
    expect(logs.find((l) => l.event === 'pane-ownership-entry')!.details).toMatchObject({
      pid: 70,
      verdict: 'kept: durable-job'
    })
  })

  it('restart: logs the verdict a close would reach, labelled reason=restart', async () => {
    const { obs, logs } = observer({ tables: [[row(10, 5), row(20, 10)], [row(20, 1)]] })
    await obs.tick()
    obs.noteClose('s1', 'restart')
    await obs.observeClose('s1', 'restart')
    expect(logs.find((l) => l.event === 'pane-ownership-entry')!.details).toMatchObject({
      reason: 'restart',
      verdict: 'would-signal'
    })
  })

  it('logs present entries in full and gone ones only as a count', async () => {
    const { obs, logs } = observer({
      tables: [[row(10, 5), row(20, 10), row(21, 10)], [row(20, 1)]]
    })
    await obs.tick()
    await obs.observeClose('s1', 'close')
    expect(
      logs.filter((l) => l.event === 'pane-ownership-entry').map((l) => l.details.pid)
    ).toEqual([20])
    expect(logs.find((l) => l.event === 'pane-ownership-close')!.details).toMatchObject({
      recorded: 2,
      present: 1,
      gone: 1
    })
  })

  it('a process started in the capture second is kept: same-second', async () => {
    const same = 'Sat Nov 15 08:00:00 2026'
    const { obs, logs } = observer({
      tables: [[row(10, 5), row(20, 10, { startedAt: same })], [row(20, 1, { startedAt: same })]]
    })
    await obs.tick()
    await obs.observeClose('s1', 'close')
    expect(logs.find((l) => l.event === 'pane-ownership-entry')!.details.verdict).toBe(
      'kept: same-second'
    )
  })

  it('L11: 10 failed reads log once; the first good read logs the recovery', async () => {
    let fail = true
    const { obs, logs } = observer({
      readTable: async () => {
        if (fail) {
          throw new Error('ps timed out')
        }
        return { rows: [row(HOST, 1), row(10, 5)], capturedAtMs: NOW_MS }
      }
    })
    for (let i = 0; i < SAMPLER_FAILURES_BEFORE_LOG + 5; i += 1) {
      await obs.tick()
    }
    expect(logs.filter((l) => l.event === 'pane-ownership-sampler-failing')).toHaveLength(1)
    expect(obs.status().failures).toBe(SAMPLER_FAILURES_BEFORE_LOG + 5)
    fail = false
    await obs.tick()
    expect(logs.some((l) => l.event === 'pane-ownership-sampler-recovered')).toBe(true)
    expect(obs.status().failures).toBe(0)
  })

  it('off clears every set and samples nothing; kill reads as observe and is noted once', async () => {
    let mode: 'off' | 'observe' = 'observe'
    let reads = 0
    const { obs, logs } = observer({
      readMode: async () =>
        mode === 'off' ? { mode: 'off', requested: null } : { mode: 'observe', requested: 'kill' },
      readTable: async () => {
        reads += 1
        return { rows: [row(HOST, 1), row(10, 5), row(20, 10)], capturedAtMs: NOW_MS }
      }
    })
    await obs.tick()
    await obs.tick()
    expect(logs.filter((l) => l.event === 'pane-ownership-kill-not-available')).toHaveLength(1)
    expect(obs.status().entries).toBe(1)
    mode = 'off'
    await obs.tick()
    expect(obs.status().entries).toBe(0)
    expect(reads).toBe(2)
  })

  it('records the std fds of an entry and of its agent root in ONE helper call, at the entry SECOND sighting only (S2, O1)', async () => {
    const calls: { pids: number[]; fds: unknown }[] = []
    let nowMs = NOW_MS
    const { obs } = observer({
      now: () => nowMs,
      tables: [
        [row(10, 5), row(20, 10), row(21, 10)], // 20 and 21 recorded
        [row(10, 5), row(20, 10)], // 20 seen again: due; 21 was short-lived: never read
        [row(10, 5), row(20, 10), row(22, 10)], // 22 recorded
        [row(10, 5), row(20, 10), row(22, 10)] // 22 due: its root is read again in the same call (O1)
      ],
      readFds: async (pids, fds) => {
        calls.push({ pids, fds })
        return new Map()
      }
    })
    for (let i = 0; i < 4; i += 1) {
      nowMs += 1_000
      await obs.tick()
    }
    expect(calls).toEqual([
      { pids: [20, 10], fds: 'all' },
      { pids: [22, 10], fds: 'all' }
    ])
  })

  it('a child recorded BEFORE its job parent was marked kept is kept too (review point 4)', async () => {
    let jobs: { id: string; pid: number; startedAtMs: number }[] = []
    const job = (extra: Partial<OwnershipRow> = {}) =>
      row(70, 10, { startedAt: 'Sat Nov 15 07:30:00 2026', ...extra })
    const child = row(71, 70, { startedAt: 'Sat Nov 15 07:30:00 2026' })
    const { obs, logs } = observer({
      tables: [
        [row(10, 5), job(), child],
        [row(10, 5), job({ ppid: 1 }), child]
      ],
      listDurableJobs: async () => jobs
    })
    await obs.tick() // job and child recorded; no meta file yet
    jobs = [{ id: 'j1', pid: 70, startedAtMs: Date.UTC(2026, 10, 15, 7, 30, 1) }]
    await obs.observeClose('s1', 'close')
    const verdicts = logs
      .filter((l) => l.event === 'pane-ownership-entry')
      .map((l) => [l.details.pid, l.details.verdict])
    expect(verdicts).toEqual([
      [70, 'kept: durable-job'],
      [71, 'kept: durable-job']
    ])
  })

  it('a graceful close is logged once: a tick between the kill settling and the root exit does not re-record it (point 5)', async () => {
    const { obs, logs } = observer({
      tables: [
        [row(10, 5), row(20, 10)],
        [row(10, 5), row(20, 1)],
        [row(10, 5), row(20, 1)]
      ]
    })
    await obs.tick()
    obs.noteClose('s1', 'close')
    await obs.observeClose('s1', 'close')
    await obs.tick() // the root (10) is still alive after SIGTERM
    obs.onRootExit('s1')
    expect(logs.filter((l) => l.event === 'pane-ownership-close')).toHaveLength(1)
    expect(obs.status().panes).toBe(0)
  })

  it('durable jobs are looked up only for YOUNG unmarked entries during ticks (and again at close) (point 2)', async () => {
    let lookups = 0
    let nowMs = NOW_MS
    const { obs } = observer({
      now: () => nowMs,
      tables: [[row(10, 5), row(20, 10)]],
      listDurableJobs: async () => {
        lookups += 1
        return []
      }
    })
    await obs.tick()
    expect(lookups).toBe(1)
    nowMs += 120_000 // entry 20 is now two minutes old
    await obs.tick()
    expect(lookups).toBe(1)
    await obs.observeClose('s1', 'close')
    expect(lookups).toBe(2)
  })

  it('logs one start line with the mode and the reader in use', async () => {
    const { obs, logs } = observer({
      tables: [[row(10, 5)]],
      readTable: async () => ({ rows: [row(HOST, 1), row(10, 5)], capturedAtMs: NOW_MS, via: 'ps' })
    })
    await obs.tick()
    await obs.tick()
    const starts = logs.filter((l) => l.event === 'pane-ownership-start')
    expect(starts).toHaveLength(1)
    expect(starts[0].details).toMatchObject({ mode: 'observe', reader: 'ps' })
  })

  it('backs off: 1 s with agent panes, 10 s with none, doubling up to 60 s while reads fail', async () => {
    let roots = [{ sessionId: 's1', rootPid: 10 }]
    let fail = false
    const { obs } = observer({
      listAgentRoots: () => roots,
      readTable: async () => {
        if (fail) {
          throw new Error('ps failed')
        }
        return { rows: [row(HOST, 1), row(10, 5)], capturedAtMs: NOW_MS }
      }
    })
    await obs.tick()
    expect(obs.nextDelayMs()).toBe(1_000)
    roots = []
    await obs.tick()
    expect(obs.nextDelayMs()).toBe(10_000)
    roots = [{ sessionId: 's1', rootPid: 10 }]
    fail = true
    await obs.tick()
    expect(obs.nextDelayMs()).toBe(2_000)
    for (let i = 0; i < 8; i += 1) {
      await obs.tick()
    }
    expect(obs.nextDelayMs()).toBe(60_000)
  })

  it('observeClose never rejects, even when every reader throws', async () => {
    const { obs, logs } = observer({ tables: [[row(10, 5), row(20, 10)]] })
    await obs.tick()
    const broken = observer({
      readTable: async () => {
        throw new Error('boom')
      }
    })
    await expect(broken.obs.observeClose('s1', 'close')).resolves.toBeUndefined()
    await expect(obs.observeClose('nope', 'close')).resolves.toBeUndefined()
    expect(logs.some((l) => l.event === 'pane-ownership-close-failed')).toBe(false)
  })
})
