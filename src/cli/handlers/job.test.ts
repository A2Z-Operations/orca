import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { HandlerContext } from '../dispatch'
import { JOB_HANDLERS } from './job'

const roots: string[] = []

function context(flags: Record<string, string>, json = false): HandlerContext {
  return {
    flags: new Map(Object.entries(flags)),
    cwd: tmpdir(),
    json,
    get client(): never {
      throw new Error('job commands must stay local')
    }
  } as HandlerContext
}

async function capture(run: () => Promise<void>): Promise<string> {
  let output = ''
  const write = process.stdout.write
  process.stdout.write = ((chunk: string | Uint8Array) => {
    output += String(chunk)
    return true
  }) as typeof process.stdout.write
  try {
    await run()
  } finally {
    process.stdout.write = write
  }
  return output
}

afterEach(() => {
  delete process.env.ORCA_DURABLE_JOB_ROOT
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true })
  }
  roots.length = 0
})

describe('job handlers', () => {
  it('lists an empty directory without touching the runtime client', async () => {
    const root = mkdtempSync(join(tmpdir(), 'orca-job-cli-'))
    roots.push(root)
    process.env.ORCA_DURABLE_JOB_ROOT = root
    const output = await capture(() => JOB_HANDLERS['job list']!(context({})))
    expect(output).toBe('No durable jobs.\n')
    const json = await capture(() => JOB_HANDLERS['job list']!(context({}, true)))
    expect(JSON.parse(json)).toEqual({ jobs: [] })
  })

  it('starts, reads, and stops a job through the local handlers', async () => {
    const root = mkdtempSync(join(tmpdir(), 'orca-job-cli-'))
    roots.push(root)
    process.env.ORCA_DURABLE_JOB_ROOT = root
    const started = JSON.parse(
      await capture(() =>
        JOB_HANDLERS['job start']!(context({ command: 'sleep 30', cwd: tmpdir() }))
      )
    ) as { id: string; state: string; pid: number }
    expect(started.state).toBe('running')
    const status = JSON.parse(
      await capture(() => JOB_HANDLERS['job status']!(context({ id: started.id })))
    ) as { id: string; pid: number }
    expect(status).toMatchObject({ id: started.id, pid: started.pid })
    const previous = process.exitCode
    const stopped = JSON.parse(
      await capture(() => JOB_HANDLERS['job stop']!(context({ id: started.id })))
    ) as { stopped: boolean }
    process.exitCode = previous
    expect(stopped.stopped).toBe(true)
    try {
      process.kill(-started.pid, 'SIGKILL')
    } catch {
      // stop already ended the process group
    }
  })

  it('rejects a stop without an id', async () => {
    await expect(JOB_HANDLERS['job stop']!(context({}))).rejects.toThrow('Missing durable job id')
  })
})
