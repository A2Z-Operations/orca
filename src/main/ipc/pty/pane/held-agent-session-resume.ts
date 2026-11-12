// A spawn that resumes an agent session another live PTY still runs would put two processes on one
// transcript. Refuse it before anything is stopped, so the running session keeps its terminal.

import { normalizeAgentProviderSession } from '../../../../shared/agent-session/lifecycle/agent-session-resume'

export const AGENT_SESSION_HELD_CODE = 'agent_session_held_by_live_terminal'

export type HeldAgentSessionSources = {
  /** Sessions agents report for their panes; a pane's row is cleared when its PTY exits. */
  providerSessionIdentities: () => readonly { paneKey: string; sessionId: string }[]
  ptyIdForPaneKey: (paneKey: string) => string | undefined
  /** Session ids recorded per PTY at launch, reattach or transcript inference; dropped when the PTY exits. */
  recordedPtySessions: () => readonly { ptyId: string; providerSessionId?: string }[]
  /** Only a host-proven exit counts: an unverifiable PTY may still be running the session. */
  isKnownExited: (ptyId: string) => boolean
}

/** The live PTY, other than `exceptPtyIds`, whose agent runs `sessionId`; null when none is known. */
export function findLivePtyHoldingSession(
  sessionId: string,
  exceptPtyIds: ReadonlySet<string>,
  sources: HeldAgentSessionSources
): string | null {
  const candidates: string[] = []
  for (const identity of sources.providerSessionIdentities()) {
    if (identity.sessionId !== sessionId) {
      continue
    }
    const ptyId = sources.ptyIdForPaneKey(identity.paneKey)
    if (ptyId) {
      candidates.push(ptyId)
    }
  }
  for (const record of sources.recordedPtySessions()) {
    if (record.providerSessionId === sessionId) {
      candidates.push(record.ptyId)
    }
  }
  return (
    candidates.find((ptyId) => !exceptPtyIds.has(ptyId) && !sources.isKnownExited(ptyId)) ?? null
  )
}

/** Throws when the spawn would resume a session a live PTY other than the one it replaces or reattaches holds. */
export function refuseResumeOfHeldAgentSession(
  args: {
    resumeProviderSession?: unknown
    replacesPtyId?: string
    /** A reattach names the PTY it attaches to; that PTY holding the session is the point. */
    sessionId?: string
  },
  sources: HeldAgentSessionSources
): void {
  const providerSession = normalizeAgentProviderSession(args.resumeProviderSession)
  if (!providerSession) {
    return
  }
  const own = new Set(
    [args.replacesPtyId, args.sessionId].filter((id): id is string => typeof id === 'string')
  )
  const holder = findLivePtyHoldingSession(providerSession.id, own, sources)
  if (holder) {
    throw Object.assign(
      new Error(
        `${AGENT_SESSION_HELD_CODE}: session ${providerSession.id} is still running in terminal ${holder}; show that terminal instead of resuming it again`
      ),
      { code: AGENT_SESSION_HELD_CODE, holderPtyId: holder }
    )
  }
}
