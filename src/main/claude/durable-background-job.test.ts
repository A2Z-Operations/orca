import { execFileSync, spawn } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  utimesSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

const runnerPath = fileURLToPath(
  new URL('../../../resources/durable-jobs/durable-background-job.mjs', import.meta.url)
)
const hookPath = fileURLToPath(
  new URL('../../../resources/durable-jobs/durable-background-job-hook.mjs', import.meta.url)
)

type Plan = {
  request: { id: string; command: string; cwd?: string; sessionId?: string }
  response: {
    hookSpecificOutput: {
      hookEventName: string
      permissionDecision?: string
      permissionDecisionReason?: string
      additionalContext: string
      updatedInput: { command: string; run_in_background: boolean; description?: string }
    }
  }
}

type Job = {
  id: string
  state: string
  pid?: number
  exitCode?: number
  logPath: string
  cwd?: string
  command: string
}

type Api = {
  DURABLE_JOB_ALLOW_RULE: string
  WAITER_FORWARDED_SIGNALS: string[]
  shellQuote: (value: string) => string
  planBackgroundBashRewrite: (input: Record<string, unknown>) => Plan | null
  detachLaunchPlan: (input: Record<string, unknown>) => {
    kind: string
    command: string
    args: string[]
    detached: boolean
    windowsHide: boolean
    runnerBody?: string
    launchBody?: string
  }
  jobStopPlan: (
    pid: number,
    platform?: string
  ) => { kind: string; command?: string; args?: string[] } | null
  isWslGuest: (env: NodeJS.ProcessEnv, platform: string) => boolean
  powershellLaunchBody: (runnerPath: string, exitPath: string) => string
  createJobRequest: (request: Plan['request'], env?: NodeJS.ProcessEnv) => string
  formatSurvivingJobNote: (jobs: { state: string; id: string; logPath: string }[]) => string
  startJob: (input: { command: string; cwd?: string }, env?: NodeJS.ProcessEnv) => Promise<Job>
  readJob: (id: string, root?: string) => Job | undefined
  stopJob: (id: string, root?: string) => { stopped: boolean }
  listJobs: (root?: string) => Job[]
  sweepDurableJobs: (options?: {
    root?: string
    now?: number
    pendingMaxAgeMs?: number
    exitedMaxAgeMs?: number
  }) => { pending: string[]; exited: string[] }
}

let api: Api

beforeAll(async () => {
  api = (await import(runnerPath)) as Api
})

const roots: string[] = []

function jobRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'orca-durable-job-'))
  roots.push(root)
  return root
}

function envFor(root: string): NodeJS.ProcessEnv {
  return { ...process.env, ORCA_DURABLE_JOB_ROOT: root }
}

function ppidOf(pid: number): number {
  return Number(execFileSync('ps', ['-o', 'ppid=', '-p', String(pid)], { encoding: 'utf8' }).trim())
}

function pgidOf(pid: number): number {
  return Number(execFileSync('ps', ['-o', 'pgid=', '-p', String(pid)], { encoding: 'utf8' }).trim())
}

function yieldMs(ms: number): Promise<void> {
  // ast-grep-ignore: test-no-real-time-wait -- detached processes and waiter stdout are outside fake timers
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForJob(id: string, root: string, state: string): Promise<Job> {
  // ast-grep-ignore: test-no-wall-clock -- a real detached process is not advanced by fake timers
  const deadline = Date.now() + 8000
  // ast-grep-ignore: test-no-wall-clock -- the deadline is the real process, not the test clock
  while (Date.now() < deadline) {
    const job = api.readJob(id, root)
    if (job?.state === state) {
      return job
    }
    await yieldMs(50)
  }
  throw new Error(`job ${id} did not reach ${state}`)
}

afterEach(() => {
  for (const root of roots) {
    for (const job of api.listJobs(root)) {
      if (job.state === 'running' && typeof job.pid === 'number' && job.pid > 1) {
        try {
          process.kill(-job.pid, 'SIGKILL')
        } catch {
          try {
            process.kill(job.pid, 'SIGKILL')
          } catch {
            // already gone
          }
        }
      }
    }
    rmSync(root, { recursive: true, force: true })
  }
  roots.length = 0
})

describe('planBackgroundBashRewrite', () => {
  const toolInput = {
    command: 'sleep 120 && echo DURABLE_OK_TOKEN',
    run_in_background: true,
    description: 'durable job proof'
  }

  it('rewrites a background bash command and keeps Claude tracking it', () => {
    const root = jobRoot()
    const plan = api.planBackgroundBashRewrite({
      toolName: 'Bash',
      toolInput,
      runnerPath,
      nodePath: process.execPath,
      sessionId: 'sess-1',
      cwd: '/tmp/work',
      id: 'dj_0123456789abcdef',
      env: envFor(root),
      now: '2026-10-29T00:00:00.000Z'
    })
    expect(plan?.request).toMatchObject({
      id: 'dj_0123456789abcdef',
      command: toolInput.command,
      sessionId: 'sess-1',
      cwd: '/tmp/work'
    })
    const output = plan?.response.hookSpecificOutput
    expect(output?.hookEventName).toBe('PreToolUse')
    expect(output?.permissionDecision).toBe('allow')
    expect(output?.permissionDecisionReason).toBe(
      'Orca rewrote this background command to the durable waiter.'
    )
    expect(output?.updatedInput.run_in_background).toBe(true)
    expect(output?.updatedInput.description).toBe('durable job proof')
    expect(output?.updatedInput.command).toBe('orca-durable-job run --id dj_0123456789abcdef')
    expect(api.DURABLE_JOB_ALLOW_RULE).toBe('Bash(orca-durable-job run --id:*)')
    expect(output?.additionalContext).toContain('orca-durable-job logs --id dj_0123456789abcdef')
    expect(output?.additionalContext).toContain(join(root, 'dj_0123456789abcdef', 'output.log'))
  })

  it.each([
    ['foreground', { run_in_background: false }],
    ['missing flag', {}],
    ['empty command', { command: '   ', run_in_background: true }],
    [
      'already detached',
      { command: 'node durable-background-job.mjs run --id dj_x', run_in_background: true }
    ],
    [
      'stable waiter',
      { command: 'orca-durable-job run --id dj_0123456789abcdef', run_in_background: true }
    ]
  ])('leaves %s bash alone', (_label, overrides) => {
    expect(
      api.planBackgroundBashRewrite({
        toolName: 'Bash',
        toolInput: { command: 'echo hi', ...overrides },
        runnerPath,
        nodePath: process.execPath
      })
    ).toBeNull()
  })

  it('leaves non-bash tools, Monitor, and the escape hatch alone', () => {
    const base = {
      toolInput,
      runnerPath,
      nodePath: process.execPath
    }
    expect(api.planBackgroundBashRewrite({ ...base, toolName: 'Read' })).toBeNull()
    expect(api.planBackgroundBashRewrite({ ...base, toolName: 'Monitor' })).toBeNull()
    expect(
      api.planBackgroundBashRewrite({
        ...base,
        toolName: 'Monitor',
        toolInput: {
          command: 'tail -f /tmp/build.log',
          description: 'watch the build',
          persistent: true
        }
      })
    ).toBeNull()
    expect(
      api.planBackgroundBashRewrite({
        ...base,
        toolName: 'Bash',
        env: { ORCA_DURABLE_JOBS: '0' }
      })
    ).toBeNull()
  })

  it('allows the rewritten waiter on Windows too', () => {
    const plan = api.planBackgroundBashRewrite({
      toolName: 'Bash',
      toolInput,
      runnerPath,
      nodePath: process.execPath,
      platform: 'win32',
      id: 'dj_0123456789abcdef'
    })
    expect(plan?.response.hookSpecificOutput.permissionDecision).toBe('allow')
    expect(plan?.response.hookSpecificOutput.updatedInput.command).toBe(
      'orca-durable-job run --id dj_0123456789abcdef'
    )
  })

  it('quotes paths that contain spaces and apostrophes', () => {
    expect(api.shellQuote("/tmp/it's a path")).toBe(`'/tmp/it'\\''s a path'`)
  })

  it('writes the request only when the hook accepts the plan', () => {
    const root = jobRoot()
    const env = envFor(root)
    const plan = api.planBackgroundBashRewrite({
      toolName: 'Bash',
      toolInput,
      runnerPath,
      nodePath: process.execPath,
      id: 'dj_abcdef0123456789',
      env
    })
    expect(plan).not.toBeNull()
    if (!plan) {
      return
    }
    api.createJobRequest(plan.request, env)
    expect(() => api.createJobRequest(plan.request, env)).toThrow()
  })
})

describe('durable job hook', () => {
  it('prints updatedInput for a background bash command', async () => {
    const root = jobRoot()
    const child = spawn(process.execPath, [hookPath], {
      env: envFor(root),
      stdio: ['pipe', 'pipe', 'pipe']
    })
    let stdout = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stdin.end(
      JSON.stringify({
        hook_event_name: 'PreToolUse',
        tool_name: 'Bash',
        session_id: 'sess-hook',
        cwd: '/tmp/work',
        tool_input: {
          command: 'echo from-hook',
          run_in_background: true,
          description: 'hook proof'
        }
      })
    )
    const code = await new Promise<number>((resolve) =>
      child.on('exit', (status) => resolve(status ?? 1))
    )
    expect(code).toBe(0)
    const response = JSON.parse(stdout) as Plan['response']
    expect(response.hookSpecificOutput.updatedInput.run_in_background).toBe(true)
    expect(response.hookSpecificOutput.permissionDecision).toBe('allow')
    expect(response.hookSpecificOutput.updatedInput.command).toMatch(
      /^orca-durable-job run --id dj_[a-f0-9]{16}$/
    )
    expect(response.hookSpecificOutput.additionalContext).toContain(
      'orca-durable-job logs --id dj_'
    )
    expect(api.listJobs(root)).toHaveLength(1)
  })

  it('prints nothing for a foreground command', async () => {
    const child = spawn(process.execPath, [hookPath], {
      env: envFor(jobRoot()),
      stdio: ['pipe', 'pipe', 'pipe']
    })
    let stdout = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stdin.end(JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'echo hi' } }))
    const code = await new Promise<number>((resolve) =>
      child.on('exit', (status) => resolve(status ?? 1))
    )
    expect(code).toBe(0)
    expect(stdout).toBe('')
  })
})

describe('platform detach plan', () => {
  const paths = {
    cwd: '/work/project',
    commandPath: '/jobs/dj_0123456789abcdef/command.sh',
    exitPath: '/jobs/dj_0123456789abcdef/exit',
    logPath: '/jobs/dj_0123456789abcdef/output.log',
    runnerPath: '/jobs/dj_0123456789abcdef/runner.sh',
    launchPath: '/jobs/dj_0123456789abcdef/launch.ps1'
  }

  it.each(['darwin', 'linux'] as const)('detaches with node setsid on %s', (platform) => {
    const plan = api.detachLaunchPlan({ platform, guest: false, ...paths })
    expect(plan.kind).toBe('bash')
    expect(plan.command).toBe('/bin/bash')
    expect(plan.detached).toBe(true)
    expect(plan.args[0]).toBe('-c')
    expect(plan.args[1]).toContain(paths.commandPath)
    expect(plan.launchBody).toBeUndefined()
  })

  it('uses a hidden powershell -File launcher on Windows and keeps the user command out of it', () => {
    const plan = api.detachLaunchPlan({ platform: 'win32', guest: false, ...paths })
    expect(plan).toMatchObject({
      kind: 'powershell',
      command: 'powershell.exe',
      detached: true,
      windowsHide: true,
      args: ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-File', paths.launchPath]
    })
    expect(plan.launchBody).toContain(paths.runnerPath)
    expect(plan.launchBody).not.toContain('sleep 120')
    expect(plan.launchBody).not.toMatch(/EncodedCommand|ExecutionPolicy|cmd\.exe/)
    expect(plan.args.join(' ')).not.toMatch(/EncodedCommand|ExecutionPolicy|-Command/)
    expect(plan.runnerBody).toContain(paths.commandPath)
    expect(plan.runnerBody).toContain(paths.logPath)
  })

  it('uses setsid inside a WSL guest and falls back when setsid is missing', () => {
    const withSetsid = api.detachLaunchPlan({
      platform: 'linux',
      guest: true,
      setsidPath: '/usr/bin/setsid',
      ...paths
    })
    expect(withSetsid).toMatchObject({
      kind: 'setsid',
      command: '/usr/bin/setsid',
      detached: false,
      args: ['bash', '-c', expect.stringContaining(paths.commandPath)]
    })
    expect(withSetsid.args).not.toContain('--fork')
    const fallback = api.detachLaunchPlan({
      platform: 'linux',
      guest: true,
      ...paths
    })
    expect(fallback.kind).toBe('bash')
    expect(fallback.detached).toBe(true)
    expect(api.isWslGuest({ WSL_DISTRO_NAME: 'Ubuntu' }, 'linux')).toBe(true)
    expect(api.isWslGuest({ WSL_INTEROP: '/run/WSL/1_interop' }, 'linux')).toBe(true)
    expect(api.isWslGuest({ WSL_DISTRO_NAME: 'Ubuntu' }, 'darwin')).toBe(false)
    expect(api.isWslGuest({}, 'linux')).toBe(false)
  })

  it.each(['darwin', 'linux', 'win32'] as const)('stops a running pid on %s', (platform) => {
    expect(api.jobStopPlan(1, platform)).toBeNull()
    const plan = api.jobStopPlan(4242, platform)
    if (platform === 'win32') {
      expect(plan).toEqual({
        kind: 'taskkill',
        command: 'taskkill.exe',
        args: ['/PID', '4242', '/T', '/F']
      })
      return
    }
    expect(plan).toEqual({ kind: 'group', signal: 'SIGTERM', pid: 4242 })
  })

  it('forwards only catchable stop signals', () => {
    expect(api.WAITER_FORWARDED_SIGNALS).toEqual(['SIGTERM', 'SIGINT'])
    expect(api.powershellLaunchBody("/jobs/O'Brien/runner.sh", '/jobs/exit')).toContain(
      "'/jobs/O''Brien/runner.sh'"
    )
  })
})

describe('detached jobs', () => {
  it.skipIf(process.platform === 'win32')(
    'keeps running after the waiter is killed and records the exit code',
    async () => {
      const root = jobRoot()
      const env = envFor(root)
      const job = await api.startJob(
        { command: 'sleep 30; echo DURABLE_OK_TOKEN', cwd: tmpdir() },
        env
      )
      expect(job.pid).toBeGreaterThan(1)
      expect(ppidOf(job.pid!)).toBe(1)
      expect(pgidOf(job.pid!)).toBe(job.pid)

      const waiter = spawn(process.execPath, [runnerPath, 'run', '--id', job.id], {
        env,
        stdio: ['ignore', 'pipe', 'pipe']
      })
      let banner = ''
      waiter.stdout.setEncoding('utf8')
      waiter.stdout.on('data', (chunk) => {
        banner += chunk
      })
      // ast-grep-ignore: test-no-wall-clock -- the waiter banner arrives from a real child process
      const bannerDeadline = Date.now() + 4000
      // ast-grep-ignore: test-no-wall-clock -- stop waiting when the real waiter has had long enough
      while (!banner.includes(`id=${job.id}`) && Date.now() < bannerDeadline) {
        await yieldMs(20)
      }
      expect(banner).toContain(job.logPath)
      process.kill(waiter.pid!, 'SIGKILL')
      await new Promise((resolve) => waiter.on('exit', resolve))
      expect(api.readJob(job.id, root)?.state).toBe('running')
      expect(ppidOf(job.pid!)).toBe(1)

      expect(api.stopJob(job.id, root).stopped).toBe(true)
      await waitForJob(job.id, root, 'lost')
    },
    20000
  )

  async function bannerWaiter(
    env: NodeJS.ProcessEnv,
    id: string,
    logPath: string
  ): Promise<ReturnType<typeof spawn>> {
    const waiter = spawn(process.execPath, [runnerPath, 'run', '--id', id], {
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let banner = ''
    waiter.stdout?.setEncoding('utf8')
    waiter.stdout?.on('data', (chunk) => {
      banner += chunk
    })
    // ast-grep-ignore: test-no-wall-clock -- the waiter banner arrives from a real child process
    const bannerDeadline = Date.now() + 4000
    // ast-grep-ignore: test-no-wall-clock -- stop waiting when the real waiter has had long enough
    while (!banner.includes(`id=${id}`) && Date.now() < bannerDeadline) {
      await yieldMs(20)
    }
    expect(banner).toContain(logPath)
    return waiter
  }

  it.skipIf(process.platform === 'win32')(
    'forwards SIGTERM from the waiter to the job process group',
    async () => {
      const root = jobRoot()
      const env = envFor(root)
      const job = await api.startJob({ command: 'sleep 30', cwd: tmpdir() }, env)
      expect(job.pid).toBeGreaterThan(1)
      const waiter = await bannerWaiter(env, job.id, job.logPath)
      process.kill(waiter.pid!, 'SIGTERM')
      const waiterCode = await new Promise<number>((resolve) =>
        waiter.on('exit', (status) => resolve(status ?? 1))
      )
      expect(waiterCode).toBe(143)
      await waitForJob(job.id, root, 'lost')
    },
    20000
  )

  it.skipIf(process.platform === 'win32')(
    'does not forward SIGHUP, so a session restart leaves the job running',
    async () => {
      const root = jobRoot()
      const env = envFor(root)
      const job = await api.startJob({ command: 'sleep 30', cwd: tmpdir() }, env)
      const waiter = await bannerWaiter(env, job.id, job.logPath)
      process.kill(waiter.pid!, 'SIGHUP')
      await new Promise((resolve) => waiter.on('exit', resolve))
      expect(api.readJob(job.id, root)?.state).toBe('running')
      expect(api.stopJob(job.id, root).stopped).toBe(true)
      await waitForJob(job.id, root, 'lost')
    },
    20000
  )

  it.skipIf(process.platform === 'win32')(
    'propagates the command exit code from a directory with spaces',
    async () => {
      const root = mkdtempSync(join(tmpdir(), 'orca durable jobs '))
      roots.push(root)
      const cwd = mkdtempSync(join(tmpdir(), 'orca durable cwd '))
      const env = envFor(root)
      const job = await api.startJob({ command: 'pwd; exit 7', cwd }, env)
      const settled = await waitForJob(job.id, root, 'exited')
      expect(settled.exitCode).toBe(7)
      expect(realpathSync(readFileSync(settled.logPath, 'utf8').trim())).toBe(realpathSync(cwd))
    }
  )

  it.skipIf(process.platform === 'win32')(
    'does not start a second process when the job is already running',
    async () => {
      const root = jobRoot()
      const env = envFor(root)
      const job = await api.startJob({ command: 'sleep 30', cwd: tmpdir() }, env)
      const child = spawn(process.execPath, [runnerPath, 'run', '--id', job.id], {
        env,
        stdio: 'ignore'
      })
      await yieldMs(300)
      expect(api.readJob(job.id, root)?.pid).toBe(job.pid)
      process.kill(child.pid!, 'SIGKILL')
      api.stopJob(job.id, root)
    }
  )
})

describe('formatSurvivingJobNote', () => {
  it('names running jobs and stays quiet when none are running', () => {
    expect(
      api.formatSurvivingJobNote([
        { state: 'running', id: 'dj_0123456789abcdef', logPath: '/tmp/job/output.log' },
        { state: 'exited', id: 'dj_abcdef0123456789', logPath: '/tmp/other/output.log' }
      ])
    ).toBe(
      'Detached Orca jobs still running after this restart: dj_0123456789abcdef log=/tmp/job/output.log.'
    )
    expect(api.formatSurvivingJobNote([])).toBe('No detached Orca jobs were still running.')
  })
})

describe('sweepDurableJobs', () => {
  const hour = 60 * 60 * 1000
  const day = 24 * hour
  const now = Date.parse('2026-10-29T12:00:00.000Z')

  function request(id: string, createdAt?: string): Plan['request'] {
    return {
      id,
      command: 'echo sweep',
      ...(createdAt ? { createdAt } : {})
    }
  }

  it('drops pending requests older than an hour', () => {
    const root = jobRoot()
    const env = envFor(root)
    const stale = 'dj_aaaaaaaaaaaaaaaa'
    const fresh = 'dj_bbbbbbbbbbbbbbbb'
    const mtimeOnly = 'dj_cccccccccccccccc'
    const createdWins = 'dj_dddddddddddddddd'
    api.createJobRequest(request(stale, new Date(now - 2 * hour).toISOString()), env)
    api.createJobRequest(request(fresh, new Date(now - 30 * 60 * 1000).toISOString()), env)
    const mtimeDir = api.createJobRequest(request(mtimeOnly), env)
    const createdDir = api.createJobRequest(
      request(createdWins, new Date(now - 10 * 60 * 1000).toISOString()),
      env
    )
    const ancient = new Date(now - 3 * hour)
    utimesSync(join(mtimeDir, 'request.json'), ancient, ancient)
    utimesSync(join(createdDir, 'request.json'), ancient, ancient)

    const removed = api.sweepDurableJobs({ root, now })

    expect(removed.pending).toEqual([stale, mtimeOnly])
    expect(removed.exited).toEqual([])
    expect(api.listJobs(root).map((job) => job.id)).toEqual([fresh, createdWins])
  })

  it('drops exited jobs by exit-file age and keeps a recent exit with an old request', () => {
    const root = jobRoot()
    const env = envFor(root)
    const oldExit = 'dj_1111111111111111'
    const youngExit = 'dj_2222222222222222'
    api.createJobRequest(request(oldExit, new Date(now - hour).toISOString()), env)
    api.createJobRequest(request(youngExit, new Date(now - 30 * day).toISOString()), env)
    writeFileSync(join(root, oldExit, 'exit'), '0')
    writeFileSync(join(root, youngExit, 'exit'), '0')
    const old = new Date(now - 8 * day)
    utimesSync(join(root, oldExit, 'exit'), old, old)
    utimesSync(join(root, youngExit, 'exit'), new Date(now - day), new Date(now - day))

    const removed = api.sweepDurableJobs({ root, now })

    expect(removed).toEqual({ pending: [], exited: [oldExit] })
    expect(api.listJobs(root).map((job) => job.id)).toEqual([youngExit])
  })

  it('keeps a live job, a lost job, and directories that are not jobs', () => {
    const root = jobRoot()
    const env = envFor(root)
    const running = 'dj_3333333333333333'
    const lost = 'dj_4444444444444444'
    api.createJobRequest(request(running, new Date(now - 30 * day).toISOString()), env)
    api.createJobRequest(request(lost, new Date(now - 30 * day).toISOString()), env)
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      stdio: 'ignore'
    })
    writeFileSync(join(root, running, 'meta.json'), `${JSON.stringify({ pid: child.pid })}\n`)
    writeFileSync(join(root, lost, 'meta.json'), `${JSON.stringify({ pid: 4_000_000_000 })}\n`)
    mkdirSync(join(root, 'not-a-job'))

    try {
      const removed = api.sweepDurableJobs({ root, now })
      expect(removed).toEqual({ pending: [], exited: [] })
      expect(api.listJobs(root).map((job) => job.state)).toEqual(['running', 'lost'])
      expect(existsSync(join(root, 'not-a-job'))).toBe(true)
    } finally {
      child.kill()
    }
  })
})
