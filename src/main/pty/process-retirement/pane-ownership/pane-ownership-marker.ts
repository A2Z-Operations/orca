import { runProcess } from '@orca/process-host'
import { readFile } from 'node:fs/promises'
import type { OwnedEntry } from './pane-ownership-sets'
import { readLinuxStartTicks } from './pane-ownership-table'

/**
 * #44 stage 3 piece (b), OBSERVE ONLY: the keep marker. `ORCA_PANE_KEEP=1` in a process's environment (set by the user
 * or a tool before it starts) marks its recorded entry `kept: marker`, and the existing kept walk covers its later
 * children. It is read ONCE, at close, for the recorded processes still present: a verdict is needed only then, and a
 * per-tick read of every new process cost about 3x the sampler's CPU under churn (measured, 20 panes). A process's
 * start environment does not change, and a child normally inherits the variable. Nothing here can signal (S1), and no environment text leaves
 * this module: a reader answers only true / false / null (not read) per pid.
 *
 * Linux reads /proc/<pid>/environ (NUL-separated, exact) and, when the entry's start ticks are known, checks
 * /proc/<pid>/stat still shows them (#67; unknown ticks = null, fail closed). macOS reads each pid THREE times, each `lstart=,command=` under LANG=C,
 * TZ=UTC: `ps -wwo` (the command line), `ps -wwE -o` (the command line, then the environment), `ps -wwo` again. Only
 * what follows the plain line is searched, so no ARGUMENT can match (Fable-3 S1). Every read's lstart must equal the
 * recorded start (#67 S1b: a reused pid is null) and the two plain reads must agree (#67 S1a: a command line that
 * changed across the -E read is null). No native code inside the terminal host (S3; this replaces the KERN_PROCARGS2
 * sysctl the design note first named). Never a pid LIST: macOS ps reads the whole process table for two or more -p
 * pids (0.8 s of CPU at ~1,900 processes, measured), but only the one process for a single pid (~0 s). At most
 * MAX_MARKER_READS_PER_CLOSE pids per close, and the WHOLE close within MARKER_CLOSE_BUDGET_MS, process-host's exit
 * grace included (#67 S2: each read's timeout is what is left of it, minus MARKER_EXIT_GRACE_MS). Both see the environment the process was started with, same uid only: another
 * uid's process (or a root one) reads as null.
 *
 * Remaining limit (macOS): ps joins the environment entries with spaces, so a WORD inside an environment VALUE (e.g.
 * FOO='x ORCA_PANE_KEEP=1') still reads as the marker. In observe that changes only a label.
 *
 * Secrets: no reader error carries ps output or a file's text (psEnvOutput names only the failure kind), and the
 * observer counts a failed read without logging its message.
 */
export const KEEP_MARKER = 'ORCA_PANE_KEEP=1'
export const MARKER_HELPER_TIMEOUT_MS = 2_000
/** Present processes read per close (three ps reads each on macOS); the rest stay null (not read). */
export const MAX_MARKER_READS_PER_CLOSE = 32
/** Total time one close may spend reading markers, every read included (#67); the pids left stay null (not read). */
export const MARKER_CLOSE_BUDGET_MS = 5_000
/**
 * process-host's exit grace (run-process.ts PROCESS_EXIT_GRACE_MS): a timed-out helper gets SIGTERM, and only after
 * this long SIGKILL and a forced settle. Reads stop early enough that this grace still ends inside the budget.
 */
export const MARKER_EXIT_GRACE_MS = 2_000

export type KeepMarkers = Map<number, boolean | null>

/** #67: what the reader checks a pid against: the entry's recorded start (lstart, UTC) and, on Linux, start ticks. */
export type MarkerTarget = { pid: number; startedAt: string; startTicks: string | null }

/**
 * At close: one read for the present entries; a marked one is kept: marker (children follow through the kept walk).
 * Returns false when the read failed (every marker stays null, "not read"); true otherwise, also with nothing to read.
 */
export async function applyKeepMarkers(
  entries: OwnedEntry[],
  read: ((targets: MarkerTarget[]) => Promise<KeepMarkers>) | null | undefined
): Promise<boolean> {
  if (!read || entries.length === 0) {
    return true
  }
  let markers: KeepMarkers
  try {
    markers = await read(
      entries.map(({ pid, startedAt, startTicks }) => ({ pid, startedAt, startTicks }))
    )
  } catch {
    return false
  }
  for (const entry of entries) {
    entry.marker = markers.get(entry.pid) ?? null
    if (entry.marker === true && entry.kept === null) {
      entry.kept = 'marker'
    }
  }
  return true
}

/** Linux: NUL-separated `KEY=value` entries; only the exact entry counts. */
export function markerInEnviron(environ: string): boolean {
  return environ.split('\0').includes(KEEP_MARKER)
}

// One ps line with lstart first (LANG=C, TZ=UTC: "Sat Nov 15 08:28:00 2026"; a one-digit day is space-padded).
const LSTART_LINE = /^\s*([A-Z][a-z]{2} [A-Z][a-z]{2} +\d{1,2} \d{2}:\d{2}:\d{2} \d{4}) (.*)$/s

function lstartLine(line: string): { startedAt: string; command: string } | null {
  const match = line.replace(/\n+$/, '').match(LSTART_LINE)
  return match ? { startedAt: match[1].replace(/ +/g, ' '), command: match[2] } : null
}

/**
 * macOS: three reads of one pid, each `lstart=,command=`: the plain line, the one with the environment (-E), and the
 * plain line again. The environment is what follows the plain command line in the -E read. null (not read) when any
 * read is empty (gone) or another process (#67 S1b: lstart differs from the recorded start), or when the command line
 * changed across the -E read (#67 S1a: the two plain reads differ, or the -E line does not start with it).
 */
export function markerInPsReads(
  target: MarkerTarget,
  before: string,
  withEnvironment: string,
  after: string
): boolean | null {
  const reads = [before, withEnvironment, after].map(lstartLine)
  const [plain, full, again] = reads
  const startedAt = target.startedAt.replace(/ +/g, ' ')
  if (
    !plain ||
    !full ||
    !again ||
    reads.some((read) => read?.startedAt !== startedAt) ||
    !plain.command.trim() ||
    plain.command !== again.command ||
    !full.command.startsWith(plain.command)
  ) {
    return null
  }
  return full.command.slice(plain.command.length).trim().split(/\s+/).includes(KEEP_MARKER)
}

/** The ps helper's outcome as text; exit 1 with nothing printed = every pid asked about is gone. */
export function psEnvOutput(result: {
  code: number | null
  stdout: string
  stderr?: string
  timedOut: boolean
  outputTruncated?: boolean
}): string {
  if (result.timedOut) {
    throw new Error('keep marker read failed: timeout')
  }
  if (result.outputTruncated) {
    throw new Error('keep marker read failed: truncated')
  }
  if (result.code !== 0 && result.code !== 1) {
    throw new Error('keep marker read failed: exit')
  }
  return result.stdout
}

async function runPsEnv(args: string[], timeoutMs: number): Promise<string> {
  const result = await runProcess({
    program: 'ps',
    args,
    env: { ...process.env, LANG: 'C', LC_ALL: 'C', TZ: 'UTC' },
    timeoutMs,
    maxOutputBytes: 8 * 1024 * 1024
  })
  return psEnvOutput(result)
}

/** A read that ran out of the close budget (its timeout was cut below MARKER_HELPER_TIMEOUT_MS). */
class BudgetSpent extends Error {}

/**
 * macOS: per pid, three single-pid reads (a pid LIST would make ps read the whole table), up to
 * MAX_MARKER_READS_PER_CLOSE pids. #67 S2: the WHOLE close is bounded by MARKER_CLOSE_BUDGET_MS, including
 * process-host's exit grace: each read gets min(MARKER_HELPER_TIMEOUT_MS, what is left minus MARKER_EXIT_GRACE_MS),
 * and a cut read that TIMES OUT ends the reading with the pids left null (what was read is kept). Any other failure,
 * or a timeout with the full time, throws (with no ps output in the error) and counts as a failed read.
 */
export async function readMacKeepMarkers(
  targets: readonly MarkerTarget[],
  run: (args: string[], timeoutMs: number) => Promise<string> = runPsEnv,
  now: () => number = Date.now
): Promise<KeepMarkers> {
  const result: KeepMarkers = new Map()
  // A read must END by the budget even when its ps ignores SIGTERM: its timeout plus the exit grace fits what is left.
  const deadline = now() + MARKER_CLOSE_BUDGET_MS - MARKER_EXIT_GRACE_MS
  const read = async (args: string[]): Promise<string> => {
    const timeoutMs = Math.min(MARKER_HELPER_TIMEOUT_MS, deadline - now())
    if (timeoutMs <= 0) {
      throw new BudgetSpent()
    }
    try {
      return await run(args, timeoutMs)
    } catch (error) {
      // Only a TIMEOUT of a cut read is the budget running out; any other failure is a failed read (counted).
      const cutTimeout = timeoutMs < MARKER_HELPER_TIMEOUT_MS && String(error).endsWith(': timeout')
      throw cutTimeout ? new BudgetSpent() : error
    }
  }
  let spent = false
  for (const [index, target] of targets.entries()) {
    if (spent || index >= MAX_MARKER_READS_PER_CLOSE) {
      result.set(target.pid, null)
      continue
    }
    const pid = String(target.pid)
    try {
      const before = await read(['-wwo', 'lstart=,command=', '-p', pid])
      const withEnvironment = await read(['-wwE', '-o', 'lstart=,command=', '-p', pid])
      const after = await read(['-wwo', 'lstart=,command=', '-p', pid])
      result.set(target.pid, markerInPsReads(target, before, withEnvironment, after))
    } catch (error) {
      if (!(error instanceof BudgetSpent)) {
        throw error
      }
      spent = true
      result.set(target.pid, null)
    }
  }
  return result
}

/**
 * Linux: /proc/<pid>/environ per pid; unreadable (gone, or another uid) is null. #67: /proc/<pid>/stat is read after
 * the environment and must still show the entry's recorded start ticks (a reused pid is null). An entry whose ticks
 * were never read is null too: no identity, no marker (fail closed).
 */
export async function readLinuxKeepMarkers(
  targets: readonly MarkerTarget[],
  read: (path: string) => Promise<string> = (path) => readFile(path, 'utf8')
): Promise<KeepMarkers> {
  const result: KeepMarkers = new Map()
  for (const [index, { pid, startTicks }] of targets.entries()) {
    if (index >= MAX_MARKER_READS_PER_CLOSE) {
      result.set(pid, null)
      continue
    }
    const environ = await read(`/proc/${pid}/environ`).catch(() => null)
    const same = startTicks !== null && (await readLinuxStartTicks(pid, read)) === startTicks
    result.set(pid, environ === null || !same ? null : markerInEnviron(environ))
  }
  return result
}
