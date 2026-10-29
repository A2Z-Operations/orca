import type { GlobalSettings } from '../../shared/global-settings-types'
import type { RateLimitService } from '../rate-limits/service'

export type ClaudeUsagePollingSettings = Partial<
  Pick<GlobalSettings, 'claudeAutoSwitchEnabled' | 'claudeSessionMover'>
>

export const CLAUDE_USAGE_POLLING_SETTING_KEYS = [
  'claudeAutoSwitchEnabled',
  'claudeSessionMover'
] as const

/** Why: these features decide on readings; without polling a headless host never has one to decide on. */
export function shouldPollClaudeUsage(settings: ClaudeUsagePollingSettings): boolean {
  return (
    settings.claudeAutoSwitchEnabled === true || (settings.claudeSessionMover ?? 'ask') !== 'off'
  )
}

/** Starts polling when a usage-driven feature needs it and stops it when none does; idempotent. */
export function createClaudeUsagePollingSwitch(
  rateLimits: Pick<RateLimitService, 'start' | 'stop'>,
  getSettings: () => ClaudeUsagePollingSettings
): { apply: (updates?: ClaudeUsagePollingSettings) => boolean; polling: () => boolean } {
  let polling = false
  return {
    polling: () => polling,
    apply: (updates) => {
      if (updates && !CLAUDE_USAGE_POLLING_SETTING_KEYS.some((key) => key in updates)) {
        return polling
      }
      const wanted = shouldPollClaudeUsage(getSettings())
      if (wanted && !polling) {
        rateLimits.start({ fetchImmediately: true, pollWithoutWindow: true })
        polling = true
      } else if (!wanted && polling) {
        rateLimits.stop()
        polling = false
      }
      return polling
    }
  }
}
