import { useMemo } from 'react'
import type { ClaudeSessionMoveSummary } from '../../../../shared/managed-account-types'
import { useAppStore, type AppState } from '../../store'

export type ClaudeMoveTabName = { title: string; worktree: string | null }

export type ClaudeMoveSessionName = {
  name: string
  /** Raw ids, for the tooltip only. */
  ids: string
}

/** Tab title (custom title first) and its workspace name, by tab id. */
export function claudeMoveTabNames(
  tabsByWorktree: Readonly<
    Record<string, readonly { id: string; title: string; customTitle?: string | null }[]>
  >,
  worktreesByRepo: Readonly<Record<string, readonly { id: string; displayName: string }[]>>
): Map<string, ClaudeMoveTabName> {
  const worktreeNames = new Map<string, string>()
  for (const worktrees of Object.values(worktreesByRepo)) {
    for (const worktree of worktrees) {
      worktreeNames.set(worktree.id, worktree.displayName)
    }
  }
  const names = new Map<string, ClaudeMoveTabName>()
  for (const [worktreeId, tabs] of Object.entries(tabsByWorktree)) {
    for (const tab of tabs) {
      names.set(tab.id, {
        title: tab.customTitle || tab.title,
        worktree: worktreeNames.get(worktreeId) ?? null
      })
    }
  }
  return names
}

/**
 * The Session column: the pane's tab and workspace, so nobody reads UUIDs. A pane no longer open
 * here (another window, a closed tab, a paired host) falls back to a short id.
 */
export function claudeMoveSessionName(
  row: Pick<ClaudeSessionMoveSummary, 'ptyId' | 'paneKey' | 'chat'>,
  tabs: ReadonlyMap<string, ClaudeMoveTabName>
): ClaudeMoveSessionName {
  const ids = `pane ${row.paneKey ?? '-'} · pty ${row.ptyId}`
  const tabId = row.paneKey?.split(':')[0]
  const tab = tabId ? tabs.get(tabId) : undefined
  if (tab?.title) {
    return { name: tab.worktree ? `${tab.title} · ${tab.worktree}` : tab.title, ids }
  }
  const short = row.ptyId.replace(/[^a-zA-Z0-9]/g, '').slice(-6) || row.ptyId
  return { name: row.chat ? `Chat ${short}` : `Session ${short}`, ids }
}

const NONE = {}

export function useClaudeMoveTabNames(): ReadonlyMap<string, ClaudeMoveTabName> {
  // Why the fallback: a pane rendered against a partial store (tests, early boot) has no maps yet.
  const tabsByWorktree =
    useAppStore((s): AppState['tabsByWorktree'] | undefined => s.tabsByWorktree) ?? NONE
  const worktreesByRepo =
    useAppStore((s): AppState['worktreesByRepo'] | undefined => s.worktreesByRepo) ?? NONE
  return useMemo(
    () => claudeMoveTabNames(tabsByWorktree, worktreesByRepo),
    [tabsByWorktree, worktreesByRepo]
  )
}
