import { parseWorkspaceKey } from '../../shared/workspace-scope'
import { shortPluginBranchName } from '../../shared/plugins/events/plugin-events'
import type { RuntimeWorktreeLifecycleEvent } from '../runtime/workspaces/lifecycle/worktree-lifecycle-event'
import { notifyWorkspaceCreatedPluginHook } from './hooks/workspace-create-plugin-hook'
import type { PluginService } from './plugin-service'

/** Fork: shared by the desktop and the plain-Node (orcad) host, so it reads no main-process state. */
export function emitPluginWorktreeLifecycleTo(
  pluginService: Pick<PluginService, 'emitEvent'> | null | undefined,
  event: RuntimeWorktreeLifecycleEvent
): void {
  const identity = { workspaceId: event.worktreeId, kind: 'worktree', path: event.path }
  const folder = parseWorkspaceKey(event.worktreeId)?.type === 'folder'
  if (event.kind === 'created') {
    notifyWorkspaceCreatedPluginHook({ ...event, folder })
  }
  // Public worktree events retain their Git-only scope.
  if (folder) {
    return
  }
  pluginService?.emitEvent(
    event.kind === 'created' ? 'workspace.created' : 'workspace.removed',
    event.kind === 'created'
      ? { ...identity, branch: shortPluginBranchName(event.branch) }
      : identity
  )
}
