import { useAppStore } from '@/store/index'
import type { AccountRestartAgent } from '@/store/terminals/terminal-contracts'

export type UnsentRestartReplacementOutcome = 'handed-back' | 'stopped'

/**
 * A restart whose replacement spawn never left this pane (it was parked or remounted first) still has
 * its old PTY running. While the pane is still in its tab, give the PTY back instead of stopping it:
 * stopping it here ends a live agent with no successor, and the next mount starts a bare shell.
 */
export function settleUnsentRestartReplacement(args: {
  ptyId: string
  tabId: string
  worktreeId: string
  leafId: string
  /** The agent the restart was relaunching, when it was an account restart. */
  restartAgent: string | undefined
  consumeSuppressedPtyExit: (ptyId: string) => boolean
  updateTabPtyId: (tabId: string, ptyId: string) => void
  /** Records the pane's resume, so a restore that finds the PTY gone resumes instead of starting a shell. */
  keepResumeHandle: () => void
  stopPty: (ptyId: string) => Promise<unknown>
}): UnsentRestartReplacementOutcome {
  const state = useAppStore.getState()
  const tabPresent = (state.tabsByWorktree[args.worktreeId] ?? []).some(
    (tab) => tab.id === args.tabId
  )
  const boundPtyId = state.terminalLayoutsByTabId[args.tabId]?.ptyIdsByLeafId?.[args.leafId]
  // Why stop: a closed tab, or a pane another PTY has since taken, has no surface left to show it.
  if (!tabPresent || (boundPtyId !== undefined && boundPtyId !== args.ptyId)) {
    void Promise.resolve()
      .then(() => args.stopPty(args.ptyId))
      .catch((err: unknown) => console.warn('[terminal] failed to stop a replaced PTY:', err))
    return 'stopped'
  }
  // Why: the restart suppressed this PTY's exit; a later real exit must reach the pane again.
  args.consumeSuppressedPtyExit(args.ptyId)
  args.updateTabPtyId(args.tabId, args.ptyId)
  state.replaceTerminalLayoutPanePtyId(args.tabId, args.leafId, args.ptyId)
  args.keepResumeHandle()
  const agent = accountRestartAgentOf(args.restartAgent)
  if (agent) {
    // The account move still runs: an unmounted pane's restart replaces the PTY in one main-side step.
    state.queuePaneAccountRestarts([args.ptyId], agent)
  }
  return 'handed-back'
}

function accountRestartAgentOf(agent: string | undefined): AccountRestartAgent | null {
  return agent === 'claude' || agent === 'codex' ? agent : null
}
