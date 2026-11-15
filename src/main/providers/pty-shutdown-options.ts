/** Options of a daemon PTY shutdown, with #44's optional close reason ('restart' = the pane is being replaced). */
export type PtyShutdownOptions = {
  immediate?: boolean
  keepHistory?: boolean
  deadlineMs?: number
  reason?: 'close' | 'restart'
}

/** The kill payload carries a reason only for a restart; an absent reason is a close (and what older peers send). */
export function restartReason(opts: { reason?: 'close' | 'restart' }): { reason?: 'restart' } {
  return opts.reason === 'restart' ? { reason: 'restart' } : {}
}
