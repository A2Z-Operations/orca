// Why one format: main writes the refusal, scripts match its code, and the renderer swaps the
// sentence for localized copy naming the holder's tab, which it reads from the line itself.

export const AGENT_SESSION_HELD_CODE = 'agent_session_held_by_live_terminal'

const HOLDER_PATTERN = new RegExp(`${AGENT_SESSION_HELD_CODE}:.*?\\(pty ([^);\\s]+)[);]`)
const HOLDER_TITLE_PATTERN = /terminal "([^"\r\n]*)" \(pty /

/** An SSH or WSL pane: its foreground is read on another host, or inside a distro. */
export type RemotePaneKind = 'ssh' | 'wsl'

const REMOTE_PANE_LABEL: Record<RemotePaneKind, string> = { ssh: 'SSH', wsl: 'WSL' }
const UNCONFIRMED_PATTERN = /\(remote pane, cannot confirm: (SSH|WSL)\)/

/**
 * `<code>: <sentence>`; the sentence names the holder's tab when one is known, and always its PTY id.
 * `unconfirmed` marks a remote pane whose foreground could not be read: it still holds the session,
 * and the line says that Orca could not confirm its agent still runs.
 */
export function formatAgentSessionHeldRefusal(
  holderPtyId: string,
  holderTitle?: string | null,
  unconfirmed?: RemotePaneKind
): string {
  const title = holderTitle?.replace(/["\r\n]/g, '').trim()
  const where = title
    ? `the terminal "${title}" (pty ${holderPtyId})`
    : `a terminal that no tab shows (pty ${holderPtyId}; \`orca terminal list\` lists it)`
  if (unconfirmed) {
    return `${AGENT_SESSION_HELD_CODE}: This agent session may still be running in ${where} (remote pane, cannot confirm: ${REMOTE_PANE_LABEL[unconfirmed]}). Orca cannot read what that ${REMOTE_PANE_LABEL[unconfirmed]} pane runs; switch to it, or close it if its agent has exited, instead of resuming the session again.`
  }
  return `${AGENT_SESSION_HELD_CODE}: This agent session is still running in ${where}. Switch to that terminal instead of resuming the session again.`
}

/** The holder a refusal line names; null when the line is not this refusal. */
export function parseAgentSessionHeldRefusal(line: string): {
  holderPtyId: string
  holderTitle: string | null
  unconfirmed: RemotePaneKind | null
} | null {
  const holder = HOLDER_PATTERN.exec(line)
  if (!holder) {
    return null
  }
  const unconfirmed = UNCONFIRMED_PATTERN.exec(line)?.[1]
  return {
    holderPtyId: holder[1],
    holderTitle: HOLDER_TITLE_PATTERN.exec(line)?.[1] ?? null,
    unconfirmed: unconfirmed === 'SSH' ? 'ssh' : unconfirmed === 'WSL' ? 'wsl' : null
  }
}

export function isAgentSessionHeldRefusal(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  return message.includes(AGENT_SESSION_HELD_CODE)
}
