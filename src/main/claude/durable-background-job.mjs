#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  statSync,
  realpathSync,
  writeFileSync
} from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const JOB_ID = /^dj_[a-f0-9]{16}$/
const RUNNER_PATH = import.meta.filename

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
  if (platform === 'win32' || env.ORCA_DURABLE_JOBS === '0') {
    return null
  }
  if (toolName !== 'Bash') {
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
  if (toolInput.command.includes('durable-background-job.mjs')) {
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
  const command = `${shellQuote(nodePath)} ${shellQuote(runnerPath)} run --id ${id}`
  return {
    request,
    response: {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        additionalContext: `Orca detached this background command as job ${id}. It keeps running if Claude restarts. Log: ${logPath}. Read it with ${shellQuote(nodePath)} ${shellQuote(runnerPath)} logs --id ${id}.`,
        updatedInput: { ...toolInput, command, run_in_background: true }
      }
    }
  }
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

export function detachJob(id, env = process.env) {
  if (process.platform === 'win32') {
    throw new Error('Durable jobs are not available on Windows')
  }
  const dir = jobDir(id, jobRoot(env))
  const request = readJson(join(dir, 'request.json'))
  if (!request || typeof request.command !== 'string') {
    throw new Error(`Durable job ${id} has no request`)
  }
  const metaPath = join(dir, 'meta.json')
  if (existsSync(metaPath)) {
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
  writeFileSync(
    commandPath,
    request.command.endsWith('\n') ? request.command : `${request.command}\n`
  )
  const script = [
    'set +e',
    `cd ${shellQuote(cwd)} || exit 97`,
    `bash ${shellQuote(commandPath)}`,
    '__orca_code=$?',
    `printf '%s\\n' "$__orca_code" > ${shellQuote(exitPath)}`,
    'exit "$__orca_code"'
  ].join('\n')
  const logFd = openSync(logPath, 'a')
  let child
  try {
    // New session, then the parent exits, so the job is reparented to pid 1 and
    // outlives Claude's process tree. Do not forward the waiter's signals: a
    // restart kills the waiter and must not kill the job.
    child = spawn('/bin/bash', ['-c', script], {
      cwd,
      env,
      detached: true,
      stdio: ['ignore', logFd, logFd]
    })
  } finally {
    closeSync(logFd)
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
  process.stderr.write('orca-durable-job: detach failed, running in this process\n')
  const result = spawnSync('/bin/bash', ['-c', request.command], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit'
  })
  process.exit(result.status ?? 1)
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
  if (!meta) {
    if (claimed) {
      runInline(request)
    }
    throw new Error(`Durable job ${id} did not start`)
  }
  await follow(meta, root)
}

export async function startJob({ command, cwd, sessionId, description = '' }, env = process.env) {
  if (process.platform === 'win32') {
    throw new Error('Durable jobs are not available on Windows')
  }
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

export function stopJob(id, root = jobRoot()) {
  const job = readJob(id, root)
  if (!job) {
    return { stopped: false, reason: 'missing' }
  }
  if (job.state !== 'running' || typeof job.pid !== 'number' || job.pid <= 1) {
    return { stopped: false, reason: job.state, id }
  }
  try {
    process.kill(-job.pid, 'SIGTERM')
  } catch {
    try {
      process.kill(job.pid, 'SIGTERM')
    } catch {
      return { stopped: false, reason: 'signal-failed', id }
    }
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
  if (!entry) {
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
