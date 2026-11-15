import { runProcess } from '@orca/process-host'
import { readFile } from 'node:fs/promises'
import { inProcessSliceMs, runPsInProcess } from '../../../../shared/libproc-process-table'

/** One process as the ownership sampler sees it (#44). `startedAt` is ps `lstart` printed in UTC. */
export type OwnershipRow = {
  pid: number
  ppid: number
  pgid: number
  /** NaN when the reader could not tell (an older native addon); such a read is redone with ps. */
  uid: number
  startedAt: string
  comm: string
}

export type OwnershipCapture = {
  rows: OwnershipRow[]
  /** Which reader answered: the in-process libproc addon (macOS) or a ps process. */
  via?: 'in-process' | 'ps'
  /** Start boundary of the scan, before the reader ran. */
  capturedAtMs: number
}

export const OWNERSHIP_READ_TIMEOUT_MS = 1_000
const PS_MAX_BUFFER_BYTES = 32 * 1024 * 1024
export const OWNERSHIP_PS_ARGS = ['-axo', 'pid=,ppid=,pgid=,uid=,lstart=,comm=']

// lstart under LANG=C: "Sat Nov 15 08:28:00 2026"; a one-digit day is space-padded. comm is last and may hold spaces.
const ROW =
  /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(-?\d+|\?)\s+([A-Z][a-z]{2} [A-Z][a-z]{2} +\d{1,2} \d{2}:\d{2}:\d{2} \d{4})\s+(.*?)\s*$/

export function parseOwnershipTable(output: string): OwnershipRow[] {
  const rows: OwnershipRow[] = []
  for (const line of output.split('\n')) {
    const match = line.match(ROW)
    if (!match) {
      continue
    }
    rows.push({
      pid: Number(match[1]),
      ppid: Number(match[2]),
      pgid: Number(match[3]),
      uid: match[4] === '?' ? Number.NaN : Number(match[4]),
      startedAt: match[5].replace(/ +/g, ' '),
      comm: match[6]
    })
  }
  return rows
}

/** The lstart text read in UTC, as epoch milliseconds; NaN when it does not parse. */
export function lstartUtcToMs(startedAt: string): number {
  const match = startedAt.match(
    /^[A-Z][a-z]{2} ([A-Z][a-z]{2}) (\d{1,2}) (\d{2}):(\d{2}):(\d{2}) (\d{4})$/
  )
  if (!match) {
    return Number.NaN
  }
  const month = MONTHS.indexOf(match[1])
  if (month === -1) {
    return Number.NaN
  }
  return Date.UTC(
    Number(match[6]),
    month,
    Number(match[2]),
    Number(match[3]),
    Number(match[4]),
    Number(match[5])
  )
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * One shared read for every agent pane: the existing columns plus uid and comm, under TZ=UTC (L8) and LANG=C. macOS reads
 * in process through the libproc addon when it can; a read missing any uid, a timed-out in-process read, and Linux use ps.
 */
export async function readOwnershipTable(
  timeoutMs = OWNERSHIP_READ_TIMEOUT_MS,
  deps: {
    runInProcess?: typeof runPsInProcess
    runPs?: (args: string[], env: NodeJS.ProcessEnv, timeoutMs: number) => Promise<string>
    now?: () => number
  } = {}
): Promise<OwnershipCapture> {
  const now = deps.now ?? Date.now
  const runInProcess = deps.runInProcess ?? runPsInProcess
  const runPs = deps.runPs ?? runPsProcess
  const capturedAtMs = now()
  const env = { ...process.env, LANG: 'C', LC_ALL: 'C', TZ: 'UTC' }
  const inProcess = await runInProcess(OWNERSHIP_PS_ARGS, {
    env,
    timeoutMs: inProcessSliceMs(timeoutMs),
    callerRunsPs: true
  })
  if (inProcess && !inProcess.timedOut) {
    const rows = parseOwnershipTable(inProcess.stdout)
    if (rows.length > 0 && rows.every((row) => Number.isFinite(row.uid))) {
      return { rows, capturedAtMs, via: 'in-process' }
    }
  }
  return {
    rows: parseOwnershipTable(await runPs(OWNERSHIP_PS_ARGS, env, timeoutMs)),
    capturedAtMs,
    via: 'ps'
  }
}

async function runPsProcess(
  args: string[],
  env: NodeJS.ProcessEnv,
  timeoutMs: number
): Promise<string> {
  const result = await runProcess({
    program: 'ps',
    args,
    env,
    timeoutMs,
    maxOutputBytes: PS_MAX_BUFFER_BYTES
  })
  if (result.timedOut || result.code !== 0) {
    throw new Error(`ps ${result.timedOut ? 'timed out' : `exited ${result.code}`}`)
  }
  return result.stdout
}

/**
 * Linux only: the start time in clock ticks since boot, field 22 of /proc/<pid>/stat. Exact, and independent of time zone
 * and locale (L8). Read only for rows being recorded, never for the whole table (S2). Null when the process is gone.
 */
export async function readLinuxStartTicks(
  pid: number,
  read: (path: string) => Promise<string> = (path) => readFile(path, 'utf8')
): Promise<string | null> {
  try {
    const stat = await read(`/proc/${pid}/stat`)
    // comm (field 2) is in parentheses and may contain spaces or ')'; fields 3.. follow the LAST ')'.
    const rest = stat
      .slice(stat.lastIndexOf(')') + 1)
      .trim()
      .split(/\s+/)
    const ticks = rest[19]
    return ticks !== undefined && /^\d+$/.test(ticks) ? ticks : null
  } catch {
    return null
  }
}
