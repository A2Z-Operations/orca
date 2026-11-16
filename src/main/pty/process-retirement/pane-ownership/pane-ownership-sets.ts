import type { OwnershipCapture, OwnershipRow } from './pane-ownership-table'

/**
 * The recorded sets of #44, as pure state: a process table goes in, entries come out. No timers, no I/O, and nothing here
 * (or anywhere in pane-ownership/) can send a signal: stage 2 only observes (S1).
 */
export type KeptReason = 'durable-job' | 'marker'

export type OwnedEntry = {
  pid: number
  startedAt: string
  uid: number
  comm: string
  /** Linux clock ticks since boot (exact start); filled by the observer for new entries only (S2). */
  startTicks: string | null
  how: 'under-root' | 'under-recorded'
  firstSeenMs: number
  lastSeenMs: number
  /** Consecutive COMPLETE reads that did not contain this pid (M4). */
  missingCompleteReads: number
  kept: KeptReason | null
  /** #44 (b): ORCA_PANE_KEEP=1 in its start environment; null = not read (yet, or the read failed). */
  marker: boolean | null
}

export type PaneSet = {
  sessionId: string
  rootPid: number
  rootStartedAt: string | null
  /** The root's pid now names another process: sampling stopped, the set is kept until close (M7). */
  rootRecycled: boolean
  entries: Map<number, OwnedEntry>
  dropped: number
}

export type LiveAgentRoot = { sessionId: string; rootPid: number }

export type SampleResult = {
  /** Contains the host's own pid and every live root: only such a read may remove an entry (M4). */
  complete: boolean
  newlyRecorded: { sessionId: string; pid: number }[]
}

export const ABSENT_COMPLETE_READS_TO_FORGET = 25
export const MAX_ENTRIES_PER_PANE = 4_096

export class PaneOwnershipSets {
  private readonly sets = new Map<string, PaneSet>()

  constructor(
    private readonly options: {
      hostUid: number
      hostPid: number
      cap?: number
      absentReadsToForget?: number
    }
  ) {}

  get(sessionId: string): PaneSet | undefined {
    return this.sets.get(sessionId)
  }

  /** Removes and returns a pane's set (at close, exit or restart). */
  take(sessionId: string): PaneSet | undefined {
    const set = this.sets.get(sessionId)
    this.sets.delete(sessionId)
    return set
  }

  clear(): void {
    this.sets.clear()
  }

  all(): PaneSet[] {
    return [...this.sets.values()]
  }

  sample(capture: OwnershipCapture, live: readonly LiveAgentRoot[]): SampleResult {
    const byPid = new Map<number, OwnershipRow | null>()
    const children = new Map<number, OwnershipRow[]>()
    for (const row of capture.rows) {
      // Two rows for one pid (a non-atomic read) make that pid ambiguous for this read.
      byPid.set(row.pid, byPid.has(row.pid) ? null : row)
      const siblings = children.get(row.ppid)
      if (siblings) {
        siblings.push(row)
      } else {
        children.set(row.ppid, [row])
      }
    }
    const complete =
      byPid.get(this.options.hostPid) != null &&
      live.every(({ rootPid }) => byPid.get(rootPid) != null)
    const liveRoots = new Set(live.map(({ rootPid }) => rootPid))
    const newlyRecorded: SampleResult['newlyRecorded'] = []

    for (const { sessionId, rootPid } of live) {
      let set = this.sets.get(sessionId)
      if (!set || set.rootPid !== rootPid) {
        set = {
          sessionId,
          rootPid,
          rootStartedAt: null,
          rootRecycled: false,
          entries: new Map(),
          dropped: 0
        }
        this.sets.set(sessionId, set)
      }
      this.refresh(set, byPid, complete, capture.capturedAtMs)
      if (set.rootRecycled) {
        continue
      }
      const root = byPid.get(rootPid)
      if (!root) {
        continue // missing or duplicated root: a failed read for this pane, add nothing and clear nothing
      }
      if (set.rootStartedAt === null) {
        set.rootStartedAt = root.startedAt
      } else if (set.rootStartedAt !== root.startedAt) {
        set.rootRecycled = true // M7: stop sampling, keep the set
        continue
      }
      // Pass 1: everything still linked under the root. Pass 2: children of recorded entries that are still present as
      // themselves but no longer linked (M3: the set is closed under children).
      const visited = new Set<number>([rootPid])
      const walk = (
        starts: { pid: number; kept: KeptReason | null }[],
        how: OwnedEntry['how']
      ): void => {
        const queue = [...starts]
        for (let index = 0; index < queue.length; index += 1) {
          const parent = queue[index]
          for (const child of children.get(parent.pid) ?? []) {
            if (visited.has(child.pid) || byPid.get(child.pid) !== child) {
              continue
            }
            visited.add(child.pid)
            const kept = parent.kept ?? set.entries.get(child.pid)?.kept ?? null
            queue.push({ pid: child.pid, kept })
            if (this.record(set, child, how, kept, capture.capturedAtMs, liveRoots)) {
              newlyRecorded.push({ sessionId, pid: child.pid })
            }
          }
        }
      }
      walk([{ pid: rootPid, kept: null }], 'under-root')
      const orphans: { pid: number; kept: KeptReason | null }[] = []
      for (const entry of set.entries.values()) {
        const row = byPid.get(entry.pid)
        if (
          !visited.has(entry.pid) &&
          row &&
          row.startedAt === entry.startedAt &&
          row.uid === entry.uid
        ) {
          visited.add(entry.pid)
          orphans.push({ pid: entry.pid, kept: entry.kept })
        }
      }
      walk(orphans, 'under-recorded')
    }
    return { complete, newlyRecorded }
  }

  /** Present entries are refreshed; a pid now naming another process is forgotten; absence counts only on complete reads. */
  private refresh(
    set: PaneSet,
    byPid: Map<number, OwnershipRow | null>,
    complete: boolean,
    nowMs: number
  ): void {
    for (const entry of set.entries.values()) {
      const row = byPid.get(entry.pid)
      if (row === null) {
        continue // ambiguous in this read
      }
      if (row) {
        if (row.startedAt !== entry.startedAt || row.uid !== entry.uid) {
          set.entries.delete(entry.pid) // pid reuse: the recorded process is gone
          continue
        }
        entry.missingCompleteReads = 0
        entry.lastSeenMs = nowMs
        continue
      }
      if (complete) {
        entry.missingCompleteReads += 1
        if (
          entry.missingCompleteReads >=
          (this.options.absentReadsToForget ?? ABSENT_COMPLETE_READS_TO_FORGET)
        ) {
          set.entries.delete(entry.pid)
        }
      }
    }
  }

  private record(
    set: PaneSet,
    row: OwnershipRow,
    how: OwnedEntry['how'],
    kept: KeptReason | null,
    nowMs: number,
    liveRoots: ReadonlySet<number>
  ): boolean {
    // Own uid only (L10); never pid 1, the host, or any pane root.
    if (
      row.uid !== this.options.hostUid ||
      row.pid <= 1 ||
      row.pid === this.options.hostPid ||
      liveRoots.has(row.pid)
    ) {
      return false
    }
    const existing = set.entries.get(row.pid)
    if (existing && existing.startedAt === row.startedAt) {
      // a child recorded before its parent was marked kept takes the mark on the next walk
      if (kept && existing.kept === null) {
        existing.kept = kept
      }
      return false
    }
    if (!existing && set.entries.size >= (this.options.cap ?? MAX_ENTRIES_PER_PANE)) {
      this.dropOne(set)
    }
    set.entries.set(row.pid, {
      pid: row.pid,
      startedAt: row.startedAt,
      uid: row.uid,
      comm: row.comm,
      startTicks: null,
      how,
      firstSeenMs: nowMs,
      lastSeenMs: nowMs,
      missingCompleteReads: 0,
      kept,
      marker: null
    })
    return true
  }

  /** At the cap: an entry absent from the latest complete read goes first, then the oldest (M4). */
  private dropOne(set: PaneSet): void {
    let victim: OwnedEntry | null = null
    for (const entry of set.entries.values()) {
      const better =
        victim === null ||
        (entry.missingCompleteReads > 0 && victim.missingCompleteReads === 0) ||
        (entry.missingCompleteReads > 0 === victim.missingCompleteReads > 0 &&
          entry.firstSeenMs < victim.firstSeenMs)
      if (better) {
        victim = entry
      }
    }
    if (victim) {
      set.entries.delete(victim.pid)
      set.dropped += 1
    }
  }
}
