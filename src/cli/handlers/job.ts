import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { CommandHandler } from '../dispatch'
import { RuntimeClientError } from '../runtime/types'

type DurableJob = {
  id: string
  state: string
  command: string
  logPath: string
  pid?: number
  exitCode?: number
}

type StopResult = { stopped: boolean; reason?: string; id?: string; pid?: number }

type DurableJobApi = {
  listJobs: () => DurableJob[]
  readJob: (id: string) => DurableJob | undefined
  readJobLog: (id: string) => string
  stopJob: (id: string) => StopResult
  startJob: (input: { command: string; cwd?: string }) => Promise<DurableJob>
}

function runnerModuleUrl(): string {
  // build:cli emits CommonJS, where import.meta.dirname is absent.
  const here = __dirname
  const candidates = [
    join(here, '../../main/claude/durable-background-job.mjs'),
    join(here, '../../../src/main/claude/durable-background-job.mjs'),
    join(process.cwd(), 'src/main/claude/durable-background-job.mjs')
  ]
  const found = candidates.find((path) => existsSync(path))
  if (!found) {
    throw new RuntimeClientError(
      'invalid_argument',
      'Durable job runner is not available in this build'
    )
  }
  return pathToFileURL(found).href
}

async function loadJobs(): Promise<DurableJobApi> {
  return import(runnerModuleUrl()) as Promise<DurableJobApi>
}

function requireId(flags: Map<string, string | boolean>): string {
  const id = flags.get('id')
  if (typeof id !== 'string' || id.length === 0) {
    throw new RuntimeClientError('invalid_argument', 'Missing durable job id')
  }
  return id
}

function asError(error: unknown): RuntimeClientError {
  if (error instanceof RuntimeClientError) {
    return error
  }
  return new RuntimeClientError(
    'invalid_argument',
    error instanceof Error ? error.message : String(error)
  )
}

export const JOB_HANDLERS: Record<string, CommandHandler> = {
  'job list': async ({ json }) => {
    try {
      const jobs = (await loadJobs()).listJobs()
      if (json) {
        process.stdout.write(`${JSON.stringify({ jobs })}\n`)
        return
      }
      if (jobs.length === 0) {
        process.stdout.write('No durable jobs.\n')
        return
      }
      for (const job of jobs) {
        const exit = job.exitCode === undefined ? '' : ` exit=${job.exitCode}`
        const pid = job.pid === undefined ? '' : ` pid=${job.pid}`
        process.stdout.write(`${job.id}\t${job.state}${pid}${exit}\t${job.command}\n`)
      }
    } catch (error) {
      throw asError(error)
    }
  },
  'job status': async ({ flags }) => {
    try {
      const job = (await loadJobs()).readJob(requireId(flags))
      if (!job) {
        throw new RuntimeClientError('invalid_argument', 'Unknown durable job')
      }
      process.stdout.write(`${JSON.stringify(job)}\n`)
    } catch (error) {
      throw asError(error)
    }
  },
  'job logs': async ({ flags }) => {
    try {
      process.stdout.write((await loadJobs()).readJobLog(requireId(flags)))
    } catch (error) {
      throw asError(error)
    }
  },
  'job stop': async ({ flags }) => {
    try {
      const result = (await loadJobs()).stopJob(requireId(flags))
      process.stdout.write(`${JSON.stringify(result)}\n`)
      if (!result.stopped) {
        process.exitCode = 1
      }
    } catch (error) {
      throw asError(error)
    }
  },
  'job start': async ({ flags, cwd }) => {
    const command = flags.get('command')
    if (typeof command !== 'string' || command.trim() === '') {
      throw new RuntimeClientError('invalid_argument', 'Missing command')
    }
    const requestedCwd = flags.get('cwd')
    try {
      const job = await (
        await loadJobs()
      ).startJob({
        command,
        cwd: typeof requestedCwd === 'string' && requestedCwd.length > 0 ? requestedCwd : cwd
      })
      process.stdout.write(
        `${JSON.stringify({ id: job.id, state: job.state, pid: job.pid, logPath: job.logPath })}\n`
      )
    } catch (error) {
      throw asError(error)
    }
  }
}
