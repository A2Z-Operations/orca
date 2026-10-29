import {
  pluginClaudeSessionMovedPayloadSchema,
  pluginClaudeUsageChangedPayloadSchema,
  type PluginClaudeAccountView
} from '../../shared/plugins/plugin-claude-account-contract'
import { setClaudeAccountPluginPublishListener } from '../claude-accounts/claude-account-plugin-publish'
import {
  diffPluginClaudeAccountUsage,
  fingerprintPluginClaudeAccounts
} from './plugin-claude-account-projection'

export type PluginClaudeAccountEventName = 'accounts.usage.changed' | 'accounts.session.moved'

type EmitPluginClaudeAccountEvent = (event: PluginClaudeAccountEventName, payload: unknown) => void

let readBoundAccounts: () => PluginClaudeAccountView[] = () => []
let releaseCurrent: (() => void) | null = null

export function readPluginClaudeAccounts(): { accounts: PluginClaudeAccountView[] } {
  try {
    return { accounts: readBoundAccounts() }
  } catch {
    return { accounts: [] }
  }
}

function safeRead(): PluginClaudeAccountView[] {
  try {
    return readBoundAccounts()
  } catch {
    return []
  }
}

/** Rebind replaces the previous rate-limit subscription. The first read is a baseline and does not emit. */
export function bindPluginClaudeAccountEvents(input: {
  emit: EmitPluginClaudeAccountEvent
  readAccounts: () => PluginClaudeAccountView[]
  subscribeRateLimits: (listener: () => void) => () => void
}): () => void {
  releaseCurrent?.()
  readBoundAccounts = input.readAccounts
  let fingerprints = fingerprintPluginClaudeAccounts(safeRead())
  const unsubscribe = input.subscribeRateLimits(() => {
    try {
      const diff = diffPluginClaudeAccountUsage(fingerprints, safeRead())
      fingerprints = diff.next
      for (const payload of diff.changed) {
        const parsed = pluginClaudeUsageChangedPayloadSchema.safeParse(payload)
        if (!parsed.success) {
          continue
        }
        try {
          input.emit('accounts.usage.changed', parsed.data)
        } catch {
          // Delivery must not break the rate-limit listener.
        }
      }
    } catch {
      // A projection failure must not break the rate-limit listener.
    }
  })
  setClaudeAccountPluginPublishListener((moved) => {
    const parsed = pluginClaudeSessionMovedPayloadSchema.safeParse(moved)
    if (!parsed.success) {
      return
    }
    try {
      input.emit('accounts.session.moved', parsed.data)
    } catch {
      // Delivery must not fail the session move. The publisher swallows too.
    }
  })
  const release = (): void => {
    unsubscribe()
    if (releaseCurrent !== release) {
      return
    }
    releaseCurrent = null
    readBoundAccounts = () => []
    setClaudeAccountPluginPublishListener(null)
  }
  releaseCurrent = release
  return release
}
