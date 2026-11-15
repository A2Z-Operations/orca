import { describe, expect, it } from 'vitest'
import { PaneOwnershipSets } from './pane-ownership-sets'
import type { OwnershipRow } from './pane-ownership-table'

const HOST = 900
const UID = 501
const T0 = 'Sat Nov 15 08:00:00 2026'
const T1 = 'Sat Nov 15 08:00:05 2026'

function row(pid: number, ppid: number, extra: Partial<OwnershipRow> = {}): OwnershipRow {
  return { pid, ppid, pgid: pid, uid: UID, startedAt: T0, comm: `p${pid}`, ...extra }
}
const host = row(HOST, 1)
const capture = (rows: OwnershipRow[], capturedAtMs = 1_000) => ({
  rows: [host, ...rows],
  capturedAtMs
})
const sets = (extra: { cap?: number; absentReadsToForget?: number } = {}) =>
  new PaneOwnershipSets({ hostUid: UID, hostPid: HOST, ...extra })
const live = [{ sessionId: 's1', rootPid: 10 }]

describe('pane ownership sets (#44 stage 2)', () => {
  it('records the descendants of a live agent root, never the root, the host or pid 1', () => {
    const s = sets()
    const result = s.sample(capture([row(10, 5), row(20, 10), row(21, 20), row(1, 0)]), live)
    expect([...s.get('s1')!.entries.keys()].sort()).toEqual([20, 21])
    expect(result.newlyRecorded.map((r) => r.pid).sort()).toEqual([20, 21])
    expect(result.complete).toBe(true)
  })

  it('keeps a setsid shell after its parent link breaks (the #5 shape)', () => {
    const s = sets()
    s.sample(capture([row(10, 5), row(20, 10, { pgid: 20 })]), live)
    s.sample(capture([row(10, 5), row(20, 1, { pgid: 20 })]), live)
    expect(s.get('s1')!.entries.has(20)).toBe(true)
  })

  it('M3: records a child born to a re-parented entry after it left the tree', () => {
    const s = sets()
    s.sample(capture([row(10, 5), row(20, 10)]), live)
    s.sample(capture([row(10, 5), row(20, 1), row(30, 20)]), live)
    const entry = s.get('s1')!.entries.get(30)
    expect(entry?.how).toBe('under-recorded')
  })

  it('L10: records only processes of the host uid', () => {
    const s = sets()
    s.sample(capture([row(10, 5), row(20, 10, { uid: 0 }), row(21, 10)]), live)
    expect([...s.get('s1')!.entries.keys()]).toEqual([21])
  })

  it('M4: an entry absent from 25 COMPLETE reads is forgotten; incomplete reads never remove it', () => {
    const s = sets()
    s.sample(capture([row(10, 5), row(20, 10)]), live)
    for (let i = 0; i < 30; i += 1) {
      // incomplete: the host's own row is missing
      s.sample({ rows: [row(10, 5)], capturedAtMs: 2_000 + i }, live)
    }
    expect(s.get('s1')!.entries.has(20)).toBe(true)
    for (let i = 0; i < 24; i += 1) {
      s.sample(capture([row(10, 5)]), live)
    }
    expect(s.get('s1')!.entries.has(20)).toBe(true)
    s.sample(capture([row(10, 5)]), live)
    expect(s.get('s1')!.entries.has(20)).toBe(false)
  })

  it('a recorded pid seen again with another start time is the old process gone (pid reuse)', () => {
    const s = sets()
    s.sample(capture([row(10, 5), row(20, 10)]), live)
    s.sample(capture([row(10, 5), row(20, 1, { startedAt: T1 })]), live)
    expect(s.get('s1')!.entries.has(20)).toBe(false)
  })

  it('M7: a recycled root stops sampling and KEEPS the set', () => {
    const s = sets()
    s.sample(capture([row(10, 5), row(20, 10)]), live)
    s.sample(capture([row(10, 7, { startedAt: T1 }), row(20, 1), row(40, 10)]), live)
    const set = s.get('s1')!
    expect(set.rootRecycled).toBe(true)
    expect(set.entries.has(20)).toBe(true)
    expect(set.entries.has(40)).toBe(false)
  })

  it('a missing or duplicated root row adds nothing and clears nothing', () => {
    const s = sets()
    s.sample(capture([row(10, 5), row(20, 10)]), live)
    s.sample({ rows: [host, row(30, 10)], capturedAtMs: 3_000 }, live)
    s.sample(capture([row(10, 5), row(10, 6), row(31, 10)]), live)
    expect([...s.get('s1')!.entries.keys()]).toEqual([20])
  })

  it('M4 cap: an entry absent from the latest complete read is dropped before any present one', () => {
    const s = sets({ cap: 2 })
    s.sample(capture([row(10, 5), row(20, 10), row(21, 10)]), live)
    s.sample(capture([row(10, 5), row(21, 10)]), live) // 20 now absent from a complete read
    s.sample(capture([row(10, 5), row(21, 10), row(22, 10)]), live)
    const set = s.get('s1')!
    expect([...set.entries.keys()].sort()).toEqual([21, 22])
    expect(set.dropped).toBe(1)
  })

  it('a kept mark is inherited by the children walked from a kept entry', () => {
    const s = sets()
    s.sample(capture([row(10, 5), row(20, 10)]), live)
    s.get('s1')!.entries.get(20)!.kept = 'durable-job'
    s.sample(capture([row(10, 5), row(20, 1), row(30, 20)]), live)
    expect(s.get('s1')!.entries.get(30)?.kept).toBe('durable-job')
  })
})
