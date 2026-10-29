import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HandlerContext } from '../dispatch'
import { JOB_HANDLERS } from './job'

const roots: string[] = []

function context(flags: Record<string, string>, json = false): HandlerContext {
  return {
    flags: new Map(Object.entries(flags)),
    cwd: tmpdir(),
    json,
    get client(): HandlerContext['client'] {
      throw new Error('job commands must stay local')
    }
  }
}

async function capture(run: () => Promise<void>): Promise<string> {
  let output = ''
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    output += String(chunk)
    return true
  })
  try {
    await run()
  } finally {
    spy.mockRestore()
  }
  return output
}

function readObject(text: string): Record<string, unknown> {
  const value: unknown = JSON.parse(text)
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`expected job object, got ${text}`)
  }
  const record: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    record[key] = entry
  }
  return record
}

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  if (typeof value !== 'string') {
    throw new Error(`expected ${key} to be a string`)
  }
  return value
}

function readNumber(record: Record<string, unknown>, key: string): number {
  const value = record[key]
  if (typeof value !== 'number') {
    throw new Error(`expected ${key} to be a number`)
  }
  return value
}

function readBoolean(record: Record<string, unknown>, key: string): boolean {
  const value = record[key]
  if (typeof value !== 'boolean') {
    throw new Error(`expected ${key} to be a boolean`)
  }
  return value
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
    const started = readObject(
      await capture(() =>
        JOB_HANDLERS['job start']!(context({ command: 'sleep 30', cwd: tmpdir() }))
      )
    )
    const startedId = readString(started, 'id')
    const startedState = readString(started, 'state')
    const startedPid = readNumber(started, 'pid')
    expect(startedState).toBe('running')
    const status = readObject(
      await capture(() => JOB_HANDLERS['job status']!(context({ id: startedId })))
    )
    expect(readString(status, 'id')).toBe(startedId)
    expect(readNumber(status, 'pid')).toBe(startedPid)
    const previous = process.exitCode
    const stopped = readObject(
      await capture(() => JOB_HANDLERS['job stop']!(context({ id: startedId })))
    )
    process.exitCode = previous
    expect(readBoolean(stopped, 'stopped')).toBe(true)
    try {
      process.kill(-startedPid, 'SIGKILL')
    } catch {
      // stop already ended the process group
    }
  })

  it('rejects a stop without an id', async () => {
    await expect(JOB_HANDLERS['job stop']!(context({}))).rejects.toThrow('Missing durable job id')
  })
})
