// Why one format: main writes the refusal, scripts match its code, and the renderer swaps the
// sentence for localized copy naming the holder's tab, which it reads from the line itself.

export const AGENT_SESSION_HELD_CODE = 'agent_session_held_by_live_terminal'

const HOLDER_PATTERN = new RegExp(`${AGENT_SESSION_HELD_CODE}:.*?\\(pty ([^);\\s]+)[);]`)
const HOLDER_TITLE_PATTERN = /terminal "([^"\r\n]*)" \(pty /

/** `<code>: <sentence>`; the sentence names the holder's tab when one is known, and always its PTY id. */
export function formatAgentSessionHeldRefusal(
  holderPtyId: string,
  holderTitle?: string | null
): string {
  const title = holderTitle?.replace(/["\r\n]/g, '').trim()
  const where = title
    ? `the terminal "${title}" (pty ${holderPtyId})`
    : `a terminal that no tab shows (pty ${holderPtyId}; \`orca terminal list\` lists it)`
  return `${AGENT_SESSION_HELD_CODE}: This agent session is still running in ${where}. Switch to that terminal instead of resuming the session again.`
}

/** The holder a refusal line names; null when the line is not this refusal. */
export function parseAgentSessionHeldRefusal(
  line: string
): { holderPtyId: string; holderTitle: string | null } | null {
  const holder = HOLDER_PATTERN.exec(line)
  if (!holder) {
    return null
  }
  return { holderPtyId: holder[1], holderTitle: HOLDER_TITLE_PATTERN.exec(line)?.[1] ?? null }
}

export function isAgentSessionHeldRefusal(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  return message.includes(AGENT_SESSION_HELD_CODE)
}
