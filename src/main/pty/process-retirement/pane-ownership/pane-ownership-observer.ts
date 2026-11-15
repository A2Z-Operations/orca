import type { DurableJobRecord } from './pane-ownership-durable'
import { matchDurableJob } from './pane-ownership-durable'
import type { FdInfo } from './pane-ownership-fds'
import { PaneWiring } from './pane-ownership-wiring'
import type { PaneOwnershipModeRead } from './pane-ownership-mode'
import {
  DailySummary,
  entryLine,
  verdictFor,
  type CloseReason,
  type Verdict
} from './pane-ownership-report'
import { PaneOwnershipSets, type LiveAgentRoot, type OwnedEntry } from './pane-ownership-sets'
import type { OwnershipCapture, OwnershipRow } from './pane-ownership-table'

/**
 * #44 stage 2: OBSERVE ONLY. Keeps each agent pane's recorded set while the agent lives and, when the pane closes,
 * restarts or its agent exits, logs what a kill would have reached and why each process would be kept. It is given
 * readers, a clock and a logger; it is never given a way to signal, and nothing in pane-ownership/ imports one (S1).
 * Every tick and every close catches its own errors: nothing thrown here reaches the terminal host (S3).
 */
export type PaneOwnershipObserverDeps = {
  listAgentRoots: () => LiveAgentRoot[]
  readTable: () => Promise<OwnershipCapture>
  /** One batched helper call (macOS lsof) or /proc reads (Linux); 'all' for the agent roots' own fds. */
  readFds: (pids: number[], fds: number[] | 'all') => Promise<Map<number, FdInfo[]>>
  /** Linux only: start ticks of a newly recorded process (S2: never for the whole table). */
  readStartTicks: ((pid: number) => Promise<string | null>) | null
  /** Async and cached (DurableJobIndex): asked only for young unmarked entries and at close (S2). */
  listDurableJobs: () => Promise<DurableJobRecord[]>
  readMode: () => Promise<PaneOwnershipModeRead>
  log: (event: string, details: Record<string, unknown>) => void
  hostUid: number
  hostPid: number
  now?: () => number
  intervalMs?: number
}

export const SAMPLER_INTERVAL_MS = 1_000
/** No agent pane: look again only this often (the cadence is not fixed when nothing changes). */
export const SAMPLER_IDLE_INTERVAL_MS = 10_000
/** A read that keeps failing backs off, doubling up to this. */
export const SAMPLER_MAX_BACKOFF_MS = 60_000
export const SAMPLER_FAILURES_BEFORE_LOG = 10
/** Unmarked entries are matched against the durable jobs only while younger than this (and once more at close). */
export const DURABLE_CHECK_WINDOW_MS = 60_000

function inheritKept(present: { entry: OwnedEntry; row: OwnershipRow }[]): void {
  const byPid = new Map(present.map((p) => [p.entry.pid, p]))
  for (let changed = true; changed;) {
    changed = false
    for (const { entry, row } of present) {
      const parent = byPid.get(row.ppid)?.entry
      if (entry.kept === null && parent?.kept) {
        entry.kept = parent.kept
        changed = true
      }
    }
  }
}

export class PaneOwnershipObserver {
  private readonly sets: PaneOwnershipSets
  private readonly wiring = new PaneWiring()
  private readonly closing = new Map<string, CloseReason>()
  private readonly summary = new DailySummary()
  private inFlight: Promise<void> | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private started = false
  private lastHadRoots = false
  private failures = 0
  private failingLogged = false
  private killNoted = false
  private startLogged = false

  constructor(private readonly deps: PaneOwnershipObserverDeps) {
    this.sets = new PaneOwnershipSets({ hostUid: deps.hostUid, hostPid: deps.hostPid })
  }

  private now(): number {
    return (this.deps.now ?? Date.now)()
  }

  /** A self-rescheduling timer that backs off: 1 s with agent panes, 10 s without, doubling to 60 s on failures. */
  start(): void {
    if (this.started) {
      return
    }
    this.started = true
    this.schedule(this.deps.intervalMs ?? SAMPLER_INTERVAL_MS)
  }

  stop(): void {
    this.started = false
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  /** The wait before the next tick, from what the last one saw. */
  nextDelayMs(): number {
    const base = this.deps.intervalMs ?? SAMPLER_INTERVAL_MS
    if (this.failures > 0) {
      return Math.min(SAMPLER_MAX_BACKOFF_MS, base * 2 ** Math.min(this.failures, 6))
    }
    return this.lastHadRoots ? base : SAMPLER_IDLE_INTERVAL_MS
  }

  private schedule(delayMs: number): void {
    if (!this.started) {
      return
    }
    this.timer = setTimeout(() => {
      void this.tick().finally(() => this.schedule(this.nextDelayMs()))
    }, delayMs)
    this.timer.unref?.()
  }

  /** Diagnostics (L11 and M4's counter). */
  status(): { failures: number; panes: number; entries: number; dropped: number } {
    const all = this.sets.all()
    return {
      failures: this.failures,
      panes: all.length,
      entries: all.reduce((n, set) => n + set.entries.size, 0),
      dropped: all.reduce((n, set) => n + set.dropped, 0)
    }
  }

  tick(): Promise<void> {
    if (this.inFlight) {
      return this.inFlight
    }
    this.inFlight = this.runTick()
      .catch((error: unknown) => this.noteFailure(error))
      .finally(() => {
        this.inFlight = null
      })
    return this.inFlight
  }

  private async runTick(): Promise<void> {
    const mode = await this.deps.readMode()
    if (mode.requested === 'kill' && !this.killNoted) {
      this.killNoted = true
      this.deps.log('pane-ownership-kill-not-available', {
        note: 'stage 2 has no kill mode; observing'
      })
    }
    if (mode.mode === 'off') {
      if (this.sets.all().length > 0) {
        this.sets.clear()
        this.wiring.clear()
        this.deps.log('pane-ownership-off', {})
      }
      return
    }
    const daily = this.summary.roll(this.now())
    if (daily) {
      this.deps.log('pane-ownership-daily', daily)
    }
    const alive = this.deps.listAgentRoots()
    // A closing pane stays out of the sample until its root is gone, so a graceful close (SIGTERM, then exit) is
    // logged once, not again as an exit; ids whose session is gone are dropped.
    const aliveIds = new Set(alive.map((root) => root.sessionId))
    for (const id of this.closing.keys()) {
      if (!aliveIds.has(id)) {
        this.closing.delete(id)
      }
    }
    const roots = alive.filter((root) => !this.closing.has(root.sessionId))
    this.lastHadRoots = roots.length > 0
    if (roots.length === 0) {
      return
    }
    const capture = await this.deps.readTable()
    if (capture.rows.length === 0) {
      this.noteFailure(new Error('empty process table'))
      return
    }
    this.noteSuccess()
    if (!this.startLogged) {
      this.startLogged = true
      this.deps.log('pane-ownership-start', {
        mode: mode.mode,
        reader: capture.via ?? 'unknown',
        platform: process.platform
      })
    }
    const { newlyRecorded } = this.sets.sample(capture, roots)
    await this.markDurable()
    this.wiring.noteRecorded(newlyRecorded)
    for (const { sessionId, pid } of newlyRecorded) {
      const entry = this.sets.get(sessionId)?.entries.get(pid)
      if (entry && this.deps.readStartTicks) {
        entry.startTicks = await this.deps.readStartTicks(pid).catch(() => null)
      }
    }
    await this.wiring.readDue(this.sets, roots, this.deps.readFds, this.now())
  }

  /** The agent root's own fd ids and each new entry's std fds, in ONE helper call, only when something new was recorded. */
  /** M2: unmarked entries are re-checked against the durable jobs every tick (and again at close); none unmarked, no read. */
  private async markDurable(): Promise<number> {
    // A job's meta file is written within milliseconds of its start, so only young entries can still become one.
    const nowMs = this.now()
    const unmarked = this.sets
      .all()
      .flatMap((set) => [...set.entries.values()])
      .filter((e) => e.kept === null && nowMs - e.firstSeenMs < DURABLE_CHECK_WINDOW_MS)
    if (unmarked.length === 0) {
      return 0
    }
    const jobs = await this.deps.listDurableJobs()
    let marked = 0
    for (const entry of unmarked) {
      if (matchDurableJob(entry, jobs)) {
        entry.kept = 'durable-job'
        marked += 1
      }
    }
    return marked
  }

  /** Called synchronously before the host starts a kill, so the next tick no longer samples that session. */
  noteClose(sessionId: string, reason: CloseReason): void {
    this.closing.set(sessionId, reason)
  }

  /** The agent root exited by itself while its pane stayed open: log the set now (the session is reaped). */
  onRootExit(sessionId: string): void {
    if (this.closing.has(sessionId)) {
      this.closing.delete(sessionId) // its close was (or is being) logged; the root is now gone
      return
    }
    void this.observeClose(sessionId, 'exit')
  }

  /**
   * After today's sweep has run (the host calls this once the kill promise settled, never awaiting it): log every
   * recorded process still present, with its verdict, and the gone ones as a count. Sends nothing. Never rejects.
   */
  async observeClose(sessionId: string, reason: CloseReason): Promise<void> {
    try {
      await this.inFlight
      const set = this.sets.take(sessionId)
      const { agentIds, atRecord } = this.wiring.take(sessionId)
      if (!set || (await this.deps.readMode()).mode === 'off') {
        return
      }
      const capture = set.entries.size > 0 ? await this.deps.readTable().catch(() => null) : null
      const rows = new Map<number, OwnershipRow | null>()
      for (const row of capture?.rows ?? []) {
        rows.set(row.pid, rows.has(row.pid) ? null : row)
      }
      const jobs = set.entries.size > 0 ? await this.deps.listDurableJobs() : []
      const present: { entry: OwnedEntry; row: OwnershipRow }[] = []
      let gone = 0
      for (const entry of set.entries.values()) {
        const row = rows.get(entry.pid)
        if (!row || row.startedAt !== entry.startedAt || row.uid !== entry.uid) {
          gone += 1
          continue
        }
        if (entry.kept === null && matchDurableJob(entry, jobs)) {
          entry.kept = 'durable-job'
        }
        present.push({ entry, row })
      }
      // A kept mark covers the children of a kept entry, also those recorded before the parent was marked.
      inheritKept(present)
      const closeFds =
        present.length > 0
          ? await this.deps
              .readFds(
                present.map((p) => p.entry.pid),
                [0, 1, 2]
              )
              .catch(() => new Map<number, FdInfo[]>())
          : new Map<number, FdInfo[]>()
      const context = {
        hostPid: this.deps.hostPid,
        liveRoots: new Set(this.deps.listAgentRoots().map((r) => r.rootPid)),
        otherPanePids: new Set(this.sets.all().flatMap((other) => [...other.entries.keys()])),
        capturedAtMs: capture?.capturedAtMs ?? this.now()
      }
      const counts: Record<string, number> = {}
      const nowMs = this.now()
      for (const { entry, row } of present) {
        const verdict: Verdict = verdictFor(entry, context)
        counts[verdict] = (counts[verdict] ?? 0) + 1
        this.summary.add(verdict, entry.comm)
        this.deps.log(
          'pane-ownership-entry',
          entryLine(set, entry, row, {
            reason,
            verdict,
            nowMs,
            agentIds,
            atRecord:
              atRecord.get(entry.pid)?.startedAt === entry.startedAt
                ? atRecord.get(entry.pid)?.fds
                : undefined,
            atClose: closeFds.get(entry.pid)
          })
        )
      }
      this.deps.log('pane-ownership-close', {
        sessionId,
        reason,
        recorded: set.entries.size,
        present: present.length,
        gone,
        dropped: set.dropped,
        rootRecycled: set.rootRecycled,
        readFailed: set.entries.size > 0 && capture === null,
        verdicts: counts
      })
    } catch (error) {
      this.deps.log('pane-ownership-close-failed', { sessionId, reason, error: String(error) })
    }
  }

  private noteFailure(error: unknown): void {
    this.failures += 1
    if (this.failures >= SAMPLER_FAILURES_BEFORE_LOG && !this.failingLogged) {
      this.failingLogged = true
      this.deps.log('pane-ownership-sampler-failing', {
        failures: this.failures,
        error: String(error)
      })
    }
  }

  private noteSuccess(): void {
    if (this.failingLogged) {
      this.deps.log('pane-ownership-sampler-recovered', { afterFailures: this.failures })
    }
    this.failures = 0
    this.failingLogged = false
  }
}
