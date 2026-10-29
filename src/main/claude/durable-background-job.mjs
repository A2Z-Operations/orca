#!/usr/bin/env node
import { spawn } from 'node:child_process'
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  rmSync,
  statSync,
  realpathSync,
  writeFileSync
} from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  JOB_ID,
  assertJobId,
  detachLaunchPlan,
  findSetsid,
  isWslGuest,
  jobRoot,
  jobStopPlan,
  newJobId,
  waitUntilSessionLeader
} from './durable-background-job-plan.mjs'

export {
  assertJobId,
  detachLaunchPlan,
  isWslGuest,
  jobRoot,
  jobStopPlan,
  newJobId,
  planBackgroundBashRewrite,
  powershellLaunchBody,
  shellQuote,
  WAITER_FORWARDED_SIGNALS
} from './durable-background-job-plan.mjs'

// oxlint-disable-next-line unicorn/prefer-import-meta-properties -- orcad's CJS bundle rewrites import.meta.url only, not import.meta.filename
const RUNNER_PATH = fileURLToPath(import.meta.url)
const PENDING_MAX_AGE_MS = 60 * 60 * 1000
const EXITED_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

/** One settings.json allow entry. The waiter is always `orca-durable-job run --id dj_…`. */
export const DURABLE_JOB_ALLOW_RULE = 'Bash(orca-durable-job run --id:*)'

function jobDir(id, root = jobRoot()) {
  assertJobId(id)
  return join(root, id)
}

function readJson(path) {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'))
    return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined
  } catch {
    return undefined
  }
}

export function pidAlive(pid) {
  if (typeof pid !== 'number' || pid <= 0) {
    return false
  }
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function readExitCode(path) {
  try {
    const code = Number(readFileSync(path, 'utf8').trim())
    return Number.isInteger(code) ? code : undefined
  } catch {
    return undefined
  }
}

export function readJob(id, root = jobRoot()) {
  const dir = jobDir(id, root)
  const request = readJson(join(dir, 'request.json'))
  if (!request || typeof request.command !== 'string') {
    return undefined
  }
  const meta = readJson(join(dir, 'meta.json'))
  const exitPath = join(dir, 'exit')
  const exitCode = readExitCode(exitPath)
  const pid = typeof meta?.pid === 'number' ? meta.pid : undefined
  let state = 'pending'
  if (exitCode !== undefined) {
    state = 'exited'
  } else if (pid !== undefined && pidAlive(pid)) {
    state = 'running'
  } else if (pid !== undefined) {
    state = 'lost'
  }
  return {
    id,
    state,
    command: request.command,
    description: typeof request.description === 'string' ? request.description : '',
    createdAt: typeof request.createdAt === 'string' ? request.createdAt : undefined,
    sessionId: typeof request.sessionId === 'string' ? request.sessionId : undefined,
    cwd: typeof meta?.cwd === 'string' ? meta.cwd : request.cwd,
    pid,
    exitCode,
    logPath: join(dir, 'output.log'),
    dir
  }
}

export function listJobs(root = jobRoot()) {
  if (!existsSync(root)) {
    return []
  }
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && JOB_ID.test(entry.name))
    .map((entry) => readJob(entry.name, root))
    .filter((job) => job !== undefined)
    .sort((left, right) => left.id.localeCompare(right.id))
}

export function formatSurvivingJobNote(jobs) {
  const running = jobs.filter((job) => job.state === 'running')
  if (running.length === 0) {
    return 'No detached Orca jobs were still running.'
  }
  const details = running.map((job) => `${job.id} log=${job.logPath}`).join('; ')
  return `Detached Orca jobs still running after this restart: ${details}.`
}

function ageMs(iso, path, now) {
  const parsed = Date.parse(iso ?? '')
  if (Number.isFinite(parsed)) {
    return now - parsed
  }
  try {
    return now - statSync(path).mtimeMs
  } catch {
    return 0
  }
}

function fileAgeMs(path, now) {
  try {
    return now - statSync(path).mtimeMs
  } catch {
    return 0
  }
}

/** Drop denied requests and finished jobs. Running and lost jobs stay. */
export function sweepDurableJobs(options = {}) {
  const root = options.root ?? jobRoot(options.env)
  const now = options.now ?? Date.now()
  const pendingMaxAgeMs = options.pendingMaxAgeMs ?? PENDING_MAX_AGE_MS
  const exitedMaxAgeMs = options.exitedMaxAgeMs ?? EXITED_MAX_AGE_MS
  const removed = { pending: [], exited: [] }
  for (const job of listJobs(root)) {
    if (
      job.state === 'pending' &&
      ageMs(job.createdAt, join(job.dir, 'request.json'), now) > pendingMaxAgeMs
    ) {
      rmSync(job.dir, { recursive: true, force: true })
      removed.pending.push(job.id)
    } else if (job.state === 'exited' && fileAgeMs(join(job.dir, 'exit'), now) > exitedMaxAgeMs) {
      rmSync(job.dir, { recursive: true, force: true })
      removed.exited.push(job.id)
    }
  }
  return removed
}

export function createJobRequest(request, env = process.env) {
  assertJobId(request.id)
  if (typeof request.command !== 'string' || request.command.length === 0) {
    throw new Error('Durable job is missing a command')
  }
  const dir = jobDir(request.id, jobRoot(env))
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'request.json'), `${JSON.stringify(request)}\n`, { flag: 'wx' })
  return dir
}

function claimStart(dir) {
  try {
    mkdirSync(join(dir, 'started'))
    return true
  } catch (error) {
    if (error && error.code === 'EEXIST') {
      return false
    }
    throw error
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitFor(read, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = read()
    if (value) {
      return value
    }
    await sleep(50)
  }
  return read()
}

function signalJob(pid, signal, platform = process.platform) {
  const plan = jobStopPlan(pid, platform)
  if (!plan) {
    return false
  }
  if (plan.kind === 'taskkill') {
    const killer = spawn(plan.command, plan.args, {
      detached: true,
      windowsHide: true,
      stdio: 'ignore'
    })
    killer.unref()
    return true
  }
  const mapped = signal === 'SIGINT' ? 'SIGINT' : 'SIGTERM'
  try {
    process.kill(-pid, mapped)
    return true
  } catch {
    try {
      process.kill(pid, mapped)
      return true
    } catch {
      return false
    }
  }
}

function armWaiterStop(dir) {
  let stopping = false
  const onStop = (signal) => {
    if (stopping) {
      return
    }
    stopping = true
    try {
      writeFileSync(join(dir, 'cancel'), signal)
    } catch {
      // The detach helper also checks this file; a failed write still signals a known pid.
    }
    const pid = readJson(join(dir, 'meta.json'))?.pid
    if (typeof pid === 'number') {
      signalJob(pid, signal)
    }
    process.exit(signal === 'SIGINT' ? 130 : 143)
  }
  process.once('SIGTERM', () => onStop('SIGTERM'))
  process.once('SIGINT', () => onStop('SIGINT'))
}

export function detachJob(id, env = process.env, platform = process.platform) {
  const dir = jobDir(id, jobRoot(env, platform))
  const request = readJson(join(dir, 'request.json'))
  if (!request || typeof request.command !== 'string') {
    throw new Error(`Durable job ${id} has no request`)
  }
  const metaPath = join(dir, 'meta.json')
  if (existsSync(metaPath)) {
    return
  }
  const cancelFile = join(dir, 'cancel')
  if (existsSync(cancelFile)) {
    return
  }
  const cwd =
    typeof env.ORCA_DURABLE_JOB_CWD === 'string' && env.ORCA_DURABLE_JOB_CWD.length > 0
      ? env.ORCA_DURABLE_JOB_CWD
      : typeof request.cwd === 'string'
        ? request.cwd
        : process.cwd()
  const commandPath = join(dir, 'command.sh')
  const logPath = join(dir, 'output.log')
  const exitPath = join(dir, 'exit')
  const runnerPath = join(dir, 'runner.sh')
  const launchPath = join(dir, 'launch.ps1')
  writeFileSync(
    commandPath,
    request.command.endsWith('\n') ? request.command : `${request.command}\n`
  )
  const guest = isWslGuest(env, platform)
  const plan = detachLaunchPlan({
    platform,
    guest,
    setsidPath: guest ? findSetsid() : undefined,
    cwd,
    commandPath,
    exitPath,
    logPath,
    runnerPath,
    launchPath
  })
  if (plan.runnerBody) {
    writeFileSync(runnerPath, plan.runnerBody)
  }
  if (plan.launchBody) {
    writeFileSync(launchPath, plan.launchBody)
  }
  const logFd = plan.kind === 'powershell' ? undefined : openSync(logPath, 'a')
  let child
  try {
    // New session (Node detached, or setsid inside a WSL guest). The detach helper
    // stays signal-deaf: SIGHUP from a Claude restart must not kill the job.
    // TaskStop reaches the job only from the waiter's SIGTERM/SIGINT handler.
    child = spawn(plan.command, plan.args, {
      cwd,
      env,
      detached: plan.detached,
      windowsHide: plan.windowsHide,
      stdio: plan.kind === 'powershell' ? 'ignore' : ['ignore', logFd, logFd]
    })
  } finally {
    if (logFd !== undefined) {
      closeSync(logFd)
    }
  }
  if (plan.kind === 'setsid' && typeof child.pid === 'number') {
    waitUntilSessionLeader(child.pid)
  }
  if (existsSync(cancelFile)) {
    if (typeof child.pid === 'number') {
      signalJob(child.pid, 'SIGTERM', platform)
    }
    child.unref()
    return
  }
  writeFileSync(
    metaPath,
    `${JSON.stringify({
      id,
      pid: child.pid,
      cwd,
      startedAt: new Date().toISOString(),
      command: request.command,
      logPath,
      exitPath
    })}\n`
  )
  child.unref()
}

function spawnDetach(id, env) {
  const child = spawn(process.execPath, [RUNNER_PATH, 'detach', '--id', id], {
    detached: true,
    stdio: 'ignore',
    env: { ...env, ORCA_DURABLE_JOB_CWD: process.cwd() }
  })
  child.unref()
}

function copyNewOutput(logPath, offset) {
  let size
  try {
    size = statSync(logPath).size
  } catch {
    return offset
  }
  if (size <= offset) {
    return offset
  }
  const fd = openSync(logPath, 'r')
  try {
    const buffer = Buffer.alloc(size - offset)
    readSync(fd, buffer, 0, buffer.length, offset)
    process.stdout.write(buffer)
  } finally {
    closeSync(fd)
  }
  return size
}

function runInline(request) {
  if (process.platform === 'win32') {
    process.stderr.write('orca-durable-job: detach failed\n')
    process.exit(1)
  }
  process.stderr.write('orca-durable-job: detach failed, running in this process\n')
  const child = spawn('/bin/bash', ['-c', request.command], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit'
  })
  // Detach failed, so this process is the job. Exit with the child's status and do not return.
  let finished = false
  const finish = (status) => {
    if (finished) {
      return
    }
    finished = true
    process.exit(status ?? 1)
  }
  child.once('error', () => finish(1))
  child.once('exit', (status) => finish(status))
}

async function follow(job, root) {
  process.stdout.write(`orca-durable-job id=${job.id} log=${job.logPath}\n`)
  let offset = 0
  for (;;) {
    offset = copyNewOutput(job.logPath, offset)
    const current = readJob(job.id, root)
    if (current?.state === 'exited') {
      offset = copyNewOutput(job.logPath, offset)
      process.exit(current.exitCode ?? 0)
    }
    if (current?.state === 'lost') {
      offset = copyNewOutput(job.logPath, offset)
      await sleep(200)
      const settled = readJob(job.id, root)
      if (settled?.state === 'exited') {
        process.exit(settled.exitCode ?? 0)
      }
      process.exit(1)
    }
    await sleep(200)
  }
}

export async function runJob(id, env = process.env) {
  assertJobId(id)
  const dir = jobDir(id, jobRoot(env))
  const request = readJson(join(dir, 'request.json'))
  if (!request || typeof request.command !== 'string') {
    throw new Error(`Durable job ${id} has no request`)
  }
  // TaskStop SIGTERMs this waiter. Forward it to the job group. Do not catch SIGHUP.
  armWaiterStop(dir)
  const root = jobRoot(env)
  const existing = readJob(id, root)
  if (existing?.state === 'exited' || existing?.state === 'running' || existing?.state === 'lost') {
    await follow(existing, root)
    return
  }
  const claimed = claimStart(dir)
  if (claimed) {
    spawnDetach(id, env)
  }
  const meta = await waitFor(() => {
    const job = readJob(id, root)
    return job && job.state !== 'pending' ? job : undefined
  }, 3000)
  if (existsSync(join(dir, 'cancel'))) {
    process.exit(143)
  }
  if (!meta) {
    if (claimed) {
      runInline(request)
      return
    }
    throw new Error(`Durable job ${id} did not start`)
  }
  await follow(meta, root)
}

export async function startJob({ command, cwd, sessionId, description = '' }, env = process.env) {
  if (typeof command !== 'string' || command.trim() === '') {
    throw new Error('Missing command')
  }
  const id = newJobId()
  const request = {
    id,
    command,
    description,
    createdAt: new Date().toISOString(),
    ...(sessionId ? { sessionId } : {}),
    ...(typeof cwd === 'string' && isAbsolute(cwd) ? { cwd } : {})
  }
  createJobRequest(request, env)
  const previous = process.cwd()
  try {
    if (typeof cwd === 'string' && cwd.length > 0) {
      process.chdir(cwd)
    }
    spawnDetach(id, env)
  } finally {
    process.chdir(previous)
  }
  const job = await waitFor(() => {
    const current = readJob(id, jobRoot(env))
    return current && current.state !== 'pending' ? current : undefined
  }, 3000)
  if (!job) {
    throw new Error(`Durable job ${id} did not start`)
  }
  return job
}

export function readJobLog(id, root = jobRoot()) {
  const job = readJob(id, root)
  if (!job) {
    throw new Error(`Unknown durable job ${id}`)
  }
  try {
    return readFileSync(job.logPath, 'utf8')
  } catch {
    return ''
  }
}

export function stopJob(id, root = jobRoot(), platform = process.platform) {
  const job = readJob(id, root)
  if (!job) {
    return { stopped: false, reason: 'missing' }
  }
  if (job.state !== 'running' || typeof job.pid !== 'number' || job.pid <= 1) {
    return { stopped: false, reason: job.state, id }
  }
  if (!signalJob(job.pid, 'SIGTERM', platform)) {
    return { stopped: false, reason: 'signal-failed', id }
  }
  return { stopped: true, id, pid: job.pid }
}

function flagValue(argv, name) {
  const index = argv.indexOf(name)
  if (index === -1) {
    return undefined
  }
  const value = argv[index + 1]
  if (!value || value.startsWith('--')) {
    throw new Error(`${name} requires a value`)
  }
  return value
}

export async function main(argv = process.argv.slice(2)) {
  const [command, ...rest] = argv
  const json = rest.includes('--json')
  if (command === 'list') {
    const jobs = listJobs()
    if (json) {
      process.stdout.write(`${JSON.stringify({ jobs })}\n`)
    } else if (jobs.length === 0) {
      process.stdout.write('No durable jobs.\n')
    } else {
      for (const job of jobs) {
        const exit = job.exitCode === undefined ? '' : ` exit=${job.exitCode}`
        const pid = job.pid === undefined ? '' : ` pid=${job.pid}`
        process.stdout.write(`${job.id}\t${job.state}${pid}${exit}\t${job.command}\n`)
      }
    }
    return
  }
  if (
    command === 'status' ||
    command === 'logs' ||
    command === 'stop' ||
    command === 'run' ||
    command === 'detach'
  ) {
    const id = assertJobId(flagValue(rest, '--id'))
    if (command === 'detach') {
      detachJob(id)
      return
    }
    if (command === 'run') {
      await runJob(id)
      return
    }
    if (command === 'logs') {
      process.stdout.write(readJobLog(id))
      return
    }
    if (command === 'stop') {
      const result = stopJob(id)
      process.stdout.write(`${JSON.stringify(result)}\n`)
      if (!result.stopped) {
        process.exitCode = 1
      }
      return
    }
    const job = readJob(id)
    if (!job) {
      process.stderr.write(`Unknown durable job ${id}\n`)
      process.exitCode = 1
      return
    }
    process.stdout.write(`${JSON.stringify(job)}\n`)
    return
  }
  if (command === 'start') {
    const separator = rest.indexOf('--')
    const commandText =
      separator !== -1 ? rest.slice(separator + 1).join(' ') : flagValue(rest, '--command')
    const cwd = flagValue(rest, '--cwd') ?? process.cwd()
    const job = await startJob({ command: commandText, cwd })
    process.stdout.write(
      `${JSON.stringify({ id: job.id, state: job.state, logPath: job.logPath, pid: job.pid })}\n`
    )
    return
  }
  process.stderr.write(
    'Usage: durable-background-job.mjs <list|status|logs|stop|start|run> [--id <id>] [--json]\n'
  )
  process.exitCode = 1
}

function invokedDirectly() {
  const entry = process.argv[1]
  // A bundled import's filename is the app chunk. Only the real script may run main().
  if (!entry || !RUNNER_PATH.endsWith('durable-background-job.mjs')) {
    return false
  }
  try {
    return realpathSync(entry) === realpathSync(RUNNER_PATH)
  } catch {
    return pathToFileURL(entry).href === import.meta.url
  }
}

if (invokedDirectly()) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(1)
  })
}
