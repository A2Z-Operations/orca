// A parked restart's hand-back is one attempt. A later queue replaces it, so that switch still runs.
const armedAttemptByPty = new Map<string, number>()
const handoffAttemptByPty = new Map<string, number>()
const queuedAttemptByPty = new Map<string, number>()
let nextAttempt = 1

/** The next `recordQueuedPaneAccountRestart` for this pty is the parked spawn's own re-queue. */
export function noteUnsentRestartHandoff(ptyId: string): void {
  armedAttemptByPty.set(ptyId, nextAttempt++)
}

/** One queue of an account restart. Adopts an armed hand-back; any other queue clears it. */
export function recordQueuedPaneAccountRestart(ptyId: string): void {
  const armed = armedAttemptByPty.get(ptyId)
  if (armed !== undefined) {
    armedAttemptByPty.delete(ptyId)
    queuedAttemptByPty.set(ptyId, armed)
    handoffAttemptByPty.set(ptyId, armed)
    return
  }
  queuedAttemptByPty.set(ptyId, nextAttempt++)
  handoffAttemptByPty.delete(ptyId)
}

/** One-shot. True only when this pty's latest queue is still the parked re-queue. */
export function takeUnsentRestartHandoff(ptyId: string): boolean {
  const marked = handoffAttemptByPty.get(ptyId)
  if (marked === undefined) {
    return false
  }
  handoffAttemptByPty.delete(ptyId)
  return marked === queuedAttemptByPty.get(ptyId)
}

export function clearUnsentRestartHandoff(ptyId: string): void {
  armedAttemptByPty.delete(ptyId)
  handoffAttemptByPty.delete(ptyId)
  queuedAttemptByPty.delete(ptyId)
}
