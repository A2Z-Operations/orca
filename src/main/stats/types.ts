export type ClaudeSessionMoveStats = {
  resume: number
  proxy: number
  rebalances: number
  failures: number
}

export type StatsEventType =
  | 'agent_start' // agent reported working via its hooks
  | 'agent_stop' // agent left working (done/waiting/blocked) or its pane was torn down
  | 'pr_created' // PR opened from an Orca worktree
  | 'claude_session_move' // a Claude session move landed, rebalanced, or failed

export type StatsEvent = {
  type: StatsEventType
  at: number // Unix epoch milliseconds.
  // Keep repo/workspace context for future breakdowns even when current aggregates omit it.
  repoId?: string
  worktreeId?: string
  meta?: Record<string, string | number>
}

export type StatsAggregates = {
  totalAgentsSpawned: number
  totalPRsCreated: number
  totalAgentTimeMs: number
  // PR URLs deduplicate across restarts; collector caps this at 2000.
  countedPRs: string[]
  // Persist first event time independently: trimming the 10K event log must not move tracking-since forward.
  firstEventAt: number | null
  // Completed moves by how they landed. A rebalance is also counted under its strategy.
  claudeSessionMoves: ClaudeSessionMoveStats
}

export type StatsFile = {
  schemaVersion: number
  events: StatsEvent[]
  aggregates: StatsAggregates
}
