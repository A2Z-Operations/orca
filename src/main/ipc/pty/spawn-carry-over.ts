/**
 * #44 (a), observe only: a replacement spawn (account move, pane restart, resume into a new terminal) names the PTY it
 * replaces, so the daemon's pane-ownership observer can carry the old pane's still-running processes into the new one
 * and log them at its close. Both spawn routes (runtime and window) map their `replacesPtyId` through here.
 */
export function carryOverFor(replacesPtyId: unknown): { carriesFrom?: string } {
  return typeof replacesPtyId === 'string' && replacesPtyId.length > 0
    ? { carriesFrom: replacesPtyId }
    : {}
}
