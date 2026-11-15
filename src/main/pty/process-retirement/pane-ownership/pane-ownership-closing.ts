import type { CloseReason } from './pane-ownership-report'

/** O4: a pane still alive this long after its close was observed is sampled again, and the unfinished close logged. */
export const CLOSE_UNFINISHED_MS = 30_000
/** The same when the observation never came (a kill that never settled). */
export const CLOSE_NEVER_OBSERVED_MS = 300_000

type Close = { reason: CloseReason; notedAtMs: number; observedAtMs: number | null }

/**
 * The panes being closed (#44 stage 2). A closing pane stays out of the sample until its root is gone, so a graceful
 * close (SIGTERM, then exit) is logged once, not again as an exit. A close that did not finish puts the pane back.
 */
export class PaneClosing {
  private readonly closes = new Map<string, Close>()
  private unfinished = 0

  constructor(private readonly log: (event: string, details: Record<string, unknown>) => void) {}

  note(sessionId: string, reason: CloseReason, nowMs: number): void {
    this.closes.set(sessionId, { reason, notedAtMs: nowMs, observedAtMs: null })
  }

  has(sessionId: string): boolean {
    return this.closes.has(sessionId)
  }

  delete(sessionId: string): void {
    this.closes.delete(sessionId)
  }

  /** The close's observation is done; the unfinished clock starts. */
  observed(sessionId: string, nowMs: number): void {
    const close = this.closes.get(sessionId)
    if (close) {
      close.observedAtMs = nowMs
    }
  }

  unfinishedCount(): number {
    return this.unfinished
  }

  /** Drops closes whose session is gone; puts back (and logs) a pane whose close did not finish. */
  settle(aliveIds: ReadonlySet<string>, nowMs: number): void {
    for (const [id, close] of this.closes) {
      if (!aliveIds.has(id)) {
        this.closes.delete(id)
        continue
      }
      const unfinished =
        close.observedAtMs !== null
          ? nowMs - close.observedAtMs >= CLOSE_UNFINISHED_MS
          : nowMs - close.notedAtMs >= CLOSE_NEVER_OBSERVED_MS
      if (unfinished) {
        this.closes.delete(id)
        this.unfinished += 1
        this.log('pane-ownership-close-unfinished', {
          sessionId: id,
          reason: close.reason,
          sinceCloseMs: nowMs - close.notedAtMs,
          observed: close.observedAtMs !== null
        })
      }
    }
  }

  clear(): void {
    this.closes.clear()
  }
}
