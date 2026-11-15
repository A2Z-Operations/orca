import { sharesWithAgent, wiringIds, type FdInfo } from './pane-ownership-fds'
import type { LiveAgentRoot, PaneOwnershipSets } from './pane-ownership-sets'

/** The most identities kept per agent root; what does not fit is counted (agentIdsDropped), never silently lost. */
export const MAX_AGENT_IDS = 256
/** A failed fd helper read backs the fd reads off (the table reads go on): 2 s, doubling to 60 s. */
export const FD_BACKOFF_BASE_MS = 2_000
export const FD_MAX_BACKOFF_MS = 60_000

/** How an entry's fds were read: ok; missing = the answer had no line for that pid (it exited); failed = not read (O2). */
export type FdRead = 'ok' | 'missing' | 'failed'

export type RecordedFds = {
  startedAt: string
  /** Std fds 0-2; null when they were not read (see `read`): never "no fds". */
  fds: FdInfo[] | null
  read: FdRead
  /** Compared with the agent root's fds read IN THE SAME CALL (O1); null when the root was not in the answer. */
  sharesAtRecord: boolean | null
}

export type PaneWiringTaken = {
  agentIds: Set<string>
  atRecord: Map<number, RecordedFds>
  /** Ids that did not fit MAX_AGENT_IDS, over the pane's life. */
  agentIdsDropped: number
  /** When the root's fds were last read; null if never. */
  rootReadAtMs: number | null
}

/**
 * What each recorded process was wired to when it was recorded, and what the agent root holds (#44, S4), for the
 * observe log. Cheap (S2): an entry's fds are read once it is seen in a second sample, and every read of a tick is ONE
 * batched call that also reads the due panes' roots (O1: the comparison is never against a root read from before the
 * entry existed). The root's ids are REPLACED at each read, keeping only ids a recorded entry still refers to.
 */
export class PaneWiring {
  private readonly agentIds = new Map<string, Set<string>>()
  private readonly dropped = new Map<string, number>()
  /** Per pane: pid → the fds read for THAT process (its start time), so a reused pid never shows another's fds. */
  private readonly atRecord = new Map<string, Map<number, RecordedFds>>()
  private readonly pending = new Map<string, Set<number>>()
  private readonly rootReadAt = new Map<string, number>()
  private fdFailures = 0
  private fdBackoffUntil = 0
  private fdFailingLogged = false
  private fdFailuresTotal = 0

  constructor(private readonly log: (event: string, details: Record<string, unknown>) => void) {}

  noteRecorded(newly: readonly { sessionId: string; pid: number }[]): void {
    for (const { sessionId, pid } of newly) {
      const set = this.pending.get(sessionId) ?? new Set<number>()
      set.add(pid)
      this.pending.set(sessionId, set)
    }
  }

  /** False while the fd reads are backed off after a failure. */
  fdReadAllowed(nowMs: number): boolean {
    return nowMs >= this.fdBackoffUntil
  }

  /** O2: a failed helper read is counted, logged once per failing run, and backs the fd reads off. */
  noteFdFailure(nowMs: number, error: unknown): void {
    this.fdFailures += 1
    this.fdFailuresTotal += 1
    const backoffMs = Math.min(
      FD_MAX_BACKOFF_MS,
      FD_BACKOFF_BASE_MS * 2 ** Math.min(this.fdFailures - 1, 5)
    )
    this.fdBackoffUntil = nowMs + backoffMs
    if (!this.fdFailingLogged) {
      this.fdFailingLogged = true
      this.log('pane-ownership-fds-failing', { error: String(error), backoffMs })
    }
  }

  noteFdSuccess(): void {
    if (this.fdFailingLogged) {
      this.log('pane-ownership-fds-recovered', { afterFailures: this.fdFailures })
    }
    this.fdFailures = 0
    this.fdBackoffUntil = 0
    this.fdFailingLogged = false
  }

  fdStatus(): { fdFailures: number } {
    return { fdFailures: this.fdFailuresTotal }
  }

  /** Reads the due entries' std fds and their panes' roots' fds in one call; nothing due, no call. */
  async readDue(
    sets: PaneOwnershipSets,
    roots: readonly LiveAgentRoot[],
    readFds: (pids: number[], fds: number[] | 'all') => Promise<Map<number, FdInfo[]>>,
    nowMs: number
  ): Promise<void> {
    this.prune(sets)
    if (!this.fdReadAllowed(nowMs)) {
      return // backed off: due entries stay pending and are read once the back-off is over
    }
    const due = this.due(sets)
    if (due.length === 0) {
      return
    }
    const sessions = new Set(due.map((d) => d.sessionId))
    const rootsToRead = roots.filter((r) => sessions.has(r.sessionId))
    let fds: Map<number, FdInfo[]>
    try {
      fds = await readFds([...due.map((d) => d.pid), ...rootsToRead.map((r) => r.rootPid)], 'all')
    } catch (error) {
      this.noteFdFailure(nowMs, error)
      this.recordUnread(sets, due) // logged as failed unless a later read succeeds
      this.noteRecorded(due)
      return
    }
    this.noteFdSuccess()
    const freshRoot = new Set<string>()
    for (const root of rootsToRead) {
      const rootFds = fds.get(root.rootPid)
      if (rootFds) {
        this.replaceAgentIds(root.sessionId, wiringIds(rootFds))
        this.rootReadAt.set(root.sessionId, nowMs)
        freshRoot.add(root.sessionId)
      }
    }
    for (const { sessionId, pid } of due) {
      const entry = sets.get(sessionId)?.entries.get(pid)
      if (!entry) {
        continue
      }
      const own = fds.get(pid)
      const std = own ? own.filter((fd) => fd.fd <= 2) : null
      const ids = this.agentIds.get(sessionId) ?? new Set<string>()
      this.put(sessionId, pid, {
        startedAt: entry.startedAt,
        fds: std,
        read: own ? 'ok' : 'missing',
        sharesAtRecord:
          std && freshRoot.has(sessionId) ? std.some((fd) => sharesWithAgent(fd, ids)) : null
      })
    }
  }

  /** The std fds of the processes still present at a close: one call, tried even while the tick reads are backed off. */
  async readClose(
    pids: number[],
    readFds: (pids: number[], fds: number[] | 'all') => Promise<Map<number, FdInfo[]>>,
    nowMs: number
  ): Promise<{ fds: Map<number, FdInfo[]>; read: FdRead }> {
    if (pids.length === 0) {
      return { fds: new Map(), read: 'ok' }
    }
    try {
      const fds = await readFds(pids, [0, 1, 2])
      this.noteFdSuccess()
      return { fds, read: 'ok' }
    } catch (error) {
      this.noteFdFailure(nowMs, error)
      return { fds: new Map(), read: 'failed' }
    }
  }

  /** A pane's wiring, removed (at close, exit or restart). */
  take(sessionId: string): PaneWiringTaken {
    const taken: PaneWiringTaken = {
      agentIds: this.agentIds.get(sessionId) ?? new Set<string>(),
      atRecord: this.atRecord.get(sessionId) ?? new Map<number, RecordedFds>(),
      agentIdsDropped: this.dropped.get(sessionId) ?? 0,
      rootReadAtMs: this.rootReadAt.get(sessionId) ?? null
    }
    this.agentIds.delete(sessionId)
    this.atRecord.delete(sessionId)
    this.pending.delete(sessionId)
    this.rootReadAt.delete(sessionId)
    this.dropped.delete(sessionId)
    return taken
  }

  clear(): void {
    this.agentIds.clear()
    this.atRecord.clear()
    this.pending.clear()
    this.rootReadAt.clear()
    this.dropped.clear()
  }

  /** The root's ids NOW, plus the ids a recorded entry of that pane still refers to; the overflow is counted. */
  private replaceAgentIds(sessionId: string, fresh: Set<string>): void {
    const old = this.agentIds.get(sessionId) ?? new Set<string>()
    const next = new Set<string>()
    let over = 0
    const add = (id: string): void => {
      if (next.has(id)) {
        return
      }
      if (next.size < MAX_AGENT_IDS) {
        next.add(id)
      } else {
        over += 1
      }
    }
    for (const id of fresh) {
      add(id)
    }
    for (const record of this.atRecord.get(sessionId)?.values() ?? []) {
      for (const fd of record.fds ?? []) {
        for (const id of [fd.id, fd.peer]) {
          if (id !== null && old.has(id)) {
            add(id)
          }
        }
      }
    }
    this.agentIds.set(sessionId, next)
    if (over > 0) {
      this.dropped.set(sessionId, (this.dropped.get(sessionId) ?? 0) + over)
    }
  }

  private recordUnread(
    sets: PaneOwnershipSets,
    due: readonly { sessionId: string; pid: number }[]
  ): void {
    for (const { sessionId, pid } of due) {
      const entry = sets.get(sessionId)?.entries.get(pid)
      if (entry) {
        this.put(sessionId, pid, {
          startedAt: entry.startedAt,
          fds: null,
          read: 'failed',
          sharesAtRecord: null
        })
      }
    }
  }

  private put(sessionId: string, pid: number, record: RecordedFds): void {
    const byPid = this.atRecord.get(sessionId) ?? new Map<number, RecordedFds>()
    byPid.set(pid, record)
    this.atRecord.set(sessionId, byPid)
  }

  /** Drops wiring of entries the sets no longer hold (or hold as another process), so the map cannot grow forever. */
  private prune(sets: PaneOwnershipSets): void {
    for (const [sessionId, byPid] of this.atRecord) {
      const set = sets.get(sessionId)
      for (const [pid, record] of byPid) {
        if (set?.entries.get(pid)?.startedAt !== record.startedAt) {
          byPid.delete(pid)
        }
      }
    }
  }

  /** Pending entries seen in a later read than the one that recorded them; gone ones are dropped. */
  private due(sets: PaneOwnershipSets): { sessionId: string; pid: number }[] {
    const due: { sessionId: string; pid: number }[] = []
    for (const [sessionId, pending] of this.pending) {
      const set = sets.get(sessionId)
      for (const pid of pending) {
        const entry = set?.entries.get(pid)
        if (!entry) {
          pending.delete(pid)
        } else if (entry.lastSeenMs > entry.firstSeenMs) {
          pending.delete(pid)
          due.push({ sessionId, pid })
        }
      }
      if (pending.size === 0) {
        this.pending.delete(sessionId)
      }
    }
    return due
  }
}
