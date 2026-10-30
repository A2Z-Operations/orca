import type { PluginClaudeSessionMovedPayload } from '../../shared/plugins/plugin-claude-account-contract'

type Listener = (moved: PluginClaudeSessionMovedPayload) => void

let listener: Listener | null = null

/** The plugin host registers this. Unset on a process that does not run plugins. */
export function setClaudeAccountPluginPublishListener(next: Listener | null): void {
  listener = next
}

export function publishClaudeAccountSessionMoved(moved: PluginClaudeSessionMovedPayload): void {
  if (moved.fromAccountId === moved.toAccountId) {
    return
  }
  const payload: PluginClaudeSessionMovedPayload = {
    ptyId: moved.ptyId,
    fromAccountId: moved.fromAccountId,
    toAccountId: moved.toAccountId,
    ...(moved.previousPtyId && moved.previousPtyId !== moved.ptyId
      ? { previousPtyId: moved.previousPtyId }
      : {})
  }
  try {
    listener?.(payload)
  } catch {
    // A plugin listener must not fail the session move.
  }
}
