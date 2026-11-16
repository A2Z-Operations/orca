import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  KEEP_MARKER,
  MARKER_CLOSE_BUDGET_MS,
  MAX_MARKER_READS_PER_CLOSE,
  markerInEnviron,
  markerInPsLines,
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

  it('macOS: matched only in the ENVIRONMENT part (what follows the plain ps command line)', () => {
    const args = '/bin/sleep 30'
    expect(markerInPsLines(args, `${args} TERM=xterm ORCA_PANE_KEEP=1 HOME=/h`)).toBe(true)
    expect(markerInPsLines(args, `${args} ORCA_PANE_KEEP=10 X_ORCA_PANE_KEEP=1`)).toBe(false)
    expect(markerInPsLines(args, `${args} HOME=/h`)).toBe(false)
  })

  it('macOS: an ARGUMENT never matches, exact or inside sh -c (Fable-3 S1)', () => {
    expect(markerInPsLines('echo ORCA_PANE_KEEP=1', 'echo ORCA_PANE_KEEP=1 HOME=/h')).toBe(false)
    const shc = 'sh -c ORCA_PANE_KEEP=1 npm run dev'
    expect(markerInPsLines(shc, `${shc} HOME=/h`)).toBe(false)
  })

  it('macOS residual limit (named): a WORD inside an environment value matches, ps joins entries with spaces', () => {
    expect(markerInPsLines('node s.js', 'node s.js FOO=x ORCA_PANE_KEEP=1')).toBe(true)
  })

  it('macOS: no answer, or a command line that changed between the two reads, is null (not read)', () => {
    expect(markerInPsLines('', '')).toBeNull()
    expect(markerInPsLines('node a.js', '')).toBeNull()
    expect(markerInPsLines('node a.js', 'node b.js ORCA_PANE_KEEP=1')).toBeNull()
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
  it('macOS: per pid, one plain ps then one ps -E (a pid LIST would read the whole table); a gone pid is null', async () => {
    const calls: string[][] = []
    const lines: Record<string, [string, string]> = {
      '101': ['a', 'a ORCA_PANE_KEEP=1'],
      '102': ['b', 'b HOME=/h'],
      '105': ['', '']
    }
    const markers = await readMacKeepMarkers([101, 102, 105], async (args) => {
      calls.push(args)
      const [plain, withEnv] = lines[args.at(-1)!]!
      return args.includes('-wwE') ? withEnv : plain
    })
    expect(calls).toEqual(
      ['101', '102', '105'].flatMap((pid) => [
        ['-wwo', 'command=', '-p', pid],
        ['-wwE', '-o', 'command=', '-p', pid]
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

  it('macOS: a close stops reading after MARKER_CLOSE_BUDGET_MS in total; the rest are null', async () => {
    let now = 0
    const markers = await readMacKeepMarkers(
      [1, 2, 3],
      async (args) => {
        now += MARKER_CLOSE_BUDGET_MS / 2 // each pid's two reads take the whole budget
        return args.includes('-wwE') ? 'x ORCA_PANE_KEEP=1' : 'x'
      },
      () => now
    )
    expect(markers).toEqual(
      new Map([
        [1, true],
        [2, null],
        [3, null]
      ])
    )
  })

  it('reads at most MAX_MARKER_READS_PER_CLOSE pids; the rest are null (not read)', async () => {
    const pids = Array.from({ length: MAX_MARKER_READS_PER_CLOSE + 2 }, (_, i) => 1000 + i)
    const asked = new Set<string>()
    const mac = await readMacKeepMarkers(pids, async (args) => {
      asked.add(args.at(-1)!)
      return 'x'
    })
    expect(asked.size).toBe(MAX_MARKER_READS_PER_CLOSE)
    expect(mac.get(pids.at(-1)!)).toBeNull()
    expect(mac.get(pids[0]!)).toBe(false)
    const linux = await readLinuxKeepMarkers(pids, async () => 'A=1\0')
    expect([...linux.values()].filter((v) => v === null)).toHaveLength(2)
  })

  it('Linux: /proc/<pid>/environ per pid; an unreadable one (gone, or another uid) is null', async () => {
    const markers = await readLinuxKeepMarkers([201, 202, 203], async (path) => {
      if (path === '/proc/201/environ') {
        return 'A=1\0ORCA_PANE_KEEP=1\0'
      }
      if (path === '/proc/202/environ') {
        return 'A=1\0'
      }
      throw new Error('EACCES')
    })
    expect(markers).toEqual(
      new Map([
        [201, true],
        [202, false],
        [203, null]
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
      readKeepMarkers: async (pids) => {
        asked.push([...pids])
        return new Map(pids.map((pid) => [pid, pid === 20]))
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
      readKeepMarkers: (pids) =>
        readMacKeepMarkers(pids, async (args) =>
          args.includes('-wwE') ? `/bin/sh TERM=x ${SECRET} ORCA_PANE_KEEP=1` : '/bin/sh'
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
      readKeepMarkers: (pids) =>
        readMacKeepMarkers(pids, async () =>
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
      readKeepMarkers: async (pids) => new Map(pids.map((pid) => [pid, true])),
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
