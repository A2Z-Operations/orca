// A spawn that resumes an agent session another live PTY still runs would put two processes on one
// transcript. Refuse it before anything is stopped, so the running session keeps its terminal.

import { normalizeAgentProviderSession } from '../../../../shared/agent-session/lifecycle/agent-session-resume'
import {
  AGENT_SESSION_HELD_CODE,
  formatAgentSessionHeldRefusal
} from '../../../../shared/agent-session/lifecycle/held-agent-session-refusal'

export { AGENT_SESSION_HELD_CODE }

export type HeldAgentSessionSources = {
  /** Sessions agents report for their panes; a pane's row is cleared when its PTY exits. */
  providerSessionIdentities: () => readonly { paneKey: string; sessionId: string }[]
  ptyIdForPaneKey: (paneKey: string) => string | undefined
  /** Session ids recorded per PTY at launch, reattach or transcript inference; dropped when the PTY exits. */
  recordedPtySessions: () => readonly { ptyId: string; providerSessionId?: string }[]
  /** Only a host-proven exit counts: an unverifiable PTY may still be running the session. */
  isKnownExited: (ptyId: string) => boolean
  /**
   * True only when the PTY's foreground is proven to be a bare shell: its agent exited and the shell
   * lived on, so the rows above are stale. An unreadable foreground is not that proof.
   */
  showsBareShell: (ptyId: string) => Promise<boolean>
  /** The saved tab title of the PTY, for the refusal; null when no tab holds it. */
  holderTitle: (ptyId: string) => string | null
}

type ResumeSpawnArgs = {
  resumeProviderSession?: unknown
  /** A hand-written resume (`orca terminal create --command 'claude --resume <id>'`) names no structured session. */
  command?: unknown
  replacesPtyId?: string
  /** A reattach names the PTY it attaches to; that PTY holding the session is the point. */
  sessionId?: string
}

/** PTYs whose rows name `sessionId`, other than `exceptPtyIds` and host-proven exits. */
function candidateHolders(
  sessionId: string,
  exceptPtyIds: ReadonlySet<string>,
  sources: HeldAgentSessionSources
): string[] {
  const candidates = new Set<string>()
  for (const identity of sources.providerSessionIdentities()) {
    if (identity.sessionId !== sessionId) {
      continue
    }
    const ptyId = sources.ptyIdForPaneKey(identity.paneKey)
    if (ptyId) {
      candidates.add(ptyId)
    }
  }
  for (const record of sources.recordedPtySessions()) {
    if (record.providerSessionId === sessionId) {
      candidates.add(record.ptyId)
    }
  }
  return [...candidates].filter(
    (ptyId) => !exceptPtyIds.has(ptyId) && !sources.isKnownExited(ptyId)
  )
}

/**
 * The live PTY, other than `exceptPtyIds`, whose agent still runs `sessionId`; null when none is known.
 * Synchronous null when no row names the session, so a plain spawn never waits on a process read.
 */
export function findLivePtyHoldingSession(
  sessionId: string,
  exceptPtyIds: ReadonlySet<string>,
  sources: HeldAgentSessionSources
): Promise<string | null> | null {
  const candidates = candidateHolders(sessionId, exceptPtyIds, sources)
  if (candidates.length === 0) {
    return null
  }
  return (async () => {
    for (const ptyId of candidates) {
      // Why: a row outlives its agent; the shell it returned to does not hold the session.
      if (!(await sources.showsBareShell(ptyId).catch(() => false))) {
        return ptyId
      }
    }
    return null
  })()
}

/** The live PTY that would make this spawn a second process on its resumed session; null when none. */
export function findHolderOfResumedSession(
  args: ResumeSpawnArgs,
  sources: HeldAgentSessionSources
): Promise<string | null> | null {
  const sessionId =
    normalizeAgentProviderSession(args.resumeProviderSession)?.id ??
    resumedSessionIdOfCommand(args.command)
  if (!sessionId) {
    return null
  }
  const own = new Set(
    [args.replacesPtyId, args.sessionId].filter((id): id is string => typeof id === 'string')
  )
  return findLivePtyHoldingSession(sessionId, own, sources)
}

const SESSION_UUID = '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})'
const COMMAND_RESUME_PATTERNS = [
  new RegExp(
    `(?:^|[\\s/;&|(])claude(?:\\.exe)?\\s(?:[^\\n;&|]*?\\s)?(?:--resume|-r)(?:=|\\s+)['"]?${SESSION_UUID}`,
    'i'
  ),
  new RegExp(
    `(?:^|[\\s/;&|(])codex(?:\\.exe)?\\s(?:[^\\n;&|]*?\\s)?resume\\s+['"]?${SESSION_UUID}`,
    'i'
  )
]

/** The session a plain `claude --resume <id>` / `codex resume <id>` command line resumes; null otherwise. */
export function resumedSessionIdOfCommand(command: unknown): string | null {
  if (typeof command !== 'string') {
    return null
  }
  for (const pattern of COMMAND_RESUME_PATTERNS) {
    const match = pattern.exec(command)
    if (match) {
      return match[1].toLowerCase()
    }
  }
  return null
}

export function agentSessionHeldError(
  holderPtyId: string,
  sources: Pick<HeldAgentSessionSources, 'holderTitle'>
): Error {
  return Object.assign(
    new Error(formatAgentSessionHeldRefusal(holderPtyId, sources.holderTitle(holderPtyId))),
    { code: AGENT_SESSION_HELD_CODE, holderPtyId }
  )
}

/**
 * Rejects when the spawn would resume a session a live PTY other than the one it replaces or
 * reattaches holds. Undefined, not a promise, when nothing can hold it, so most spawns do not yield.
 */
export function refuseResumeOfHeldAgentSession(
  args: ResumeSpawnArgs,
  sources: HeldAgentSessionSources
): Promise<void> | undefined {
  const holder = findHolderOfResumedSession(args, sources)
  if (!holder) {
    return undefined
  }
  return holder.then((holderPtyId) => {
    if (holderPtyId) {
      throw agentSessionHeldError(holderPtyId, sources)
    }
  })
}
