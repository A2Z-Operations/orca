import { wiringIds, type FdInfo } from './pane-ownership-fds'
import type { LiveAgentRoot, PaneOwnershipSets } from './pane-ownership-sets'

const MAX_AGENT_IDS = 256
/** The agent root's own fds are re-read at most this often (and only when an entry needs its wiring). */
export const ROOT_FDS_REFRESH_MS = 30_000

/**
 * What each recorded process was wired to when it was recorded, and which pipes, sockets and ptys its agent root held
 * (#44, S4), for the observe log. Kept cheap (S2): an entry's fds are read only once it is seen in a second read, so a
 * short-lived command never costs a helper call; every read of a tick is ONE batched call; root fds at most every 30 s.
 */
export class PaneWiring {
  private readonly agentIds = new Map<string, Set<string>>()
  /** Per pane: pid → the fds read for THAT process (its start time), so a reused pid never shows another's fds. */
  private readonly atRecord = new Map<string, Map<number, { startedAt: string; fds: FdInfo[] }>>()
  private readonly pending = new Map<string, Set<number>>()
  private readonly rootReadAt = new Map<string, number>()

  noteRecorded(newly: readonly { sessionId: string; pid: number }[]): void {
    for (const { sessionId, pid } of newly) {
      const set = this.pending.get(sessionId) ?? new Set<number>()
      set.add(pid)
      this.pending.set(sessionId, set)
    }
  }

  /** Reads the due entries' std fds and the due roots' fds in one call; nothing due, no call. */
  async readDue(
    sets: PaneOwnershipSets,
    roots: readonly LiveAgentRoot[],
    readFds: (pids: number[], fds: number[] | 'all') => Promise<Map<number, FdInfo[]>>,
    nowMs: number
  ): Promise<void> {
    this.prune(sets)
    const due = this.due(sets)
    if (due.length === 0) {
      return
    }
    const sessions = new Set(due.map((d) => d.sessionId))
    const rootsToRead = roots.filter(
      (r) =>
        sessions.has(r.sessionId) &&
        nowMs - (this.rootReadAt.get(r.sessionId) ?? Number.NEGATIVE_INFINITY) >=
          ROOT_FDS_REFRESH_MS
    )
    for (const root of rootsToRead) {
      this.rootReadAt.set(root.sessionId, nowMs)
    }
    const fds = await readFds(
      [...due.map((d) => d.pid), ...rootsToRead.map((r) => r.rootPid)],
      'all'
    ).catch(() => new Map<number, FdInfo[]>())
    for (const root of rootsToRead) {
      const ids = this.agentIds.get(root.sessionId) ?? new Set<string>()
      for (const id of wiringIds(fds.get(root.rootPid) ?? [])) {
        if (ids.size < MAX_AGENT_IDS) {
          ids.add(id)
        }
      }
      this.agentIds.set(root.sessionId, ids)
    }
    for (const { sessionId, pid } of due) {
      const entry = sets.get(sessionId)?.entries.get(pid)
      if (!entry) {
        continue
      }
      const byPid =
        this.atRecord.get(sessionId) ?? new Map<number, { startedAt: string; fds: FdInfo[] }>()
      byPid.set(pid, {
        startedAt: entry.startedAt,
        fds: (fds.get(pid) ?? []).filter((fd) => fd.fd <= 2)
      })
      this.atRecord.set(sessionId, byPid)
    }
  }

  /** A pane's wiring, removed (at close, exit or restart). */
  take(sessionId: string): {
    agentIds: Set<string>
    atRecord: Map<number, { startedAt: string; fds: FdInfo[] }>
  } {
    const taken = {
      agentIds: this.agentIds.get(sessionId) ?? new Set<string>(),
      atRecord:
        this.atRecord.get(sessionId) ?? new Map<number, { startedAt: string; fds: FdInfo[] }>()
    }
    this.agentIds.delete(sessionId)
    this.atRecord.delete(sessionId)
    this.pending.delete(sessionId)
    this.rootReadAt.delete(sessionId)
    return taken
  }

  clear(): void {
    this.agentIds.clear()
    this.atRecord.clear()
    this.pending.clear()
    this.rootReadAt.clear()
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
