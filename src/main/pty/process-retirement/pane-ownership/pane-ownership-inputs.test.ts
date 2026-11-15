import { describe, expect, it } from 'vitest'
import {
  parsePaneOwnershipMode,
  readPaneOwnershipMode,
  PANE_OWNERSHIP_MODE_ENV
} from './pane-ownership-mode'
import {
  lstartUtcToMs,
  parseOwnershipTable,
  readLinuxStartTicks,
  readOwnershipTable,
  OWNERSHIP_PS_ARGS
} from './pane-ownership-table'
import {
  DurableJobIndex,
  matchDurableJob,
  DURABLE_START_WINDOW_MS,
  MISSING_META_RETRY_MS
} from './pane-ownership-durable'

describe('pane ownership mode (#44)', () => {
  const missing = async (): Promise<string> => {
    throw new Error('ENOENT')
  }
  const file = (text: string) => async () => text
  const modeOf = async (
    env: NodeJS.ProcessEnv,
    path: string | null,
    read?: (p: string) => Promise<string>
  ) => (await readPaneOwnershipMode(env, path, read)).mode

  it('a missing, empty or unknown mode file reads as observe, never kill (Leader condition b)', async () => {
    expect(await modeOf({}, '/nope', missing)).toBe('observe')
    expect(await modeOf({}, '/m', file(''))).toBe('observe')
    expect(await modeOf({}, '/m', file('  \n'))).toBe('observe')
    expect(await readPaneOwnershipMode({}, '/m', file('banana'))).toEqual({
      mode: 'observe',
      requested: 'banana'
    })
    expect(await modeOf({}, null)).toBe('observe')
  })

  it('kill reads as observe in stage 2 and says it was asked for', () => {
    expect(parsePaneOwnershipMode('KILL')).toEqual({ mode: 'observe', requested: 'kill' })
  })

  it('only an explicit off turns it off; the env var wins over the file when set', async () => {
    expect(await modeOf({}, '/m', file('off\n'))).toBe('off')
    expect(await modeOf({ [PANE_OWNERSHIP_MODE_ENV]: 'off' }, '/m', file('observe'))).toBe('off')
    expect(await modeOf({ [PANE_OWNERSHIP_MODE_ENV]: ' ' }, '/m', file('off'))).toBe('off')
  })
})

describe('pane ownership table (#44)', () => {
  it('parses uid, a UTC lstart (also a space-padded day) and a comm with spaces', () => {
    const rows = parseOwnershipTable(
      '  10     1    10   501 Sat Nov 15 08:00:00 2026 claude\n 20 10 20 501 Wed Nov  5 07:01:02 2026 Google Chrome Helper\n 30 1 30 ? Sat Nov 15 08:00:00 2026 x\n'
    )
    expect(rows[0]).toEqual({
      pid: 10,
      ppid: 1,
      pgid: 10,
      uid: 501,
      startedAt: 'Sat Nov 15 08:00:00 2026',
      comm: 'claude'
    })
    expect(rows[1]).toMatchObject({
      startedAt: 'Wed Nov 5 07:01:02 2026',
      comm: 'Google Chrome Helper'
    })
    expect(Number.isNaN(rows[2].uid)).toBe(true)
    expect(lstartUtcToMs('Sat Nov 15 08:00:00 2026')).toBe(Date.UTC(2026, 10, 15, 8, 0, 0))
  })

  it('runs under TZ=UTC; an in-process read without uids is redone with ps', async () => {
    let psEnv: NodeJS.ProcessEnv | null = null
    const capture = await readOwnershipTable(1_000, {
      runInProcess: async (args, opts) => {
        expect(args).toEqual(OWNERSHIP_PS_ARGS)
        expect(opts.env?.TZ).toBe('UTC')
        return {
          stdout: '10 1 10 ? Sat Nov 15 08:00:00 2026 claude\n',
          stderr: '',
          code: 0,
          signal: null,
          timedOut: false
        }
      },
      runPs: async (_args, env) => {
        psEnv = env
        return '10 1 10 501 Sat Nov 15 08:00:00 2026 claude\n'
      },
      now: () => 42
    })
    expect(psEnv!.TZ).toBe('UTC')
    expect(capture).toEqual({
      via: 'ps',
      capturedAtMs: 42,
      rows: [expect.objectContaining({ pid: 10, uid: 501 })]
    })
  })

  it('Linux start ticks: field 22 after the LAST paren, even when comm contains one', async () => {
    const stat = '20 (we) ird) S 1 20 20 0 -1 4194304 1 2 3 4 5 6 7 8 20 0 1 0 98765 1 2'
    expect(await readLinuxStartTicks(20, async () => stat)).toBe('98765')
    expect(
      await readLinuxStartTicks(20, async () => {
        throw new Error('ENOENT')
      })
    ).toBeNull()
  })
})

describe('pane ownership durable jobs (#44 M2)', () => {
  const meta = { pid: 70, startedAt: '2026-11-15T08:00:03.500Z' }
  function fakeFs(files: Record<string, string>) {
    const reads: string[] = []
    return {
      reads,
      fs: {
        readdir: async () => Object.keys(files),
        readFile: async (path: string) => {
          const id = path.split('/').at(-2) ?? ''
          reads.push(id)
          if (!(id in files)) {
            throw new Error('ENOENT')
          }
          return files[id]
        }
      }
    }
  }

  it('matches by pid and a process start shortly before the meta time; the job runner is not needed', async () => {
    const jobs = await new DurableJobIndex(
      '/root',
      fakeFs({ job1: JSON.stringify(meta) }).fs
    ).refresh()
    expect(matchDurableJob({ pid: 70, startedAt: 'Sat Nov 15 08:00:03 2026' }, jobs)?.id).toBe(
      'job1'
    )
    expect(matchDurableJob({ pid: 71, startedAt: 'Sat Nov 15 08:00:03 2026' }, jobs)).toBeNull()
    // the same pid, started long before the job: a reused pid, not the job
    expect(matchDurableJob({ pid: 70, startedAt: 'Sat Nov 15 07:00:00 2026' }, jobs)).toBeNull()
    expect(DURABLE_START_WINDOW_MS).toBeGreaterThanOrEqual(5_000)
  })

  it('parses each meta file ONCE across refreshes (a real root holds thousands)', async () => {
    const f = fakeFs({ job1: JSON.stringify(meta), job2: JSON.stringify({ ...meta, pid: 71 }) })
    const index = new DurableJobIndex('/root', f.fs)
    await index.refresh()
    await index.refresh()
    await index.refresh()
    expect(f.reads.sort()).toEqual(['job1', 'job2'])
  })

  it('a folder without its meta file yet is retried, at most every 30 s, and matched once it appears', async () => {
    const files: Record<string, string> = { job1: 'not json yet' }
    const f = fakeFs(files)
    let nowMs = 1_000_000
    const index = new DurableJobIndex('/root', f.fs, () => nowMs)
    const entry = { pid: 70, startedAt: 'Sat Nov 15 08:00:03 2026' }
    expect(matchDurableJob(entry, await index.refresh())).toBeNull()
    files.job1 = JSON.stringify(meta)
    expect(matchDurableJob(entry, await index.refresh())).toBeNull() // retried too soon
    nowMs += MISSING_META_RETRY_MS
    expect(matchDurableJob(entry, await index.refresh())?.id).toBe('job1')
  })

  it('an unreadable root lists no jobs', async () => {
    const index = new DurableJobIndex('/root', {
      readdir: async () => {
        throw new Error('ENOENT')
      },
      readFile: async () => ''
    })
    expect(await index.refresh()).toEqual([])
  })
})
