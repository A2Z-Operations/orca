import { runProcess } from '@orca/process-host'
import { readdir, readlink } from 'node:fs/promises'

/**
 * What a process's standard fds are (#44, S4): the KIND matters, because the stage 3 rule rests on "still wired to the
 * pane", and a Claude Code tool shell writes to a regular file while Node children may get unix socket pairs, whose two
 * ends do not share one identity. Read through a helper process (lsof) on macOS and plain /proc reads on Linux: no new
 * native code runs inside the terminal host (S3).
 */
export type FdKind = 'pipe' | 'socket' | 'pty' | 'null' | 'file' | 'other' | 'closed'

export type FdInfo = {
  fd: number
  kind: FdKind
  /** Pipe/socket identity (Linux inode, macOS kernel address), the device path for a pty, the path for a file. */
  id: string | null
  /** The other end, where the OS names it (macOS lsof "->0x…"); null otherwise. */
  peer: string | null
}

export const STANDARD_FDS = [0, 1, 2] as const
export const FD_HELPER_TIMEOUT_MS = 2_000

export function classifyLinuxFdTarget(fd: number, target: string | null): FdInfo {
  if (target === null) {
    return { fd, kind: 'closed', id: null, peer: null }
  }
  const pipe = target.match(/^pipe:\[(\d+)\]$/)
  if (pipe) {
    return { fd, kind: 'pipe', id: pipe[1], peer: null }
  }
  const socket = target.match(/^socket:\[(\d+)\]$/)
  if (socket) {
    return { fd, kind: 'socket', id: socket[1], peer: null }
  }
  if (target === '/dev/null') {
    return { fd, kind: 'null', id: target, peer: null }
  }
  if (/^\/dev\/(pts\/\d+|tty\w*)$/.test(target)) {
    return { fd, kind: 'pty', id: target, peer: null }
  }
  if (target.startsWith('/')) {
    return { fd, kind: 'file', id: target, peer: null }
  }
  return { fd, kind: 'other', id: target, peer: null }
}

/** Parses `lsof -F ftdn` output (one field per line) into each pid's fds. */
export function parseLsofFds(output: string): Map<number, FdInfo[]> {
  const result = new Map<number, FdInfo[]>()
  let pid: number | null = null
  let current: { fd: number; type: string; device: string; name: string } | null = null
  const flush = (): void => {
    if (pid !== null && current) {
      const list = result.get(pid) ?? []
      list.push(classifyLsofFd(current))
      result.set(pid, list)
    }
    current = null
  }
  for (const line of output.split('\n')) {
    const field = line[0]
    const value = line.slice(1)
    if (field === 'p') {
      flush()
      pid = Number(value)
    } else if (field === 'f') {
      flush()
      current = /^\d+$/.test(value) ? { fd: Number(value), type: '', device: '', name: '' } : null
    } else if (current && field === 't') {
      current.type = value
    } else if (current && field === 'd') {
      current.device = value
    } else if (current && field === 'n') {
      current.name = value
    }
  }
  flush()
  return result
}

function classifyLsofFd(fd: { fd: number; type: string; device: string; name: string }): FdInfo {
  const peer = fd.name.match(/->(0x[0-9a-f]+)/i)?.[1] ?? null
  switch (fd.type) {
    case 'PIPE':
      return { fd: fd.fd, kind: 'pipe', id: fd.device || null, peer }
    case 'unix':
      return { fd: fd.fd, kind: 'socket', id: fd.device || null, peer }
    case 'CHR':
      if (fd.name === '/dev/null') {
        return { fd: fd.fd, kind: 'null', id: fd.name, peer: null }
      }
      return /^\/dev\/(ttys\d+|pts\/\d+|tty\w*)$/.test(fd.name)
        ? { fd: fd.fd, kind: 'pty', id: fd.name, peer: null }
        : { fd: fd.fd, kind: 'other', id: fd.name || null, peer: null }
    case 'REG':
      return { fd: fd.fd, kind: 'file', id: fd.name || null, peer: null }
    default:
      return { fd: fd.fd, kind: 'other', id: fd.type || null, peer }
  }
}

/**
 * A helper read that did not answer (O2): timed out, could not start, was cut short, exited with an error, or exited 0
 * with nothing printed. The caller counts and logs it and backs the fd reads off; it is never read as "no fds".
 */
export class FdReadFailed extends Error {
  constructor(readonly why: 'timeout' | 'spawn' | 'truncated' | 'exit' | 'empty') {
    super(`fd read failed: ${why}`)
    this.name = 'FdReadFailed'
  }
}

/** -n -P: no host or port name lookups; -l: no user name lookups; -b: never block on a file system that does not answer. */
export const LSOF_BASE_ARGS = ['-n', '-P', '-l', '-b', '-a', '-w'] as const

/**
 * macOS: ONE lsof for every pid asked about, at most once per tick; timed out and SIGKILLed after 2 s. A pid missing
 * from a good answer is "missing" for that pid (it exited; exit 1 with nothing printed = all of them exited); a failed
 * answer throws FdReadFailed.
 */
export async function readMacFds(
  pids: readonly number[],
  fds: readonly number[] | 'all',
  run: (args: string[]) => Promise<string> = runLsof
): Promise<Map<number, FdInfo[]>> {
  if (pids.length === 0) {
    return new Map()
  }
  const args = [
    ...LSOF_BASE_ARGS,
    '-p',
    pids.join(','),
    ...(fds === 'all' ? [] : ['-d', fds.join(',')]),
    '-F',
    'ftdn'
  ]
  return parseLsofFds(await run(args))
}

/** The lsof helper's outcome as text, or FdReadFailed; exit 1 (some or all pids gone) answers for the others. */
export function lsofOutput(result: {
  code: number | null
  stdout: string
  timedOut: boolean
  outputTruncated?: boolean
}): string {
  if (result.timedOut) {
    throw new FdReadFailed('timeout')
  }
  if (result.outputTruncated) {
    throw new FdReadFailed('truncated')
  }
  if (result.code !== 0 && result.code !== 1) {
    throw new FdReadFailed('exit')
  }
  if (result.code === 0 && result.stdout.trim() === '') {
    throw new FdReadFailed('empty')
  }
  return result.stdout
}

async function runLsof(args: string[]): Promise<string> {
  const result = await runProcess({
    program: 'lsof',
    args,
    timeoutMs: FD_HELPER_TIMEOUT_MS,
    maxOutputBytes: 8 * 1024 * 1024
  }).catch(() => {
    throw new FdReadFailed('spawn')
  })
  return lsofOutput(result)
}

/** Linux: readlink of /proc/<pid>/fd/N; a process that is gone reads as closed. */
export async function readLinuxFds(
  pids: readonly number[],
  fds: readonly number[] | 'all',
  deps: {
    readlink?: (path: string) => Promise<string>
    readdir?: (path: string) => Promise<string[]>
  } = {}
): Promise<Map<number, FdInfo[]>> {
  const link = deps.readlink ?? ((path: string) => readlink(path))
  const list = deps.readdir ?? ((path: string) => readdir(path))
  const result = new Map<number, FdInfo[]>()
  for (const pid of pids) {
    const numbers: number[] =
      fds === 'all'
        ? (await list(`/proc/${pid}/fd`).catch((): string[] => []))
            .map(Number)
            .filter(Number.isInteger)
        : [...fds]
    const infos: FdInfo[] = []
    for (const fd of numbers) {
      const target = await link(`/proc/${pid}/fd/${fd}`).catch(() => null)
      infos.push(classifyLinuxFdTarget(fd, target))
    }
    result.set(pid, infos)
  }
  return result
}

/** The identities an agent root holds (its pipes, sockets and ptys), to tell which child fds were the agent's. */
export function wiringIds(fds: readonly FdInfo[]): Set<string> {
  const ids = new Set<string>()
  for (const fd of fds) {
    if ((fd.kind === 'pipe' || fd.kind === 'socket' || fd.kind === 'pty') && fd.id) {
      ids.add(fd.id)
    }
  }
  return ids
}

/** True when a child fd is one end of something the agent root held: same pipe/pty id, or a socket/pipe whose peer it held. */
export function sharesWithAgent(fd: FdInfo, agentIds: ReadonlySet<string>): boolean {
  return (
    (fd.id !== null && agentIds.has(fd.id) && fd.kind !== 'file' && fd.kind !== 'null') ||
    (fd.peer !== null && agentIds.has(fd.peer))
  )
}
