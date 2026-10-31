import type { GlobalSettings } from '../../shared/global-settings-types'
import type { RateLimitService } from '../rate-limits/service'
import { resolveClaudeModelPolicy } from './claude-model-policy'

export type ClaudeUsagePollingSettings = Partial<
  Pick<
    GlobalSettings,
    'claudeAutoSwitchEnabled' | 'claudeSessionMover' | 'claudeAccountPool' | 'claudeModelPolicy'
  >
>

export const CLAUDE_USAGE_POLLING_SETTING_KEYS = [
  'claudeAutoSwitchEnabled',
  'claudeSessionMover',
  'claudeAccountPool',
  'claudeModelPolicy'
] as const

/** Why: these features decide on readings; without polling a headless host never has one to decide on. */
export function shouldPollClaudeUsage(settings: ClaudeUsagePollingSettings): boolean {
  return (
    resolveClaudeModelPolicy(settings).enabled ||
    settings.claudeAutoSwitchEnabled === true ||
    (settings.claudeSessionMover ?? 'ask') !== 'off' ||
    settings.claudeAccountPool === 'on'
  )
}

/** Starts polling when a usage-driven feature needs it and stops it when none does; idempotent. */
export function createClaudeUsagePollingSwitch(
  rateLimits: Pick<RateLimitService, 'start' | 'stop'>,
  getSettings: () => ClaudeUsagePollingSettings
): { apply: (updates?: Partial<GlobalSettings>) => boolean; polling: () => boolean } {
  let polling = false
  return {
    polling: () => polling,
    apply: (updates) => {
      if (updates && !CLAUDE_USAGE_POLLING_SETTING_KEYS.some((key) => key in updates)) {
        return polling
      }
      const wanted = shouldPollClaudeUsage(getSettings())
      if (wanted && !polling) {
        rateLimits.start({
          fetchImmediately: true,
          pollWithoutWindow: true,
          pollInactiveClaude: true
        })
        polling = true
      } else if (!wanted && polling) {
        rateLimits.stop()
        polling = false
      }
      return polling
    }
  }
}
