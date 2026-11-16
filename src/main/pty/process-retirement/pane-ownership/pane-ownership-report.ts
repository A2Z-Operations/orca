import { sharesWithAgent, type FdInfo } from './pane-ownership-fds'
import { lstartUtcToMs, type OwnershipRow } from './pane-ownership-table'
import type { FdRead, RecordedFds } from './pane-ownership-wiring'
import type { OwnedEntry, PaneSet } from './pane-ownership-sets'

/**
 * The observe log's verdicts (#44): what revision 1's rule would have done with each recorded process at this close, or
 * why it would keep it. Only words: nothing in pane-ownership/ can act on a verdict (S1).
 */
export type Verdict =
  | 'would-signal'
  | 'kept: durable-job'
  | 'kept: marker'
  | 'kept: protected-pid'
  | 'kept: two-panes'
  | 'kept: same-second'

export type CloseReason = 'close' | 'restart' | 'exit'

export function verdictFor(
  entry: OwnedEntry,
  context: {
    hostPid: number
    liveRoots: ReadonlySet<number>
    otherPanePids: ReadonlySet<number>
    capturedAtMs: number
  }
): Verdict {
  if (entry.kept === 'durable-job') {
    return 'kept: durable-job'
  }
  if (entry.kept === 'marker') {
    return 'kept: marker'
  }
  if (entry.pid <= 1 || entry.pid === context.hostPid || context.liveRoots.has(entry.pid)) {
    return 'kept: protected-pid'
  }
  if (context.otherPanePids.has(entry.pid)) {
    return 'kept: two-panes'
  }
  // lstart cannot tell two processes apart inside the capture's own second (Linux ticks could; logged, decided in stage 3).
  const startMs = lstartUtcToMs(entry.startedAt)
  if (
    !Number.isFinite(startMs) ||
    Math.floor(startMs / 1_000) === Math.floor(context.capturedAtMs / 1_000)
  ) {
    return 'kept: same-second'
  }
  return 'would-signal'
}

/** Compact fd description for the log: kind and identity only, never contents or arguments. */
export function describeFds(fds: readonly FdInfo[] | undefined): Record<string, string> | null {
  if (!fds) {
    return null
  }
  const out: Record<string, string> = {}
  for (const fd of fds) {
    if (fd.fd <= 2) {
      out[String(fd.fd)] = [fd.kind, fd.id ?? '', fd.peer ? `->${fd.peer}` : '']
        .filter(Boolean)
        .join(' ')
    }
  }
  return out
}

export function entryLine(
  set: PaneSet,
  entry: OwnedEntry,
  row: OwnershipRow,
  details: {
    reason: CloseReason
    verdict: Verdict
    nowMs: number
    agentIds: ReadonlySet<string>
    /** What was read when the entry was recorded (undefined: never read, e.g. gone before a second sample). */
    atRecord: RecordedFds | undefined
    atClose: readonly FdInfo[] | undefined
    closeRead: FdRead
    agentIdsDropped: number
    /** How old the agent root's last fd read is at this close; null if it was never read. */
    rootReadAgeMs: number | null
  }
): Record<string, unknown> {
  const closeFds = details.closeRead === 'ok' ? (details.atClose ?? null) : null
  return {
    sessionId: set.sessionId,
    reason: details.reason,
    verdict: details.verdict,
    pid: entry.pid,
    comm: entry.comm,
    uid: entry.uid,
    ageMs: Math.max(0, details.nowMs - entry.firstSeenMs),
    how: entry.how,
    startTicks: entry.startTicks,
    // #44 (b): only the answer (true / false / null = not read), never any environment text.
    marker: entry.marker,
    ppid: row.ppid,
    leftTree:
      row.ppid === 1
        ? 'reparented-to-1'
        : set.entries.has(row.ppid) || row.ppid === set.rootPid
          ? 'still-linked'
          : 'reparented',
    ownGroup: row.pgid === row.pid,
    fdsAtRecord: describeFds(details.atRecord?.fds ?? undefined),
    fdsAtRecordRead: details.atRecord?.read ?? 'none',
    fdsAtClose: describeFds(closeFds ?? undefined),
    fdsAtCloseRead: details.closeRead,
    // O1: at record, compared with the root's fds read in the same call; at close, with the root's last read.
    sharesWithAgentAtRecord: details.atRecord?.sharesAtRecord ?? null,
    sharesWithAgent: closeFds
      ? closeFds.some((fd) => fd.fd <= 2 && sharesWithAgent(fd, details.agentIds))
      : null,
    agentIdsDropped: details.agentIdsDropped,
    rootReadAgeMs: details.rootReadAgeMs
  }
}

/** A kept mark covers the children of a kept entry, also those recorded before the parent was marked. */
export function inheritKept(present: { entry: OwnedEntry; row: OwnershipRow }[]): void {
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

/** The fds read at record, only if they were read for this same process (pid and start time). */
export function recordFor(
  record: RecordedFds | undefined,
  startedAt: string
): RecordedFds | undefined {
  return record?.startedAt === startedAt ? record : undefined
}

/** Daily counts per verdict and the most common names that would have been signalled: what stage 3 reads. */
export class DailySummary {
  private day: string | null = null
  private verdicts = new Map<string, number>()
  private wouldSignalComms = new Map<string, number>()
  private markedComms = new Map<string, number>()

  add(verdict: Verdict, comm: string): void {
    this.verdicts.set(verdict, (this.verdicts.get(verdict) ?? 0) + 1)
    if (verdict === 'would-signal') {
      this.wouldSignalComms.set(comm, (this.wouldSignalComms.get(comm) ?? 0) + 1)
    }
    if (verdict === 'kept: marker') {
      this.markedComms.set(comm, (this.markedComms.get(comm) ?? 0) + 1)
    }
  }

  /** Returns the finished day's line when the UTC day has changed, else null. */
  roll(nowMs: number): Record<string, unknown> | null {
    const today = new Date(nowMs).toISOString().slice(0, 10)
    if (this.day === null) {
      this.day = today
      return null
    }
    if (today === this.day) {
      return null
    }
    const line = {
      day: this.day,
      verdicts: Object.fromEntries(this.verdicts),
      topWouldSignal: [...this.wouldSignalComms.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10),
      // #44 (b): what users and tools keep with ORCA_PANE_KEEP=1.
      topMarked: [...this.markedComms.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
    }
    this.day = today
    this.verdicts = new Map()
    this.wouldSignalComms = new Map()
    this.markedComms = new Map()
    return line
  }
}
