import { markYoungDurable, matchDurableJob, type DurableJobRecord } from './pane-ownership-durable'
import type { FdInfo } from './pane-ownership-fds'
import { PaneCarry } from './pane-ownership-carry'
import { applyKeepMarkers, type KeepMarkers } from './pane-ownership-marker'
import { PaneClosing } from './pane-ownership-closing'
import { SamplerHealth } from './pane-ownership-health'
import { PaneWiring } from './pane-ownership-wiring'
import type { PaneOwnershipModeRead } from './pane-ownership-mode'
import {
  DailySummary,
  entryLine,
  inheritKept,
  recordFor,
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
  /**
   * #44 (b): ORCA_PANE_KEEP=1 per pid, ONE batched read at close for the processes still present (a verdict is only
   * needed then; short-lived churn is never read: S2). null/absent = not read.
   */
  readKeepMarkers?: ((pids: number[]) => Promise<KeepMarkers>) | null
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
/** O3: when the table is read through ps (Linux, or macOS without the in-process reader), tick this slowly instead. */
export const SAMPLER_PS_INTERVAL_MS = 5_000
/** No agent pane: look again only this often (the cadence is not fixed when nothing changes). */
export const SAMPLER_IDLE_INTERVAL_MS = 10_000
/** A read that keeps failing backs off, doubling up to this. */
export const SAMPLER_MAX_BACKOFF_MS = 60_000
export { SAMPLER_FAILURES_BEFORE_LOG } from './pane-ownership-health'

export class PaneOwnershipObserver {
  private readonly sets: PaneOwnershipSets
  private readonly wiring: PaneWiring
  private readonly closing: PaneClosing
  private readonly carry: PaneCarry
  private lastVia: 'in-process' | 'ps' | 'unknown' = 'unknown'
  private readonly summary = new DailySummary()
  private inFlight: Promise<void> | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private started = false
  private lastHadRoots = false
  private markerFailures = 0
  private readonly health: SamplerHealth
  private killNoted = false
  private startLogged = false

  constructor(private readonly deps: PaneOwnershipObserverDeps) {
    this.sets = new PaneOwnershipSets({ hostUid: deps.hostUid, hostPid: deps.hostPid })
    this.wiring = new PaneWiring(deps.log)
    this.closing = new PaneClosing(deps.log)
    this.health = new SamplerHealth(deps.log)
    this.carry = new PaneCarry(deps.log)
  }

  private now(): number {
    return (this.deps.now ?? Date.now)()
  }

  /** A self-rescheduling timer that backs off: 1 s with agent panes (5 s on ps), 10 s without, doubling to 60 s on failures. */
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

  /** The tick while agent panes exist: the in-process reader's pace, or the slower ps pace (O3). */
  activeIntervalMs(): number {
    const base = this.deps.intervalMs ?? SAMPLER_INTERVAL_MS
    return this.lastVia === 'ps' ? Math.max(base, SAMPLER_PS_INTERVAL_MS) : base
  }

  /** The wait before the next tick, from what the last one saw. */
  nextDelayMs(): number {
    const base = this.activeIntervalMs()
    if (this.health.failures > 0) {
      return Math.min(SAMPLER_MAX_BACKOFF_MS, base * 2 ** Math.min(this.health.failures, 6))
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
  status(): {
    failures: number
    fdFailures: number
    closesUnfinished: number
    markerFailures: number
    panes: number
    entries: number
    dropped: number
  } {
    const all = this.sets.all()
    return {
      failures: this.health.failures,
      fdFailures: this.wiring.fdStatus().fdFailures,
      closesUnfinished: this.closing.unfinishedCount(),
      markerFailures: this.markerFailures,
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
      .catch((error: unknown) => this.health.failure(error))
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
      this.carry.clear()
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
    this.closing.settle(aliveIds, this.now())
    this.carry.expire(this.now())
    const roots = alive.filter((root) => !this.closing.has(root.sessionId))
    this.lastHadRoots = roots.length > 0
    if (roots.length === 0) {
      return
    }
    const capture = await this.deps.readTable()
    if (capture.rows.length === 0) {
      this.health.failure(new Error('empty process table'))
      return
    }
    this.health.success()
    this.lastVia = capture.via ?? 'unknown'
    if (!this.startLogged) {
      this.startLogged = true
      this.deps.log('pane-ownership-start', {
        mode: mode.mode,
        reader: this.lastVia,
        intervalMs: this.activeIntervalMs(),
        platform: process.platform
      })
    }
    const { newlyRecorded } = this.sets.sample(capture, roots)
    this.carry.adopt(this.sets)
    await markYoungDurable(this.sets.all(), this.now(), this.deps.listDurableJobs)
    this.wiring.noteRecorded(newlyRecorded)
    for (const { sessionId, pid } of newlyRecorded) {
      const entry = this.sets.get(sessionId)?.entries.get(pid)
      if (entry && this.deps.readStartTicks) {
        entry.startTicks = await this.deps.readStartTicks(pid).catch(() => null)
      }
    }
    await this.wiring.readDue(this.sets, roots, this.deps.readFds, this.now())
  }

  /** Called synchronously before the host starts a kill, so the next tick no longer samples that session. */
  noteClose(sessionId: string, reason: CloseReason): void {
    this.closing.note(sessionId, reason, this.now())
  }

  /** #44 (a): the replacement `sessionId` names the session it replaces (main's replacesPtyId). Observe only. */
  noteCarry(sessionId: string, fromSessionId: string): void {
    this.carry.claim(sessionId, fromSessionId, this.now())
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
      const wiring = this.wiring.take(sessionId)
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
      if (
        !(await applyKeepMarkers(
          present.map((p) => p.entry),
          this.deps.readKeepMarkers
        ))
      ) {
        this.markerFailures += 1
      }
      // A kept mark covers the children of a kept entry, also those recorded before the parent was marked.
      inheritKept(present)
      const { fds: closeFds, read: closeCall } = await this.wiring.readClose(
        present.map((p) => p.entry.pid),
        this.deps.readFds,
        this.now()
      )
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
            agentIds: wiring.agentIds,
            atRecord: recordFor(wiring.atRecord.get(entry.pid), entry.startedAt),
            atClose: closeFds.get(entry.pid),
            closeRead: closeCall === 'ok' && !closeFds.has(entry.pid) ? 'missing' : closeCall,
            agentIdsDropped: wiring.agentIdsDropped,
            rootReadAgeMs: wiring.rootReadAtMs === null ? null : nowMs - wiring.rootReadAtMs
          })
        )
      }
      if (reason === 'restart') {
        this.carry.hold(
          sessionId,
          present.map((p) => p.entry),
          nowMs
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
        fdsAtCloseRead: present.length > 0 ? closeCall : null,
        agentIdsDropped: wiring.agentIdsDropped,
        rootReadAgeMs: wiring.rootReadAtMs === null ? null : this.now() - wiring.rootReadAtMs,
        verdicts: counts
      })
    } catch (error) {
      this.deps.log('pane-ownership-close-failed', { sessionId, reason, error: String(error) })
    } finally {
      this.closing.observed(sessionId, this.now())
    }
  }
}
