import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { PaneSet } from './pane-ownership-sets'
import { lstartUtcToMs } from './pane-ownership-table'

/**
 * Orca's durable jobs (#44, M2): a job whose waiter is gone is KEPT at pane close, every time. The job runner is not
 * changed: its meta file already holds the job's pid and an ISO `startedAt` written right after the job started. A recorded
 * process is that job when the pid matches and its own start lies within DURABLE_START_WINDOW_MS before that time (or
 * up to 1 s after, for second-resolution start times). This also matches jobs started before this code existed.
 */
export type DurableJobRecord = { id: string; pid: number; startedAtMs: number }

export const DURABLE_START_WINDOW_MS = 10_000
const JOB_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/

/** The same root the job runner uses (durable-background-job-plan.mjs `jobRoot`). */
export function durableJobRoot(
  env: NodeJS.ProcessEnv = process.env,
  platform = process.platform
): string {
  if (typeof env.ORCA_DURABLE_JOB_ROOT === 'string' && env.ORCA_DURABLE_JOB_ROOT.length > 0) {
    return env.ORCA_DURABLE_JOB_ROOT
  }
  return platform === 'darwin'
    ? join(homedir(), 'Library', 'Application Support', 'orca', 'durable-jobs')
    : join(homedir(), '.orca', 'durable-jobs')
}

/** A folder with no meta file yet is looked at again at most this often. */
export const MISSING_META_RETRY_MS = 30_000

/**
 * The durable jobs, as an index (#44 S2): a real job root holds thousands of folders (1,831 on the MacBook,
 * 2026-11-15; a full scan took 1.6 s), so each refresh is ONE async readdir and parses only folders it has not parsed
 * yet. A meta file is written once, so a parsed job is never read again; a folder without one is retried at most every
 * 30 s. Async throughout: nothing here blocks the terminal host.
 */
export class DurableJobIndex {
  private readonly jobs = new Map<string, DurableJobRecord>()
  private readonly missingSince = new Map<string, number>()

  constructor(
    private readonly root: string,
    private readonly fs: {
      readdir: (path: string) => Promise<string[]>
      readFile: (path: string) => Promise<string>
    } = { readdir: (path) => readdir(path), readFile: (path) => readFile(path, 'utf8') },
    private readonly now: () => number = Date.now
  ) {}

  async refresh(): Promise<DurableJobRecord[]> {
    let ids: string[]
    try {
      ids = (await this.fs.readdir(this.root)).filter((id) => JOB_ID.test(id))
    } catch {
      this.jobs.clear()
      this.missingSince.clear()
      return []
    }
    const listed = new Set(ids)
    for (const id of [...this.jobs.keys(), ...this.missingSince.keys()]) {
      if (!listed.has(id)) {
        this.jobs.delete(id)
        this.missingSince.delete(id)
      }
    }
    const nowMs = this.now()
    for (const id of ids) {
      const triedAt = this.missingSince.get(id)
      if (this.jobs.has(id) || (triedAt !== undefined && nowMs - triedAt < MISSING_META_RETRY_MS)) {
        continue
      }
      const job = await this.readMeta(id)
      if (job) {
        this.jobs.set(id, job)
        this.missingSince.delete(id)
      } else {
        this.missingSince.set(id, nowMs)
      }
    }
    return [...this.jobs.values()]
  }

  private async readMeta(id: string): Promise<DurableJobRecord | null> {
    try {
      const meta: unknown = JSON.parse(await this.fs.readFile(join(this.root, id, 'meta.json')))
      if (!isMeta(meta)) {
        return null
      }
      const startedAtMs =
        typeof meta.startedAt === 'string' ? Date.parse(meta.startedAt) : Number.NaN
      return typeof meta.pid === 'number' && meta.pid > 1 && Number.isFinite(startedAtMs)
        ? { id, pid: meta.pid, startedAtMs }
        : null
    } catch {
      return null // no meta file yet (the job was recorded before its runner wrote it), or a torn write
    }
  }
}

export function matchDurableJob(
  entry: { pid: number; startedAt: string },
  jobs: readonly DurableJobRecord[]
): DurableJobRecord | null {
  const startMs = lstartUtcToMs(entry.startedAt)
  if (!Number.isFinite(startMs)) {
    return null
  }
  for (const job of jobs) {
    if (
      job.pid === entry.pid &&
      startMs >= job.startedAtMs - DURABLE_START_WINDOW_MS &&
      startMs <= job.startedAtMs + 1_000
    ) {
      return job
    }
  }
  return null
}

function isMeta(value: unknown): value is { pid?: unknown; startedAt?: unknown } {
  return typeof value === 'object' && value !== null
}

/** Unmarked entries are matched against the durable jobs only while younger than this (and once more at close). */
export const DURABLE_CHECK_WINDOW_MS = 60_000

/**
 * M2: marks the young unmarked entries that are Orca durable jobs; none of them, no read. A job's meta file is written
 * within milliseconds of its start, so only young entries can still become one.
 */
export async function markYoungDurable(
  sets: readonly PaneSet[],
  nowMs: number,
  listJobs: () => Promise<DurableJobRecord[]>
): Promise<number> {
  const unmarked = sets
    .flatMap((set) => [...set.entries.values()])
    .filter((e) => e.kept === null && nowMs - e.firstSeenMs < DURABLE_CHECK_WINDOW_MS)
  if (unmarked.length === 0) {
    return 0
  }
  const jobs = await listJobs()
  let marked = 0
  for (const entry of unmarked) {
    if (matchDurableJob(entry, jobs)) {
      entry.kept = 'durable-job'
      marked += 1
    }
  }
  return marked
}
