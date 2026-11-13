import type { createClaudeAuthProxyTokenCache } from './claude-auth-proxy-token-cache'

const QUARANTINE_RETRY_MS = 5_000

export function createClaudeAuthProxySlotCredentials({
  slots,
  tokens,
  now,
  log
}: {
  slots: ReadonlyMap<string, string>
  tokens: ReturnType<typeof createClaudeAuthProxyTokenCache>
  now: () => number
  log: (message: string) => void
}) {
  const quarantinedSlots = new Map<string, { retryAt: number }>()

  async function tokenForSlot(slot: string, accountId: string): Promise<string | null> {
    const quarantine = quarantinedSlots.get(slot)
    if (quarantine && now() < quarantine.retryAt) {
      return null
    }
    if (quarantine) {
      // Reserve the retry while the credential read is in flight.
      quarantine.retryAt = Infinity
      tokens.invalidate(accountId)
    }
    const token = await tokens.tokenFor(accountId)
    if (quarantine) {
      quarantine.retryAt = now() + QUARANTINE_RETRY_MS
    }
    if (slots.get(slot) !== accountId) {
      return token
    }
    if (!token) {
      if (!quarantinedSlots.has(slot)) {
        quarantinedSlots.set(slot, { retryAt: now() + QUARANTINE_RETRY_MS })
        log(`quarantined slot for account ${accountId}: credentials unavailable`)
      }
      return null
    }
    if (quarantine && quarantinedSlots.get(slot) === quarantine) {
      quarantinedSlots.delete(slot)
      log(`lifted slot quarantine for account ${accountId}: credentials available`)
    }
    return token
  }

  return {
    tokenForSlot,
    forgetSlot(slot: string) {
      quarantinedSlots.delete(slot)
    },
    clear() {
      quarantinedSlots.clear()
    }
  }
}
