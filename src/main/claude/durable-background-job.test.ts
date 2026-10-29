import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

const runnerPath = fileURLToPath(new URL('./durable-background-job.mjs', import.meta.url))
const hookPath = fileURLToPath(new URL('./durable-background-job-hook.mjs', import.meta.url))

type Plan = {
  request: { id: string; command: string; cwd?: string; sessionId?: string }
  response: {
    hookSpecificOutput: {
      hookEventName: string
      permissionDecision?: string
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
  shellQuote: (value: string) => string
  planBackgroundBashRewrite: (input: Record<string, unknown>) => Plan | null
  createJobRequest: (request: Plan['request'], env?: NodeJS.ProcessEnv) => string
  formatSurvivingJobNote: (jobs: { state: string; id: string; logPath: string }[]) => string
  startJob: (input: { command: string; cwd?: string }, env?: NodeJS.ProcessEnv) => Promise<Job>
  readJob: (id: string, root?: string) => Job | undefined
  stopJob: (id: string, root?: string) => { stopped: boolean }
  listJobs: (root?: string) => Job[]
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

async function waitForJob(id: string, root: string, state: string): Promise<Job> {
  const deadline = Date.now() + 8000
  while (Date.now() < deadline) {
    const job = api.readJob(id, root)
    if (job?.state === state) {
      return job
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
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
    expect(output?.permissionDecision).toBeUndefined()
    expect(output?.updatedInput.run_in_background).toBe(true)
    expect(output?.updatedInput.description).toBe('durable job proof')
    expect(output?.updatedInput.command).toContain('run --id dj_0123456789abcdef')
    expect(output?.updatedInput.command).toContain(runnerPath)
    expect(output?.additionalContext).toContain(join(root, 'dj_0123456789abcdef', 'output.log'))
  })

  it.each([
    ['foreground', { run_in_background: false }],
    ['missing flag', {}],
    ['empty command', { command: '   ', run_in_background: true }],
    [
      'already detached',
      { command: 'node durable-background-job.mjs run --id dj_x', run_in_background: true }
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

  it('leaves non-bash tools, Windows, and the escape hatch alone', () => {
    const base = {
      toolInput,
      runnerPath,
      nodePath: process.execPath
    }
    expect(api.planBackgroundBashRewrite({ ...base, toolName: 'Read' })).toBeNull()
    expect(
      api.planBackgroundBashRewrite({ ...base, toolName: 'Bash', platform: 'win32' })
    ).toBeNull()
    expect(
      api.planBackgroundBashRewrite({
        ...base,
        toolName: 'Bash',
        env: { ORCA_DURABLE_JOBS: '0' }
      })
    ).toBeNull()
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
    expect(response.hookSpecificOutput.updatedInput.command).toContain('run --id dj_')
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
      const bannerDeadline = Date.now() + 4000
      while (!banner.includes(`id=${job.id}`) && Date.now() < bannerDeadline) {
        await new Promise((resolve) => setTimeout(resolve, 20))
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
      await new Promise((resolve) => setTimeout(resolve, 300))
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
