import { describe, expect, it } from 'vitest'
import { checkNodeMajor, enginesNodeMajor } from './node-major-guard.mjs'

// Fork (#48 slice 13): Node 26.7's node:sqlite backup() settles only on the event loop's next wake-up, so the
// SQLite backup tests time out under vitest. The repo pins Node 24 (engines.node, the Electron runtime), and a
// local run on another major now stops with one clear line instead of failing deep inside unrelated tests.
const base = { execPath: '/usr/local/bin/node', enginesNode: '24', env: {} }

describe('enginesNodeMajor', () => {
  it.each([
    ['24', 24],
    ['24.22.1', 24],
    [' 24.x ', 24],
    ['>=24', null],
    ['^24', null],
    ['', null],
    [undefined, null]
  ])('%j -> %j', (engines, major) => {
    expect(enginesNodeMajor(engines)).toBe(major)
  })
})

describe('checkNodeMajor', () => {
  it('passes the pinned major', () => {
    expect(checkNodeMajor({ ...base, version: '24.22.1' })).toEqual({ ok: true })
  })

  it('refuses another major locally, naming the binary, its version and the pin', () => {
    const result = checkNodeMajor({ ...base, version: '26.7.0' })
    expect(result.ok).toBe(false)
    expect(result.message).toContain('/usr/local/bin/node')
    expect(result.message).toContain('26.7.0')
    expect(result.message).toContain('engines.node 24')
    expect(result.message).toContain('ORCA_ALLOW_NODE_MISMATCH=1')
    expect(result.message.split('\n')).toHaveLength(1)
  })

  it('runs another major with a warning when the override is set', () => {
    const result = checkNodeMajor({
      ...base,
      version: '26.7.0',
      env: { ORCA_ALLOW_NODE_MISMATCH: '1' }
    })
    expect(result.ok).toBe(true)
    expect(result.message).toContain('26.7.0')
  })

  it('leaves CI alone: its matrix picks the Node version on purpose (node-next-compat runs 24 and 26)', () => {
    expect(checkNodeMajor({ ...base, version: '26.7.0', env: { CI: 'true' } })).toEqual({
      ok: true
    })
  })

  it('checks nothing when engines.node is not a plain major', () => {
    expect(checkNodeMajor({ ...base, version: '26.7.0', enginesNode: '>=24' })).toEqual({
      ok: true
    })
  })
})
