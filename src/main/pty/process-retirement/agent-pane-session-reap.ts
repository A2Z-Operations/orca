import { readdirSync, readFileSync } from 'node:fs'
import { hasControllingTty } from '../../../shared/posix-controlling-terminal'
import { recordSelfInitiatedTreeKill } from '../../crash-reporting/self-initiated-tree-kill-log'
import { runProcess } from '@orca/process-host'
import { readDarwinSessionIds } from './darwin-getsid'
import {
  parseLinuxProcStatProcessGroup,
  parseLinuxProcStatSessionId,
  parseLinuxProcStatTtyNumber
} from './posix-pty-process-table'

// Agent-pane close kills every process group still in that pane's session, including a
// nohup/`&` loop that dropped its tty and was reparented to launchd. macOS `ps -o sess`
// prints 0, so the session id is getsid(2). A child that already called setsid is a new
// session: macOS has no cgroup that names it, and this reap does not scan ORCA_AGENT_PANE
// (that would kill a job the user detached on purpose). Windows reparents into the PTY
// job, so the reap returns immediately there. A truncated process table skips the reap;
// the tty-group kill still runs.

// A busy Mac's `ps -ax` can exceed the 1s tty-table budget. Timing out skips this reap,
// and the tty sweep cannot see the orphan this reap exists to kill.
const PROCESS_TABLE_TIMEOUT_MS = 5_000
const PROCESS_TABLE_MAX_BYTES = 1024 * 1024

export type AgentPaneSessionMember = {
  pid: number
  pgid: number
  sid: number | null
  tty: string
}

export type AgentPaneSessionSnapshot = {
  sid: number
  rootPgid: number
  groups: number[]
}

export type AgentPaneSessionReapDeps = {
  platform?: NodeJS.Platform
  currentPid?: number
  readMembers?: (rootPid: number) => AgentPaneSessionMember[] | null
  signalProcessGroup?: (pgid: number) => void
  pidExists?: (pid: number) => boolean
}

type ProcessTableRow = {
  pid: number
  pgid: number
  tty: string
}

export function selectAgentPaneSessionGroups(
  members: AgentPaneSessionMember[],
  rootPid: number,
  currentPid: number
): AgentPaneSessionSnapshot | null {
  const root = members.find((row) => row.pid === rootPid)
  const self = members.find((row) => row.pid === currentPid)
  // The tracked pid is often a child of the session leader (forkpty/login). Any sid > 1 is enough.
  if (!root || root.sid === null || root.sid <= 1) {
    return null
  }
  // Missing self, or a shell that never left the daemon's session: do not signal.
  if (!self || self.sid === null || self.sid <= 1 || self.sid === root.sid) {
    return null
  }
  const groups = new Set<number>()
  for (const row of members) {
    if (row.sid !== root.sid || row.pgid <= 1 || row.pgid === self.pgid) {
      continue
    }
    groups.add(row.pgid)
  }
  if (groups.size === 0) {
    return null
  }
  return {
    sid: root.sid,
    rootPgid: root.pgid,
    groups: [...groups].sort((left, right) => {
      if (left === root.pgid) {
        return 1
      }
      if (right === root.pgid) {
        return -1
      }
      return left - right
    })
  }
}

function processIsGone(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ESRCH'
}

function pidIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return !processIsGone(error)
  }
}

function parsePidPgidTty(output: string): ProcessTableRow[] {
  const rows: ProcessTableRow[] = []
  for (const line of output.split(/\r?\n/)) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\S+)/.exec(line)
    if (!match) {
      continue
    }
    const pid = Number(match[1])
    const pgid = Number(match[2])
    if (pid > 0 && pgid >= 0) {
      rows.push({ pid, pgid, tty: match[3] })
    }
  }
  return rows
}

async function readDarwinSessionMembers(
  rootPid: number,
  currentPid: number
): Promise<AgentPaneSessionMember[] | null> {
  let output: string
  try {
    const result = await runProcess({
      program: 'ps',
      args: ['-axo', 'pid=,pgid=,tty='],
      env: { ...process.env, LC_ALL: 'C' },
      timeoutMs: PROCESS_TABLE_TIMEOUT_MS,
      maxOutputBytes: PROCESS_TABLE_MAX_BYTES
    })
    if (result.code !== 0 || result.timedOut) {
      return null
    }
    output = result.stdout
  } catch {
    // A truncated listing is not proof of who shares the session.
    return null
  }
  const rows = parsePidPgidTty(output)
  const root = rows.find((row) => row.pid === rootPid)
  if (!root) {
    return null
  }
  // Same tty is not the same session (devpts numbers are reused). getsid decides.
  const candidates = rows.filter(
    (row) =>
      row.pid === rootPid ||
      row.pid === currentPid ||
      row.tty === root.tty ||
      !hasControllingTty(row.tty)
  )
  const sessions = await readDarwinSessionIds([...new Set(candidates.map((row) => row.pid))])
  if (!sessions) {
    return null
  }
  return candidates.map((row) => ({ ...row, sid: sessions.get(row.pid) ?? null }))
}

function readLinuxSessionMembers(
  rootPid: number,
  currentPid: number
): AgentPaneSessionMember[] | null {
  let names: string[]
  try {
    names = readdirSync('/proc')
  } catch {
    return null
  }
  const members: AgentPaneSessionMember[] = []
  let sawRoot = false
  let sawSelf = false
  for (const name of names) {
    if (!/^\d+$/.test(name)) {
      continue
    }
    const pid = Number(name)
    let stat: string
    try {
      stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
    } catch {
      continue
    }
    const pgid = parseLinuxProcStatProcessGroup(stat)
    const sid = parseLinuxProcStatSessionId(stat)
    if (pgid === null || sid === null) {
      continue
    }
    if (pid === rootPid) {
      sawRoot = true
    }
    if (pid === currentPid) {
      sawSelf = true
    }
    const ttyNr = parseLinuxProcStatTtyNumber(stat)
    members.push({ pid, pgid, sid, tty: ttyNr !== null && ttyNr > 0 ? String(ttyNr) : '??' })
  }
  // The leader's pid can be reused once it is gone; do not reap from a table that lost it.
  return sawRoot && sawSelf ? members : null
}

async function readSessionMembers(
  rootPid: number,
  currentPid: number,
  platform: NodeJS.Platform
): Promise<AgentPaneSessionMember[] | null> {
  if (platform === 'linux') {
    return readLinuxSessionMembers(rootPid, currentPid)
  }
  if (platform === 'darwin') {
    return readDarwinSessionMembers(rootPid, currentPid)
  }
  return null
}

/** Groups in the root's session, snapshotted while that pid still exists. */
export async function captureAgentPaneSessionGroups(
  rootPid: number,
  deps: AgentPaneSessionReapDeps = {}
): Promise<AgentPaneSessionSnapshot | null> {
  const platform = deps.platform ?? process.platform
  if (platform === 'win32' || rootPid <= 1) {
    return null
  }
  if (!(deps.pidExists ?? pidIsAlive)(rootPid)) {
    return null
  }
  const currentPid = deps.currentPid ?? process.pid
  const members = deps.readMembers
    ? deps.readMembers(rootPid)
    : await readSessionMembers(rootPid, currentPid, platform)
  if (!members) {
    return null
  }
  return selectAgentPaneSessionGroups(members, rootPid, currentPid)
}

/** SIGKILL the snapshotted groups. Non-root groups first, then the root's group. */
export function signalAgentPaneSessionGroups(
  snapshot: AgentPaneSessionSnapshot,
  signalProcessGroup: (pgid: number) => void = (pgid) => {
    process.kill(-pgid, 'SIGKILL')
  }
): void {
  for (const pgid of snapshot.groups) {
    try {
      signalProcessGroup(pgid)
    } catch {
      // ESRCH means the group is already gone. Any other error still must not skip the rest.
      continue
    }
    recordSelfInitiatedTreeKill({
      pid: pgid,
      site: 'agent-pane-session-reap',
      scope: 'posix-process-group'
    })
  }
}

/** Best-effort. A failure here must not skip the descendant sweep. */
export async function reapAgentPaneSession(
  rootPid: number,
  deps: AgentPaneSessionReapDeps = {}
): Promise<void> {
  try {
    const snapshot = await captureAgentPaneSessionGroups(rootPid, deps)
    if (!snapshot) {
      return
    }
    signalAgentPaneSessionGroups(snapshot, deps.signalProcessGroup)
  } catch {
    // Session discovery is optional next to the existing tty and descendant kills.
  }
}
