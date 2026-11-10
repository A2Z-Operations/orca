import type { AgentHookEventPayload } from '../../../shared/agent-hook-listener/listener-event'
import type { AgentHookStatusChangeEntry, EnrichedAgentHookEventPayload } from './server-types'

/** The main agent's own state and whether background work (monitoring, shell, cron, owed task) is still running. */
export function statusChangeWorkFields(
  enriched: EnrichedAgentHookEventPayload
): Pick<AgentHookStatusChangeEntry, 'mainAgentState' | 'backgroundWork' | 'turnEndedAt'> {
  // Monitoring is the folded shell/cron signal; the flag covers the same work before that fold.
  const backgroundWork =
    enriched.payload.workingMode === 'monitoring' || enriched.claudeRunningNonAgentTask === true
  return {
    ...(enriched.payload.mainAgent ? { mainAgentState: enriched.payload.mainAgent.state } : {}),
    ...(backgroundWork ? { backgroundWork: true } : {}),
    ...(enriched.turnEndedAt !== undefined ? { turnEndedAt: enriched.turnEndedAt } : {})
  }
}

/** Shell, cron, or owed-task work the child list does not show. Absent when the pane has no row. */
export function claudeRunningNonAgentTaskFor(
  row: AgentHookEventPayload | undefined
): boolean | undefined {
  const running = row?.claudeRunningNonAgentTask
  return typeof running === 'boolean' ? running : undefined
}
