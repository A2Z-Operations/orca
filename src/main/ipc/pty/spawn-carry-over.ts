import type { ReplacedPaneOwner } from './pane/replaced-pane-owner'

/**
 * #44 (a), observe only: a replacement spawn (account move, pane restart, resume into a new terminal) names the PTY it
 * replaces, so the daemon's pane-ownership observer can carry the old pane's still-running processes into the new one
 * and log them at its close. #70 S3: only a replacement main PROVED (see ReplacedPaneOwner.proven) is named; an
 * unproven one carries nothing. Both spawn routes (runtime and window) map their replaced owner through here.
 */
export function carryOverFor(replaced: ReplacedPaneOwner | null | undefined): {
  carriesFrom?: string
} {
  return replaced?.proven ? { carriesFrom: replaced.ptyId } : {}
}
