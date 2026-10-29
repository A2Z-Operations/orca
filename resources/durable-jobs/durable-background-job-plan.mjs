import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'

export const JOB_ID = /^dj_[a-f0-9]{16}$/

export function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`
}

export function jobRoot(env = process.env, platform = process.platform) {
  if (typeof env.ORCA_DURABLE_JOB_ROOT === 'string' && env.ORCA_DURABLE_JOB_ROOT.length > 0) {
    return env.ORCA_DURABLE_JOB_ROOT
  }
  if (platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'orca', 'durable-jobs')
  }
  return join(homedir(), '.orca', 'durable-jobs')
}

export function assertJobId(id) {
  if (typeof id !== 'string' || !JOB_ID.test(id)) {
    throw new Error('Invalid durable job id')
  }
  return id
}

export function newJobId() {
  return `dj_${randomBytes(8).toString('hex')}`
}

/** Signals the waiter forwards. SIGHUP and SIGKILL stay unforwarded so a Claude restart leaves the job. */
export const WAITER_FORWARDED_SIGNALS = ['SIGTERM', 'SIGINT']

export function planBackgroundBashRewrite({
  toolName,
  toolInput,
  runnerPath,
  nodePath,
  sessionId,
  cwd,
  platform = process.platform,
  env = process.env,
  id = newJobId(),
  now = new Date().toISOString()
}) {
  // Monitor is a live stdout subscription (command XOR ws, backgrounding never). Detaching it
  // would fake events and ignore the tool's own timeout. Only background Bash is durable.
  if (env.ORCA_DURABLE_JOBS === '0' || toolName !== 'Bash') {
    return null
  }
  if (!toolInput || typeof toolInput !== 'object' || Array.isArray(toolInput)) {
    return null
  }
  if (toolInput.run_in_background !== true) {
    return null
  }
  if (typeof toolInput.command !== 'string' || toolInput.command.trim() === '') {
    return null
  }
  if (
    toolInput.command.includes('durable-background-job.mjs') ||
    toolInput.command.includes('orca-durable-job')
  ) {
    return null
  }
  if (typeof runnerPath !== 'string' || typeof nodePath !== 'string') {
    return null
  }
  assertJobId(id)
  const root = jobRoot(env, platform)
  const logPath = join(root, id, 'output.log')
  const description = typeof toolInput.description === 'string' ? toolInput.description : ''
  const request = {
    id,
    command: toolInput.command,
    description,
    createdAt: now,
    ...(typeof sessionId === 'string' && sessionId ? { sessionId } : {}),
    ...(typeof cwd === 'string' && isAbsolute(cwd) ? { cwd } : {})
  }
  const command = `orca-durable-job run --id ${id}`
  return {
    request,
    response: {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        permissionDecisionReason: 'Orca rewrote this background command to the durable waiter.',
        additionalContext: `Orca detached this background command as job ${id}. It keeps running if Claude restarts. Log: ${logPath}. Read it with orca-durable-job logs --id ${id}. Stop it with orca-durable-job stop --id ${id}.`,
        updatedInput: { ...toolInput, command, run_in_background: true }
      }
    }
  }
}

export function isWslGuest(env = process.env, platform = process.platform) {
  return (
    platform === 'linux' &&
    (typeof env.WSL_DISTRO_NAME === 'string' || typeof env.WSL_INTEROP === 'string')
  )
}

export function findSetsid(exists = existsSync) {
  for (const candidate of ['/usr/bin/setsid', '/bin/setsid']) {
    if (exists(candidate)) {
      return candidate
    }
  }
  return undefined
}

function psQuote(value) {
  return `'${String(value).replaceAll("'", "''")}'`
}

function bashDetachScript({ cwd, commandPath, exitPath, logPath, redirect }) {
  const command = redirect
    ? `bash ${shellQuote(commandPath)} >> ${shellQuote(logPath)} 2>&1`
    : `bash ${shellQuote(commandPath)}`
  return [
    'set +e',
    `cd ${shellQuote(cwd)} || exit 97`,
    command,
    '__orca_code=$?',
    `printf '%s\\n' "$__orca_code" > ${shellQuote(exitPath)}`,
    'exit "$__orca_code"'
  ].join('\n')
}

/** Hidden powershell -File launcher. The user command stays in command.sh, never on this command line. */
export function powershellLaunchBody(runnerPath, exitPath) {
  return [
    "$ErrorActionPreference = 'Continue'",
    '$bash = (Get-Command -Name bash -ErrorAction SilentlyContinue).Source',
    `if (-not $bash) { Set-Content -LiteralPath ${psQuote(exitPath)} -Value '127' -NoNewline; exit 127 }`,
    `& $bash ${psQuote(runnerPath)}`,
    'if ($null -eq $LASTEXITCODE) { exit 1 }',
    'exit $LASTEXITCODE',
    ''
  ].join('\n')
}

export function detachLaunchPlan({
  platform,
  guest = false,
  setsidPath,
  cwd,
  commandPath,
  exitPath,
  logPath,
  runnerPath,
  launchPath
}) {
  if (platform === 'win32') {
    return {
      kind: 'powershell',
      command: 'powershell.exe',
      args: ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-File', launchPath],
      detached: true,
      windowsHide: true,
      runnerBody: bashDetachScript({ cwd, commandPath, exitPath, logPath, redirect: true }),
      launchBody: powershellLaunchBody(runnerPath, exitPath)
    }
  }
  const script = bashDetachScript({ cwd, commandPath, exitPath, logPath, redirect: false })
  // setsid(1) without --fork keeps bash's pid. Node detached would setsid() again and EPERM.
  if (guest && setsidPath) {
    return {
      kind: 'setsid',
      command: setsidPath,
      args: ['bash', '-c', script],
      detached: false,
      windowsHide: false
    }
  }
  return {
    kind: 'bash',
    command: '/bin/bash',
    args: ['-c', script],
    detached: true,
    windowsHide: false
  }
}

export function jobStopPlan(pid, platform = process.platform) {
  if (typeof pid !== 'number' || pid <= 1) {
    return null
  }
  if (platform === 'win32') {
    // No negative process groups. /T /F is the tree kill; /T without /F is only WM_CLOSE.
    return {
      kind: 'taskkill',
      command: 'taskkill.exe',
      args: ['/PID', String(pid), '/T', '/F']
    }
  }
  return { kind: 'group', signal: 'SIGTERM', pid }
}

function processGroupId(pid) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
    const end = stat.lastIndexOf(')')
    if (end === -1) {
      return undefined
    }
    const pgrp = Number(stat.slice(end + 2).split(' ')[2])
    return Number.isInteger(pgrp) ? pgrp : undefined
  } catch {
    return undefined
  }
}

export function waitUntilSessionLeader(pid) {
  const deadline = Date.now() + 1000
  const nap = new Int32Array(new SharedArrayBuffer(4))
  while (Date.now() < deadline) {
    if (processGroupId(pid) === pid) {
      return
    }
    Atomics.wait(nap, 0, 0, 10)
  }
}
