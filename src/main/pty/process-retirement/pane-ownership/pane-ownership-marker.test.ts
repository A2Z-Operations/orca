import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  KEEP_MARKER,
  MARKER_CLOSE_BUDGET_MS,
  MARKER_EXIT_GRACE_MS,
  MAX_MARKER_READS_PER_CLOSE,
  markerInEnviron,
  markerInPsReads,
  psEnvOutput,
  readLinuxKeepMarkers,
  readMacKeepMarkers
} from './pane-ownership-marker'
import { PaneOwnershipObserver, type PaneOwnershipObserverDeps } from './pane-ownership-observer'
import type { OwnershipRow } from './pane-ownership-table'
import type { FdInfo } from './pane-ownership-fds'

// #44 stage 3 piece (b), OBSERVE ONLY: ORCA_PANE_KEEP=1 in a process's environment, read once when it is recorded,
// marks it `kept: marker` (and its later children). No signal path; only the verdict changes in the log.

const HOST = 900
const UID = 501
const OLD = 'Sat Nov 15 07:00:00 2026'
const NOW_MS = Date.UTC(2026, 10, 15, 8, 0, 0)
const SECRET = 'GITHUB_TOKEN=ghp_do_not_log_me'

function row(pid: number, ppid: number): OwnershipRow {
  return { pid, ppid, pgid: pid, uid: UID, startedAt: OLD, comm: `p${pid}` }
}

function observer(over: Partial<PaneOwnershipObserverDeps> & { tables: OwnershipRow[][] }) {
  const logs: { event: string; details: Record<string, unknown> }[] = []
  let call = 0
  const deps: PaneOwnershipObserverDeps = {
    listAgentRoots: () => [{ sessionId: 's1', rootPid: 10 }],
    readTable: async () => ({
      rows: [row(HOST, 1), ...(over.tables[Math.min(call++, over.tables.length - 1)] ?? [])],
      capturedAtMs: NOW_MS
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

describe('keep marker parsing', () => {
  it('Linux environ: only the exact NUL-separated entry counts', () => {
    expect(KEEP_MARKER).toBe('ORCA_PANE_KEEP=1')
    expect(markerInEnviron(`PATH=/bin\0ORCA_PANE_KEEP=1\0HOME=/h\0`)).toBe(true)
    expect(markerInEnviron(`PATH=/bin\0ORCA_PANE_KEEP=0\0`)).toBe(false)
    expect(markerInEnviron(`X_ORCA_PANE_KEEP=1\0ORCA_PANE_KEEP=10\0`)).toBe(false)
    expect(markerInEnviron('')).toBe(false)
  })

  // #67: every macOS read carries lstart (UTC, LANG=C), compared with the recorded start: a reused pid is never read.
  const T = { pid: 7, startedAt: OLD, startTicks: null }
  const at = (command: string, start = OLD) => `${start} ${command}`

  it('macOS: matched only in the ENVIRONMENT part (what follows the plain ps command line)', () => {
    const args = '/bin/sleep 30'
    const read = (env: string) => markerInPsReads(T, at(args), at(`${args} ${env}`), at(args))
    expect(read('TERM=xterm ORCA_PANE_KEEP=1 HOME=/h')).toBe(true)
    expect(read('ORCA_PANE_KEEP=10 X_ORCA_PANE_KEEP=1')).toBe(false)
    expect(read('HOME=/h')).toBe(false)
  })

  it('macOS: an ARGUMENT never matches, exact or inside sh -c (Fable-3 S1)', () => {
    const exact = 'echo ORCA_PANE_KEEP=1'
    expect(markerInPsReads(T, at(exact), at(`${exact} HOME=/h`), at(exact))).toBe(false)
    const shc = 'sh -c ORCA_PANE_KEEP=1 npm run dev'
    expect(markerInPsReads(T, at(shc), at(`${shc} HOME=/h`), at(shc))).toBe(false)
  })

  it('macOS residual limit (named): a WORD inside an environment value matches, ps joins entries with spaces', () => {
    expect(
      markerInPsReads(T, at('node s.js'), at('node s.js FOO=x ORCA_PANE_KEEP=1'), at('node s.js'))
    ).toBe(true)
  })

  it('macOS: no answer, or a command line that changed, is null (not read)', () => {
    expect(markerInPsReads(T, '', '', '')).toBeNull()
    expect(markerInPsReads(T, at('node a.js'), '', at('node a.js'))).toBeNull()
    expect(
      markerInPsReads(T, at('node a.js'), at('node b.js ORCA_PANE_KEEP=1'), at('node a.js'))
    ).toBeNull()
  })

  it('#67 S1a: a command line that GREW into the -E read (setproctitle) is null: the two plain reads must agree', () => {
    const grown = 'node a.js ORCA_PANE_KEEP=1'
    expect(markerInPsReads(T, at('node a.js'), at(`${grown} HOME=/h`), at(grown))).toBeNull()
  })

  it('#67 S1b: a REUSED pid (another start time, same command line) is null, on any of the three reads', () => {
    const other = 'Sat Nov 15 07:30:00 2026'
    const cmd = 'node a.js'
    const env = `${cmd} ORCA_PANE_KEEP=1`
    expect(markerInPsReads(T, at(cmd, other), at(env, other), at(cmd, other))).toBeNull()
    expect(markerInPsReads(T, at(cmd), at(env, other), at(cmd))).toBeNull()
    expect(markerInPsReads(T, at(cmd), at(env), at(cmd, other))).toBeNull()
    expect(markerInPsReads(T, at(cmd), at(env), at(cmd))).toBe(true)
  })

  it('#67: lstart is compared space-normalised (a one-digit day is padded by ps)', () => {
    const t = { pid: 7, startedAt: 'Sat Nov 1 07:00:00 2026', startTicks: null }
    const padded = 'Sat Nov  1 07:00:00 2026'
    expect(
      markerInPsReads(t, at('x', padded), at('x ORCA_PANE_KEEP=1', padded), at('x', padded))
    ).toBe(true)
  })

  it('macOS ps outcome: exit 1 with nothing = every pid gone; a timeout, other exit or cut answer fails', () => {
    expect(psEnvOutput({ code: 1, stdout: '', timedOut: false })).toBe('')
    expect(psEnvOutput({ code: 0, stdout: '  1 x', timedOut: false })).toBe('  1 x')
    expect(() => psEnvOutput({ code: null, stdout: '', timedOut: true })).toThrow(/timeout/)
    expect(() => psEnvOutput({ code: 2, stdout: '', timedOut: false })).toThrow(/exit/)
    expect(() =>
      psEnvOutput({ code: 0, stdout: 'x', timedOut: false, outputTruncated: true })
    ).toThrow(/truncated/)
  })
})

describe('keep marker readers', () => {
  const target = (
    pid: number,
    extra: Partial<{ startedAt: string; startTicks: string | null }> = {}
  ) => ({
    pid,
    startedAt: OLD,
    startTicks: null,
    ...extra
  })

  it('macOS: per pid, plain, then -E, then plain again, each with lstart (a pid LIST would read the whole table)', async () => {
    const calls: string[][] = []
    const lines: Record<string, [string, string]> = {
      '101': [`${OLD} a`, `${OLD} a ORCA_PANE_KEEP=1`],
      '102': [`${OLD} b`, `${OLD} b HOME=/h`],
      '105': ['', '']
    }
    const markers = await readMacKeepMarkers(
      [target(101), target(102), target(105)],
      async (args) => {
        calls.push(args)
        const [plain, withEnv] = lines[args.at(-1)!]!
        return args.includes('-wwE') ? withEnv : plain
      }
    )
    expect(calls).toEqual(
      ['101', '102', '105'].flatMap((pid) => [
        ['-wwo', 'lstart=,command=', '-p', pid],
        ['-wwE', '-o', 'lstart=,command=', '-p', pid],
        ['-wwo', 'lstart=,command=', '-p', pid]
      ])
    )
    expect(markers).toEqual(
      new Map([
        [101, true],
        [102, false],
        [105, null]
      ])
    )
    expect(await readMacKeepMarkers([], async () => 'never')).toEqual(new Map())
  })

  it('#67 S2: the WHOLE close is bounded, exit grace included: each read gets what is left minus the grace', async () => {
    let now = 0
    const timeouts: number[] = []
    const markers = await readMacKeepMarkers(
      [target(1), target(2), target(3)],
      async (args, timeoutMs) => {
        timeouts.push(timeoutMs)
        if (args.at(-1) === '1') {
          now += 500 // pid 1: three reads, 1.5 s
          return args.includes('-wwE') ? `${OLD} x ORCA_PANE_KEEP=1` : `${OLD} x`
        }
        // pid 2: a ps that ignores SIGTERM: its cut timeout, then process-host's SIGKILL after the exit grace
        now += timeoutMs + MARKER_EXIT_GRACE_MS
        throw new Error('keep marker read failed: timeout')
      },
      () => now
    )
    // Before Fable-3's S1 the cut read got 3.5 s and its grace ran past the budget: 1.5 + 3.5 + 2 = 7 s here.
    expect(now).toBeLessThanOrEqual(MARKER_CLOSE_BUDGET_MS)
    expect(timeouts).toEqual([2_000, 2_000, 2_000, 1_500])
    expect(markers).toEqual(
      new Map([
        [1, true],
        [2, null],
        [3, null]
      ])
    )
  })

  it('a read that times out with its FULL time (not cut by the budget) still fails the read, as before', async () => {
    await expect(
      readMacKeepMarkers([target(1)], async () => {
        throw new Error('keep marker read failed: timeout')
      })
    ).rejects.toThrow(/timeout/)
  })

  it('N2: inside the cut window, a failure that is NOT a timeout is a failed read (counted), not the budget', async () => {
    let now = 0
    await expect(
      readMacKeepMarkers(
        [target(1), target(2)],
        async (args, timeoutMs) => {
          if (args.at(-1) === '1') {
            now += 500
            return `${OLD} x`
          }
          expect(timeoutMs).toBeLessThan(2_000) // this read is cut by the budget
          throw new Error('keep marker read failed: exit')
        },
        () => now
      )
    ).rejects.toThrow(/exit/)
  })

  it('process-host still uses the exit grace this budget leaves room for (drift guard)', () => {
    const runProcess = readFileSync(
      join(__dirname, '../../../../packages/process-host/src/run-process.ts'),
      'utf8'
    )
    expect(MARKER_EXIT_GRACE_MS).toBe(2_000)
    expect(runProcess).toContain('const PROCESS_EXIT_GRACE_MS = 2_000')
  })

  it('reads at most MAX_MARKER_READS_PER_CLOSE pids; the rest are null (not read)', async () => {
    const pids = Array.from({ length: MAX_MARKER_READS_PER_CLOSE + 2 }, (_, i) => 1000 + i)
    const asked = new Set<string>()
    const mac = await readMacKeepMarkers(
      pids.map((pid) => target(pid)),
      async (args) => {
        asked.add(args.at(-1)!)
        return `${OLD} x`
      }
    )
    expect(asked.size).toBe(MAX_MARKER_READS_PER_CLOSE)
    expect(mac.get(pids.at(-1)!)).toBeNull()
    expect(mac.get(pids[0]!)).toBe(false)
    const linux = await readLinuxKeepMarkers(
      pids.map((pid) => target(pid, { startTicks: '5' })),
      async (path) => (path.endsWith('/stat') ? `9 (x) S ${'0 '.repeat(18)}5 0` : 'A=1\0')
    )
    expect([...linux.values()].filter((v) => v === null)).toHaveLength(2)
  })

  it('Linux: /proc/<pid>/environ per pid; an unreadable one (gone, or another uid) is null', async () => {
    const markers = await readLinuxKeepMarkers(
      [201, 202, 203].map((pid) => target(pid, { startTicks: '5' })),
      async (path) => {
        if (path.endsWith('/stat')) {
          return `9 (x) S ${'0 '.repeat(18)}5 0`
        }
        if (path === '/proc/201/environ') {
          return 'A=1\0ORCA_PANE_KEEP=1\0'
        }
        if (path === '/proc/202/environ') {
          return 'A=1\0'
        }
        throw new Error('EACCES')
      }
    )
    expect(markers).toEqual(
      new Map([
        [201, true],
        [202, false],
        [203, null]
      ])
    )
  })

  it('#67 Linux: a pid whose /proc/<pid>/stat now shows other ticks is null; unknown ticks are null too (N1, fail closed)', async () => {
    const stat = (ticks: string) => `9 (node) S ${'0 '.repeat(18)}${ticks} 0`
    const read = async (path: string) =>
      path.endsWith('/environ')
        ? 'ORCA_PANE_KEEP=1\0'
        : stat(path.startsWith('/proc/301/') ? '500' : '999')
    const markers = await readLinuxKeepMarkers(
      [target(301, { startTicks: '500' }), target(302, { startTicks: '500' }), target(303)],
      read
    )
    expect(markers).toEqual(
      new Map([
        [301, true],
        [302, null],
        [303, null]
      ])
    )
  })
})

describe('observer with the keep marker (observe only)', () => {
  it('a marked process and its later child are kept: marker; ONE read at close, for the present processes only', async () => {
    const asked: number[][] = []
    const { obs, logs } = observer({
      tables: [
        [row(10, 5), row(20, 10)],
        [row(10, 5), row(20, 10), row(21, 20), row(22, 10)],
        [row(20, 1), row(21, 20)]
      ],
      readKeepMarkers: async (targets) => {
        asked.push(targets.map((t) => t.pid))
        return new Map(targets.map((t) => [t.pid, t.pid === 20]))
      }
    })
    await obs.tick()
    await obs.tick()
    expect(asked).toEqual([]) // never per tick: short-lived churn is never read (S2)
    await obs.observeClose('s1', 'close')
    expect(asked).toEqual([[20, 21]]) // 22 exited before the close: not read
    const entries = logs.filter((l) => l.event === 'pane-ownership-entry').map((l) => l.details)
    expect(entries.map((e) => [e.pid, e.verdict, e.marker])).toEqual([
      [20, 'kept: marker', true],
      [21, 'kept: marker', false]
    ])
  })

  it('a failed read leaves marker null ("not read"), never "no marker", and the run goes on', async () => {
    const { obs, logs } = observer({
      tables: [[row(10, 5), row(20, 10)], [row(20, 1)]],
      readKeepMarkers: async () => {
        throw new Error('ps timed out')
      }
    })
    await obs.tick()
    await obs.observeClose('s1', 'close')
    expect(logs.find((l) => l.event === 'pane-ownership-entry')!.details).toMatchObject({
      pid: 20,
      verdict: 'would-signal',
      marker: null
    })
    expect(obs.status().markerFailures).toBe(1)
  })

  it('MUST: no environment text reaches the log, only the marker answer', async () => {
    const { obs, logs } = observer({
      tables: [[row(10, 5), row(20, 10)], [row(20, 1)]],
      readKeepMarkers: (targets) =>
        readMacKeepMarkers(targets, async (args) =>
          args.includes('-wwE')
            ? `${OLD} /bin/sh TERM=x ${SECRET} ORCA_PANE_KEEP=1`
            : `${OLD} /bin/sh`
        )
    })
    await obs.tick()
    await obs.observeClose('s1', 'close')
    const text = JSON.stringify(logs)
    expect(text).not.toContain('ghp_do_not_log_me')
    expect(text).not.toContain('GITHUB_TOKEN')
    expect(text).not.toContain('TERM=x')
    expect(logs.find((l) => l.event === 'pane-ownership-entry')!.details.verdict).toBe(
      'kept: marker'
    )
  })

  it('MUST (error path, Fable-3 M1): ps exits 2 with the token in stdout AND stderr: no token in logs or status', async () => {
    const { obs, logs } = observer({
      tables: [[row(10, 5), row(20, 10)], [row(20, 1)]],
      readKeepMarkers: (targets) =>
        readMacKeepMarkers(targets, async () =>
          psEnvOutput({ code: 2, stdout: `x ${SECRET}`, stderr: `ps: ${SECRET}`, timedOut: false })
        )
    })
    await obs.tick()
    await obs.observeClose('s1', 'close')
    const text = JSON.stringify([logs, obs.status()])
    expect(text).not.toContain('ghp_do_not_log_me')
    expect(text).not.toContain('GITHUB_TOKEN')
    expect(logs.find((l) => l.event === 'pane-ownership-entry')!.details.marker).toBeNull()
    expect(obs.status().markerFailures).toBe(1)
  })

  it('MUST (error path, Fable-3 M1): a read that throws Error(<token>): no token in logs or status', async () => {
    const { obs, logs } = observer({
      tables: [[row(10, 5), row(20, 10)], [row(20, 1)]],
      readKeepMarkers: async () => {
        throw new Error(SECRET)
      }
    })
    await obs.tick()
    await obs.observeClose('s1', 'close')
    const text = JSON.stringify([logs, obs.status()])
    expect(text).not.toContain('ghp_do_not_log_me')
    expect(text).not.toContain('GITHUB_TOKEN')
    expect(logs.some((l) => l.event === 'pane-ownership-close')).toBe(true)
  })

  it('the daily summary counts kept: marker per comm', async () => {
    let now = NOW_MS
    const { obs, logs } = observer({
      tables: [[row(10, 5), row(20, 10)], [row(20, 1)]],
      readKeepMarkers: async (targets) => new Map(targets.map((t) => [t.pid, true])),
      now: () => now
    })
    await obs.tick()
    await obs.observeClose('s1', 'close')
    now += 24 * 60 * 60 * 1000
    await obs.tick()
    expect(logs.find((l) => l.event === 'pane-ownership-daily')!.details).toMatchObject({
      verdicts: { 'kept: marker': 1 },
      topMarked: [['p20', 1]]
    })
  })

  it('the marker module imports no signal or kill function (S1 holds)', () => {
    const source = readFileSync(join(__dirname, 'pane-ownership-marker.ts'), 'utf8')
    expect(source).not.toMatch(/process\.kill|sendSignal|SignalSender|pidfd_send_signal|\.kill\(/)
  })
})
