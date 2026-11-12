import { translate } from '../../../i18n/i18n'
import type { Translate } from '../../../i18n/use-translate'
import {
  AGENT_SESSION_HELD_CODE,
  parseAgentSessionHeldRefusal
} from '../../../../../shared/agent-session/lifecycle/held-agent-session-refusal'

/** The live tab title of a PTY, or null when no tab shows it. */
export type TerminalTitleOfPty = (ptyId: string) => string | null

export function isAgentSessionHeldError(error: string): boolean {
  return error.includes(AGENT_SESSION_HELD_CODE)
}

/** Swaps each held-session refusal line, IPC-wrapped or not, for copy naming the holder's tab. */
export function humanizeAgentSessionHeldLines(
  error: string,
  t: Translate = translate,
  titleOfPty?: TerminalTitleOfPty
): string {
  if (!isAgentSessionHeldError(error)) {
    return error
  }
  return error
    .split('\n')
    .map((line) => {
      const held = parseAgentSessionHeldRefusal(line)
      if (!held) {
        return line
      }
      // Why the live title first: main's saved title can lag a rename by one save.
      const title = titleOfPty?.(held.holderPtyId) ?? held.holderTitle
      const sentence = title
        ? t(
            'auto.components.terminal.pane.TerminalErrorToast.agentSessionHeld',
            'This agent session is still running in the terminal "{{value0}}". Switch to that terminal instead of resuming the session again.',
            { value0: title }
          )
        : t(
            'auto.components.terminal.pane.TerminalErrorToast.agentSessionHeldNoTab',
            'This agent session is still running in a terminal that no tab shows. Run `orca terminal list` to find it, then switch to it or stop it instead of resuming the session again.'
          )
      // Why: an SSH/WSL pane's foreground could not be read, so its agent may have exited already.
      return held.unconfirmed
        ? `${sentence} ${t(
            'auto.components.terminal.pane.TerminalErrorToast.agentSessionHeldRemoteUnconfirmed',
            'That is a remote pane ({{value0}}), so Orca cannot confirm its agent is still running; if it has exited, close that terminal and resume again.',
            { value0: held.unconfirmed === 'ssh' ? 'SSH' : 'WSL' }
          )}`
        : sentence
    })
    .join('\n')
}

/** The title of the tab whose tab or leaf binding names `ptyId`; null when no tab does. */
export function terminalTabTitleOfPty(
  state: {
    tabsByWorktree: Record<
      string,
      readonly { id: string; ptyId: string | null; title: string; customTitle: string | null }[]
    >
    terminalLayoutsByTabId: Record<string, { ptyIdsByLeafId?: Record<string, string> } | undefined>
  },
  ptyId: string
): string | null {
  for (const tabs of Object.values(state.tabsByWorktree)) {
    for (const tab of tabs) {
      const leaves = state.terminalLayoutsByTabId[tab.id]?.ptyIdsByLeafId ?? {}
      if (tab.ptyId === ptyId || Object.values(leaves).includes(ptyId)) {
        return tab.customTitle?.trim() || tab.title.trim() || null
      }
    }
  }
  return null
}
