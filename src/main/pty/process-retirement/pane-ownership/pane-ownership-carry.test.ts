import { describe, expect, it } from 'vitest'
import { CARRY_HOLD_MS, CARRY_MAX_ENTRIES, CARRY_MAX_GENERATIONS } from './pane-ownership-carry'
import { PaneOwnershipObserver, type PaneOwnershipObserverDeps } from './pane-ownership-observer'
import type { OwnershipRow } from './pane-ownership-table'
import type { FdInfo } from './pane-ownership-fds'

// #44 stage 3 piece (a), OBSERVE ONLY: a restart (account move, pane restart, resume) used to log the old pane's set and
// drop it. Now the set is HELD for CARRY_HOLD_MS; the replacement's spawn names the old session (carriesFrom) and the
// new pane adopts what is still alive, marked carried {from, generation}, so its later close shows what the old agent
// left behind. No signal path: only log lines change.

const HOST = 900
const UID = 501
const OLD = 'Sat Nov 15 07:00:00 2026'
const T0 = Date.UTC(2026, 10, 15, 8, 0, 0)

function row(pid: number, ppid: number): OwnershipRow {
  return { pid, ppid, pgid: pid, uid: UID, startedAt: OLD, comm: `p${pid}` }
}

/** Panes and the process table are mutable: the test moves them like a restart does. */
function harness() {
  const logs: { event: string; details: Record<string, unknown> }[] = []
  const state: {
    now: number
    roots: { sessionId: string; rootPid: number }[]
    rows: OwnershipRow[]
    off: boolean
  } = { now: T0, roots: [{ sessionId: 's1', rootPid: 10 }], rows: [], off: false }
  const deps: PaneOwnershipObserverDeps = {
    listAgentRoots: () => state.roots,
    readTable: async () => ({ rows: [row(HOST, 1), ...state.rows], capturedAtMs: state.now }),
    readFds: async () => new Map<number, FdInfo[]>(),
    readStartTicks: null,
    listDurableJobs: async () => [],
    readMode: async () =>
      state.off ? { mode: 'off', requested: null } : { mode: 'observe', requested: null },
    log: (event, details) => logs.push({ event, details }),
    hostUid: UID,
    hostPid: HOST,
    now: () => state.now
  }
  const obs = new PaneOwnershipObserver(deps)
  const events = (event: string) => logs.filter((l) => l.event === event).map((l) => l.details)
  return { obs, logs, state, events }
}

/** s1 (root 10) with a tool shell 20; restart: 10 dies, 20 is reparented; s2 (root 30) starts. */
async function restartWith20(h: ReturnType<typeof harness>, claimFirst = false) {
  h.state.rows = [row(10, 5), row(20, 10)]
  await h.obs.tick()
  h.obs.noteClose('s1', 'restart')
  if (claimFirst) {
    h.obs.noteCarry('s2', 's1')
  }
  h.state.rows = [row(20, 1)]
  h.state.roots = []
  await h.obs.observeClose('s1', 'restart')
  if (!claimFirst) {
    h.obs.noteCarry('s2', 's1')
  }
  h.state.roots = [{ sessionId: 's2', rootPid: 30 }]
  h.state.rows = [row(20, 1), row(30, 5)]
  h.state.now += 1_000
  await h.obs.tick()
}

describe('restart carry-over (observe only)', () => {
  it('the replacement adopts what is still alive; its close logs it carried from the old session', async () => {
    const h = harness()
    await restartWith20(h)
    expect(h.events('pane-ownership-carry')).toEqual([
      expect.objectContaining({ from: 's1', to: 's2', entries: 1, droppedGenerations: 0 })
    ])
    h.state.now += 1_000
    await h.obs.observeClose('s2', 'close')
    const entries = h.events('pane-ownership-entry')
    expect(entries.at(-1)).toMatchObject({
      sessionId: 's2',
      reason: 'close',
      pid: 20,
      carried: { from: 's1', generation: 1 }
    })
  })

  it('works whichever comes first: the claim (spawn) or the hold (the old close logged after its kill)', async () => {
    const h = harness()
    await restartWith20(h, true)
    expect(h.events('pane-ownership-carry')).toHaveLength(1)
  })

  it('an unclaimed set is dropped after CARRY_HOLD_MS with one line (today’s behaviour, now visible)', async () => {
    const h = harness()
    h.state.rows = [row(10, 5), row(20, 10)]
    await h.obs.tick()
    h.state.rows = [row(20, 1)]
    h.state.roots = []
    await h.obs.observeClose('s1', 'restart')
    h.state.now += CARRY_HOLD_MS + 1
    await h.obs.tick()
    expect(h.events('pane-ownership-carry-unclaimed')).toEqual([
      expect.objectContaining({ from: 's1', entries: 1 })
    ])
    h.obs.noteCarry('s2', 's1') // too late: nothing is held any more
    h.state.roots = [{ sessionId: 's2', rootPid: 30 }]
    h.state.rows = [row(20, 1), row(30, 5)]
    await h.obs.tick()
    expect(h.events('pane-ownership-carry')).toEqual([])
  })

  it('only a RESTART is held: a claim naming a closed pane carries nothing', async () => {
    const h = harness()
    h.state.rows = [row(10, 5), row(20, 10)]
    await h.obs.tick()
    h.state.rows = [row(20, 1)]
    h.state.roots = []
    await h.obs.observeClose('s1', 'close')
    h.obs.noteCarry('s2', 's1')
    h.state.roots = [{ sessionId: 's2', rootPid: 30 }]
    h.state.rows = [row(20, 1), row(30, 5)]
    await h.obs.tick()
    h.state.now += CARRY_HOLD_MS + 1
    await h.obs.tick()
    expect(h.events('pane-ownership-carry')).toEqual([])
    expect(h.events('pane-ownership-carry-unclaimed')).toEqual([])
  })

  it('the first claim wins; a second one is logged and gets nothing', async () => {
    const h = harness()
    await restartWith20(h)
    h.obs.noteCarry('s3', 's1')
    expect(h.events('pane-ownership-carry-already-claimed')).toEqual([
      expect.objectContaining({ from: 's1', to: 's3', claimedBy: 's2' })
    ])
  })

  it('a process that died before the restart is not carried', async () => {
    const h = harness()
    h.state.rows = [row(10, 5), row(20, 10), row(21, 10)]
    await h.obs.tick()
    h.state.rows = [row(20, 1)] // 21 is gone
    h.state.roots = []
    await h.obs.observeClose('s1', 'restart')
    h.obs.noteCarry('s2', 's1')
    h.state.roots = [{ sessionId: 's2', rootPid: 30 }]
    h.state.rows = [row(20, 1), row(30, 5)]
    await h.obs.tick()
    expect(h.events('pane-ownership-carry')[0]).toMatchObject({ entries: 1 })
  })

  it(`a chain of restarts stops carrying after ${CARRY_MAX_GENERATIONS} generations`, async () => {
    const h = harness()
    h.state.rows = [row(10, 5), row(20, 10)]
    await h.obs.tick()
    let from = 's1'
    for (let n = 1; n <= CARRY_MAX_GENERATIONS + 1; n += 1) {
      const to = `s${n + 1}`
      h.obs.noteClose(from, 'restart')
      h.state.roots = []
      h.state.rows = [row(20, 1)]
      await h.obs.observeClose(from, 'restart')
      h.obs.noteCarry(to, from)
      h.state.roots = [{ sessionId: to, rootPid: 100 + n }]
      h.state.rows = [row(20, 1), row(100 + n, 5)]
      h.state.now += 1_000
      await h.obs.tick()
      from = to
    }
    const carries = h.events('pane-ownership-carry')
    expect(carries).toHaveLength(CARRY_MAX_GENERATIONS + 1)
    expect(carries.slice(0, CARRY_MAX_GENERATIONS).every((c) => c.entries === 1)).toBe(true)
    expect(carries.at(-1)).toMatchObject({ entries: 0, droppedGenerations: 1 })
  })

  it(`at most ${CARRY_MAX_ENTRIES} entries are carried; the rest are counted`, async () => {
    const h = harness()
    const kids = Array.from({ length: CARRY_MAX_ENTRIES + 3 }, (_, i) => 1_000 + i)
    h.state.rows = [row(10, 5), ...kids.map((pid) => row(pid, 10))]
    await h.obs.tick()
    h.state.rows = kids.map((pid) => row(pid, 1))
    h.state.roots = []
    await h.obs.observeClose('s1', 'restart')
    h.obs.noteCarry('s2', 's1')
    h.state.roots = [{ sessionId: 's2', rootPid: 30 }]
    h.state.rows = [...kids.map((pid) => row(pid, 1)), row(30, 5)]
    await h.obs.tick()
    expect(h.events('pane-ownership-carry')[0]).toMatchObject({
      entries: CARRY_MAX_ENTRIES,
      droppedOverCap: 3
    })
  })

  it('mode off drops what is held', async () => {
    const h = harness()
    h.state.rows = [row(10, 5), row(20, 10)]
    await h.obs.tick()
    h.state.rows = [row(20, 1)]
    h.state.roots = []
    await h.obs.observeClose('s1', 'restart')
    h.state.off = true
    await h.obs.tick()
    h.state.off = false
    h.obs.noteCarry('s2', 's1')
    h.state.roots = [{ sessionId: 's2', rootPid: 30 }]
    h.state.rows = [row(20, 1), row(30, 5)]
    await h.obs.tick()
    expect(h.events('pane-ownership-carry')).toEqual([])
  })
})
