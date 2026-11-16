import type { Session } from '../sessions/session'
import type {
  PaneCloseReason,
  PaneOwnershipHooks,
  TerminalHostKillOptions
} from './terminal-host-options'

/**
 * The terminal host's side of #44 stage 2 (observe only). Every call is guarded: observation never changes a close or
 * an exit, and the kill path never waits for it.
 */

/** Agent panes whose root is alive, for the ownership sampler. */
export function listAgentRoots(
  sessions: ReadonlyMap<string, Session>
): { sessionId: string; rootPid: number }[] {
  const roots: { sessionId: string; rootPid: number }[] = []
  for (const [sessionId, session] of sessions) {
    if (session.launchAgent && session.isAlive && session.pid > 0) {
      roots.push({ sessionId, rootPid: session.pid })
    }
  }
  return roots
}

/** Before the kill starts: the sampler stops sampling this pane. Then, once the kill promise settled (today's sweep has
 * run), the pane's set is logged. The returned promise is the kill's own, unchanged. */
export function observedKill(
  hooks: PaneOwnershipHooks | undefined,
  session: Session,
  sessionId: string,
  opts: TerminalHostKillOptions,
  startKill: () => void | Promise<void>
): Promise<void> {
  if (!hooks || !session.launchAgent) {
    return Promise.resolve(startKill())
  }
  const reason: PaneCloseReason = opts.reason ?? 'close'
  guarded(() => hooks.noteClose(sessionId, reason))
  const killed = Promise.resolve(startKill())
  const observe = (): void =>
    guarded(() => void hooks.observeClose(sessionId, reason).catch(() => {}))
  void killed.then(observe, observe)
  return killed
}

/** #44 (a): a created agent pane that replaces another one tells the observer which (it carries the old set). */
export function reportCarry(
  hooks: PaneOwnershipHooks | undefined,
  opts: { sessionId: string; carriesFrom?: string; launchAgent?: unknown; attachOnly?: boolean }
): void {
  if (hooks?.noteCarry && opts.carriesFrom && opts.launchAgent && !opts.attachOnly) {
    const { noteCarry } = hooks
    const from = opts.carriesFrom
    guarded(() => noteCarry.call(hooks, opts.sessionId, from))
  }
}

export function reportAgentRootExit(
  hooks: PaneOwnershipHooks | undefined,
  session: Session | undefined,
  sessionId: string
): void {
  if (hooks && session?.launchAgent) {
    guarded(() => hooks.onRootExit(sessionId))
  }
}

function guarded(run: () => void): void {
  try {
    run()
  } catch {
    // observation never changes a close or an exit
  }
}
