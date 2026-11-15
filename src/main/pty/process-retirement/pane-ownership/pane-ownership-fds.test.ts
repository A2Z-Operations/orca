import { describe, expect, it } from 'vitest'
import {
  classifyLinuxFdTarget,
  parseLsofFds,
  readLinuxFds,
  readMacFds,
  sharesWithAgent,
  wiringIds
} from './pane-ownership-fds'

describe('pane ownership fd kinds (#44 S4)', () => {
  it('Linux: names the kind of each target', () => {
    expect(classifyLinuxFdTarget(1, 'pipe:[4242]')).toEqual({
      fd: 1,
      kind: 'pipe',
      id: '4242',
      peer: null
    })
    expect(classifyLinuxFdTarget(1, 'socket:[777]')).toMatchObject({ kind: 'socket', id: '777' })
    expect(classifyLinuxFdTarget(0, '/dev/null')).toMatchObject({ kind: 'null' })
    expect(classifyLinuxFdTarget(2, '/dev/pts/3')).toMatchObject({ kind: 'pty', id: '/dev/pts/3' })
    expect(classifyLinuxFdTarget(1, '/tmp/claude/tasks/x.output')).toMatchObject({
      kind: 'file',
      id: '/tmp/claude/tasks/x.output'
    })
    expect(classifyLinuxFdTarget(1, 'anon_inode:[eventfd]')).toMatchObject({ kind: 'other' })
    expect(classifyLinuxFdTarget(1, null)).toMatchObject({ kind: 'closed' })
  })

  it('macOS: a Claude Code tool shell (stdin /dev/null, stdout and stderr a regular file) reads as null + file, not wired', () => {
    // the shape read with lsof from a real tool shell on 2026-11-15
    const out =
      'p62755\nf0\ntCHR\nd0x...\nn/dev/null\nf1\ntREG\nd0x1000010\nn/private/tmp/claude-501/x/tasks/a.output\nf2\ntREG\nd0x1000010\nn/private/tmp/claude-501/x/tasks/a.output\n'
    const fds = parseLsofFds(out).get(62755)!
    expect(fds.map((f) => f.kind)).toEqual(['null', 'file', 'file'])
    expect(fds[1].id).toBe('/private/tmp/claude-501/x/tasks/a.output')
    expect(fds.some((f) => sharesWithAgent(f, new Set(['0xabc'])))).toBe(false)
  })

  it('S4 fixture: a socket-pair stdout is a socket whose PEER, not its own id, is what the agent holds', () => {
    const child = parseLsofFds('p50\nf1\ntunix\nd0x7c14888449d127db\nn->0x4154e18c0\n').get(50)!
    const agent = parseLsofFds('p10\nf23\ntunix\nd0x4154e18c0\nn->0x7c14888449d127db\n').get(10)!
    expect(child[0]).toEqual({
      fd: 1,
      kind: 'socket',
      id: '0x7c14888449d127db',
      peer: '0x4154e18c0'
    })
    const ids = wiringIds(agent)
    expect(ids.has('0x7c14888449d127db')).toBe(false) // the two ends do not share one id
    expect(sharesWithAgent(child[0], ids)).toBe(true) // matched through the peer
  })

  it('Linux: a pipe shares one inode at both ends, so the id itself matches', () => {
    const ids = wiringIds([classifyLinuxFdTarget(5, 'pipe:[99]')])
    expect(sharesWithAgent(classifyLinuxFdTarget(1, 'pipe:[99]'), ids)).toBe(true)
    expect(sharesWithAgent(classifyLinuxFdTarget(1, 'pipe:[98]'), ids)).toBe(false)
  })

  it('macOS: one lsof call for all pids, standard fds only, and an empty answer is no answer', async () => {
    const calls: string[][] = []
    const result = await readMacFds([20, 21], [0, 1, 2], async (args) => {
      calls.push(args)
      return ''
    })
    expect(calls).toEqual([['-a', '-w', '-p', '20,21', '-d', '0,1,2', '-F', 'ftdn']])
    expect(result.size).toBe(0)
    expect(await readMacFds([], [0, 1, 2], async () => 'p1\n')).toEqual(new Map())
  })

  it('Linux: reads each fd link; a gone process reads as closed', async () => {
    const links: Record<string, string> = {
      '/proc/20/fd/1': 'socket:[5]',
      '/proc/20/fd/0': '/dev/null'
    }
    const result = await readLinuxFds([20], [0, 1, 2], {
      readlink: async (path) => {
        if (path in links) {
          return links[path]
        }
        throw new Error('ENOENT')
      }
    })
    expect(result.get(20)!.map((f) => f.kind)).toEqual(['null', 'socket', 'closed'])
  })
})
