// A spawn that resumes an agent session another live PTY still runs would put two processes on one
// transcript. Refuse it before anything is stopped, so the running session keeps its terminal.

import { normalizeAgentProviderSession } from '../../../../shared/agent-session/lifecycle/agent-session-resume'
import {
  AGENT_SESSION_HELD_CODE,
  formatAgentSessionHeldRefusal,
  type RemotePaneKind
} from '../../../../shared/agent-session/lifecycle/held-agent-session-refusal'

export { AGENT_SESSION_HELD_CODE, type RemotePaneKind }

/**
 * `bare-shell`: the PTY's foreground was read and is a bare shell, so its rows are stale.
 * `not-shell`: something else runs there, or a local read failed (not proof of a shell).
 * `unconfirmed`: an SSH or WSL pane whose foreground this host could not read; it still holds.
 */
export type HolderForeground = 'bare-shell' | 'not-shell' | { unconfirmed: RemotePaneKind }

/** The PTY holding a session; `unconfirmed` names a remote pane whose agent could not be confirmed. */
export type AgentSessionHolder = { ptyId: string; unconfirmed?: RemotePaneKind }

export type HeldAgentSessionSources = {
  /** Sessions agents report for their panes; a pane's row is cleared when its PTY exits. */
  providerSessionIdentities: () => readonly { paneKey: string; sessionId: string }[]
  ptyIdForPaneKey: (paneKey: string) => string | undefined
  /** Session ids recorded per PTY at launch, reattach or transcript inference; dropped when the PTY exits. */
  recordedPtySessions: () => readonly { ptyId: string; providerSessionId?: string }[]
  /** Only a host-proven exit counts: an unverifiable PTY may still be running the session. */
  isKnownExited: (ptyId: string) => boolean
  /**
   * `bare-shell` only when the PTY's foreground is proven a bare shell: its agent exited and the
   * shell lived on, so the rows above are stale. An unreadable foreground is not that proof.
   */
  readForeground: (ptyId: string) => Promise<HolderForeground>
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
 * A holder read as running wins over a remote one that could not be read. Synchronous null when no
 * row names the session, so a plain spawn never waits on a process read.
 */
export function findLivePtyHoldingSession(
  sessionId: string,
  exceptPtyIds: ReadonlySet<string>,
  sources: HeldAgentSessionSources
): Promise<AgentSessionHolder | null> | null {
  const candidates = candidateHolders(sessionId, exceptPtyIds, sources)
  if (candidates.length === 0) {
    return null
  }
  return (async () => {
    let unconfirmed: AgentSessionHolder | null = null
    for (const ptyId of candidates) {
      const foreground = await sources
        .readForeground(ptyId)
        .catch((): HolderForeground => 'not-shell')
      // Why: a row outlives its agent; the shell it returned to does not hold the session.
      if (foreground === 'bare-shell') {
        continue
      }
      if (foreground === 'not-shell') {
        return { ptyId }
      }
      unconfirmed ??= { ptyId, unconfirmed: foreground.unconfirmed }
    }
    return unconfirmed
  })()
}

/** The live PTY that would make this spawn a second process on its resumed session; null when none. */
export function findHolderOfResumedSession(
  args: ResumeSpawnArgs,
  sources: HeldAgentSessionSources
): Promise<AgentSessionHolder | null> | null {
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
/** `--fork-session` (Orca's own fork launch, `claude --resume <id> --fork-session`) starts a new session id. */
const CLAUDE_FORK_SESSION = /(?:^|\s)--fork-session(?:=true)?(?=\s|$)/i
const COMMAND_RESUME_PATTERNS: readonly { pattern: RegExp; forks?: RegExp }[] = [
  {
    pattern: new RegExp(
      `(?:^|[\\s/;&|(])claude(?:\\.exe)?\\s(?:[^\\n;&|]*?\\s)?(?:--resume|-r)(?:=|\\s+)['"]?${SESSION_UUID}`,
      'gi'
    ),
    forks: CLAUDE_FORK_SESSION
  },
  // `codex fork <id>` is its own subcommand and starts a new session; it never matches `resume`.
  {
    pattern: new RegExp(
      `(?:^|[\\s/;&|(])codex(?:\\.exe)?\\s(?:[^\\n;&|]*?\\s)?resume\\s+['"]?${SESSION_UUID}`,
      'gi'
    )
  }
]

/** The one command (up to the next `;`, `&`, `|` or newline) a match starts in. */
function commandSegmentAt(command: string, index: number): string {
  return command.slice(index).split(/[\n;&|]/, 1)[0] ?? ''
}

/**
 * The session a plain `claude --resume <id>` / `codex resume <id>` command line resumes; null otherwise.
 * A forked resume (`--fork-session`) writes a new session, so it holds nothing another PTY runs.
 */
export function resumedSessionIdOfCommand(command: unknown): string | null {
  if (typeof command !== 'string') {
    return null
  }
  for (const { pattern, forks } of COMMAND_RESUME_PATTERNS) {
    for (const match of command.matchAll(pattern)) {
      // The leading separator belongs to the previous command; the segment starts after it.
      const segment = commandSegmentAt(command, match.index + (/^[;&|]/.test(match[0]) ? 1 : 0))
      if (forks?.test(segment)) {
        continue
      }
      return match[1].toLowerCase()
    }
  }
  return null
}

/** The refusal line for `holder`, naming its tab and, for an unreadable remote pane, that it cannot be confirmed. */
export function agentSessionHeldRefusal(
  holder: AgentSessionHolder,
  sources: Pick<HeldAgentSessionSources, 'holderTitle'>
): string {
  return formatAgentSessionHeldRefusal(
    holder.ptyId,
    sources.holderTitle(holder.ptyId),
    holder.unconfirmed
  )
}

export function agentSessionHeldError(
  holder: AgentSessionHolder,
  sources: Pick<HeldAgentSessionSources, 'holderTitle'>
): Error {
  return Object.assign(new Error(agentSessionHeldRefusal(holder, sources)), {
    code: AGENT_SESSION_HELD_CODE,
    holderPtyId: holder.ptyId,
    ...(holder.unconfirmed ? { unconfirmedRemotePane: holder.unconfirmed } : {})
  })
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
  return holder.then((found) => {
    if (found) {
      throw agentSessionHeldError(found, sources)
    }
  })
}
