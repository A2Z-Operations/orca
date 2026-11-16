import type { OwnedEntry, PaneOwnershipSets } from './pane-ownership-sets'

/**
 * #44 stage 3 piece (a), OBSERVE ONLY: restart carry-over. A restart (account move, pane restart, resume into a new
 * terminal) stops the old pane BEFORE main spawns its replacement, so at the old pane's close the daemon cannot know the
 * new session. The old pane's still-present entries are therefore HELD for CARRY_HOLD_MS; the replacement's spawn
 * names the old session (`carriesFrom`, main's own `replacesPtyId`), and the new pane adopts them, marked
 * `carried: { from, generation }`. The claim may arrive before or after the hold. Nothing here can signal (S1): adopted
 * entries only appear, labelled, in the new pane's close lines.
 *
 * A claim that never meets a hold within CARRY_HOLD_MS logs `pane-ownership-carry-claim-unmatched` (#70 S2).
 * Bounds: a set is held at most CARRY_HOLD_MS and is claimed at most once (first claim wins); at most CARRY_MAX_ENTRIES
 * entries are carried; an entry already carried CARRY_MAX_GENERATIONS times is dropped (a pane that rotates all day
 * cannot grow). Held sets are memory only and end with the daemon, like every set.
 */
export const CARRY_HOLD_MS = 60_000
export const CARRY_MAX_GENERATIONS = 8
export const CARRY_MAX_ENTRIES = 256

export type Carried = { from: string; generation: number }

type Held = { entries: OwnedEntry[]; atMs: number }

export class PaneCarry {
  private readonly held = new Map<string, Held>()
  /** from → { to, atMs }: a claim that came before its hold. */
  private readonly early = new Map<string, { to: string; atMs: number }>()
  /** to → what it adopts once its pane is sampled. */
  private readonly pending = new Map<string, { from: string; held: Held }>()
  /** from → to, for the claim window: the first claim wins. */
  private readonly claimedBy = new Map<string, { to: string; atMs: number }>()

  constructor(private readonly log: (event: string, details: Record<string, unknown>) => void) {}

  /** At a restart's close: hold the entries still present. */
  hold(from: string, entries: OwnedEntry[], nowMs: number): void {
    const held = { entries, atMs: nowMs }
    const early = this.early.get(from)
    if (early) {
      this.early.delete(from)
      this.pending.set(early.to, { from, held })
      return
    }
    this.held.set(from, held)
  }

  /** The replacement `to` names the session it replaces. */
  claim(to: string, from: string, nowMs: number): void {
    const prior = this.claimedBy.get(from)
    if (prior) {
      this.log('pane-ownership-carry-already-claimed', { from, to, claimedBy: prior.to })
      return
    }
    this.claimedBy.set(from, { to, atMs: nowMs })
    const held = this.held.get(from)
    if (held) {
      this.held.delete(from)
      this.pending.set(to, { from, held })
      return
    }
    this.early.set(from, { to, atMs: nowMs })
  }

  /** Each tick, after sampling: a pending carry joins its new pane's set once that set exists. */
  adopt(sets: PaneOwnershipSets): void {
    for (const [to, { from, held }] of this.pending) {
      const set = sets.get(to)
      if (!set) {
        continue
      }
      this.pending.delete(to)
      let droppedGenerations = 0
      let droppedOverCap = 0
      let carried = 0
      for (const entry of held.entries) {
        const generation = (entry.carried?.generation ?? 0) + 1
        if (generation > CARRY_MAX_GENERATIONS) {
          droppedGenerations += 1
          continue
        }
        if (carried >= CARRY_MAX_ENTRIES) {
          droppedOverCap += 1
          continue
        }
        if (!set.entries.has(entry.pid)) {
          set.entries.set(entry.pid, {
            ...entry,
            missingCompleteReads: 0,
            carried: { from, generation }
          })
          carried += 1
        }
      }
      this.log('pane-ownership-carry', {
        from,
        to,
        entries: carried,
        droppedGenerations,
        droppedOverCap
      })
    }
  }

  /** Drops what waited too long: an unclaimed hold is logged (what a restart left behind and nobody adopted). */
  expire(nowMs: number): void {
    for (const [from, held] of this.held) {
      if (nowMs - held.atMs > CARRY_HOLD_MS) {
        this.held.delete(from)
        this.log('pane-ownership-carry-unclaimed', { from, entries: held.entries.length })
      }
    }
    for (const [to, pending] of this.pending) {
      if (nowMs - pending.held.atMs > CARRY_HOLD_MS) {
        this.pending.delete(to)
        this.log('pane-ownership-carry-unadopted', {
          from: pending.from,
          to,
          entries: pending.held.entries.length
        })
      }
    }
    for (const [from, claim] of this.early) {
      if (nowMs - claim.atMs > CARRY_HOLD_MS) {
        // #70 S2: a replacement that named a session no restart close ever held (its old pane was closed, not
        // restarted, or the stop never reached the observer): one trace, instead of expiring silently.
        this.early.delete(from)
        this.log('pane-ownership-carry-claim-unmatched', { from, to: claim.to })
      }
    }
    for (const [from, claim] of this.claimedBy) {
      if (nowMs - claim.atMs > CARRY_HOLD_MS) {
        this.claimedBy.delete(from)
      }
    }
  }

  clear(): void {
    this.held.clear()
    this.early.clear()
    this.pending.clear()
    this.claimedBy.clear()
  }
}
