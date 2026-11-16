import { runProcess } from '@orca/process-host'
import { readFile } from 'node:fs/promises'
import type { OwnedEntry } from './pane-ownership-sets'

/**
 * #44 stage 3 piece (b), OBSERVE ONLY: the keep marker. `ORCA_PANE_KEEP=1` in a process's environment (set by the user
 * or a tool before it starts) marks its recorded entry `kept: marker`, and the existing kept walk covers its later
 * children. It is read ONCE, at close, for the recorded processes still present: a verdict is needed only then, and a
 * per-tick read of every new process cost about 3x the sampler's CPU under churn (measured, 20 panes). A process's
 * start environment does not change, and a child normally inherits the variable. Nothing here can signal (S1), and no environment text leaves
 * this module: a reader answers only true / false / null (not read) per pid.
 *
 * Linux reads /proc/<pid>/environ (NUL-separated, exact). macOS reads each pid TWICE: `ps -wwo command= -p <pid>`
 * (the command line) and `ps -wwE -o command= -p <pid>` (the command line, then the environment). Only what follows
 * the plain line is searched, so no ARGUMENT can match (Fable-3 S1); a command line that changed between the two reads
 * is null. No native code inside the terminal host (S3; this replaces the KERN_PROCARGS2 sysctl the design note first
 * named). Never a pid LIST: macOS ps reads the whole process table for two or more -p pids (0.8 s of CPU at ~1,900
 * processes, measured), but only the one process for a single pid (~0 s). At most MAX_MARKER_READS_PER_CLOSE pids
 * and MARKER_CLOSE_BUDGET_MS in total per close. Both see the environment the process was started with, same uid
 * only: another uid's process (or a root one) reads as null.
 *
 * Remaining limit (macOS): ps joins the environment entries with spaces, so a WORD inside an environment VALUE (e.g.
 * FOO='x ORCA_PANE_KEEP=1') still reads as the marker. In observe that changes only a label.
 *
 * Secrets: no reader error carries ps output or a file's text (psEnvOutput names only the failure kind), and the
 * observer counts a failed read without logging its message.
 */
export const KEEP_MARKER = 'ORCA_PANE_KEEP=1'
export const MARKER_HELPER_TIMEOUT_MS = 2_000
/** Present processes read per close (two ps reads each on macOS); the rest stay null (not read). */
export const MAX_MARKER_READS_PER_CLOSE = 32
/** Total time one close may spend reading markers; the pids left stay null (not read). */
export const MARKER_CLOSE_BUDGET_MS = 5_000

export type KeepMarkers = Map<number, boolean | null>

/**
 * At close: one read for the present entries; a marked one is kept: marker (children follow through the kept walk).
 * Returns false when the read failed (every marker stays null, "not read"); true otherwise, also with nothing to read.
 */
export async function applyKeepMarkers(
  entries: OwnedEntry[],
  read: ((pids: number[]) => Promise<KeepMarkers>) | null | undefined
): Promise<boolean> {
  if (!read || entries.length === 0) {
    return true
  }
  let markers: KeepMarkers
  try {
    markers = await read(entries.map((entry) => entry.pid))
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

/**
 * macOS: the environment part of `ps -wwE -o command=` is what follows the plain `ps -wwo command=` line. null when
 * either answer is empty (the process is gone) or the -E line does not start with the plain one (it changed).
 */
export function markerInPsLines(commandLine: string, withEnvironment: string): boolean | null {
  const plain = commandLine.replace(/\n+$/, '')
  const full = withEnvironment.replace(/\n+$/, '')
  if (!plain.trim() || !full.trim() || !full.startsWith(plain)) {
    return null
  }
  return full.slice(plain.length).trim().split(/\s+/).includes(KEEP_MARKER)
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

async function runPsEnv(args: string[]): Promise<string> {
  const result = await runProcess({
    program: 'ps',
    args,
    timeoutMs: MARKER_HELPER_TIMEOUT_MS,
    maxOutputBytes: 8 * 1024 * 1024
  })
  return psEnvOutput(result)
}

/**
 * macOS: per pid, the plain command line then the one with the environment (a pid LIST would make ps read the whole
 * table), up to MAX_MARKER_READS_PER_CLOSE pids and MARKER_CLOSE_BUDGET_MS in total; a gone pid, or one beyond either
 * bound, is null. A failed helper throws (with no ps output in the error).
 */
export async function readMacKeepMarkers(
  pids: readonly number[],
  run: (args: string[]) => Promise<string> = runPsEnv,
  now: () => number = Date.now
): Promise<KeepMarkers> {
  const result: KeepMarkers = new Map()
  const startedAt = now()
  for (const [index, pid] of pids.entries()) {
    if (index >= MAX_MARKER_READS_PER_CLOSE || now() - startedAt >= MARKER_CLOSE_BUDGET_MS) {
      result.set(pid, null)
      continue
    }
    const commandLine = await run(['-wwo', 'command=', '-p', String(pid)])
    const withEnvironment = await run(['-wwE', '-o', 'command=', '-p', String(pid)])
    result.set(pid, markerInPsLines(commandLine, withEnvironment))
  }
  return result
}

/** Linux: /proc/<pid>/environ per pid; unreadable (gone, or another uid) is null. */
export async function readLinuxKeepMarkers(
  pids: readonly number[],
  read: (path: string) => Promise<string> = (path) => readFile(path, 'utf8')
): Promise<KeepMarkers> {
  const result: KeepMarkers = new Map()
  for (const [index, pid] of pids.entries()) {
    if (index >= MAX_MARKER_READS_PER_CLOSE) {
      result.set(pid, null)
      continue
    }
    const environ = await read(`/proc/${pid}/environ`).catch(() => null)
    result.set(pid, environ === null ? null : markerInEnviron(environ))
  }
  return result
}
