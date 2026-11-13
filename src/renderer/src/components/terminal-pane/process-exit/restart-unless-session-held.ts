import type { AgentProviderSessionMetadata } from '../../../../../shared/agent-session/lifecycle/agent-session-resume'

type SessionHolderLookup = (args: {
  resumeProviderSession: AgentProviderSessionMetadata
  replacesPtyId: string
}) => Promise<{ holderPtyId: string; refusal: string } | null>

/** Refuse known duplicate resumes before detaching the live transport; main repeats the check at spawn. */
export function restartUnlessSessionHeld(args: {
  /** The PTY the restart replaces; without one there is nothing to strand, and main's own refusal suffices. */
  replacesPtyId: string | null | undefined
  resumeProviderSession: AgentProviderSessionMetadata | undefined
  findHolder: SessionHolderLookup | undefined
  /** False when the pane closed, restarted or changed PTY while main answered. */
  isStillCurrent: () => boolean
  restart: () => void
  refuse: (refusal: string) => void
}): void {
  const { replacesPtyId, resumeProviderSession, findHolder } = args
  if (!replacesPtyId || !resumeProviderSession || !findHolder) {
    args.restart()
    return
  }
  void findHolder({ resumeProviderSession, replacesPtyId })
    // Why proceed on a failed lookup: main's spawn guard still refuses a held session.
    .catch(() => null)
    .then((held) => {
      if (!args.isStillCurrent()) {
        return
      }
      if (held) {
        args.refuse(held.refusal)
        return
      }
      args.restart()
    })
}
