import type { GlobalSettings } from '../../shared/global-settings-types'
import type {
  ClaudeManagedAccountSummary,
  ClaudeSessionMoveSummary
} from '../../shared/managed-account-types'
import type { AgentHookServer } from '../agent-hooks/server'
import type { RateLimitService } from '../rate-limits/service'
import type { ClaudePaneAccountRecord } from './claude-pane-account-registry'
import type { ClaudeSessionMoveStrategy } from './claude-session-move-strategy'
import type { ClaudeAccountService } from './service'

export type ClaudeSessionMoveReason =
  | 'stay'
  | 'read-usage'
  | 'wait:mid-turn'
  | 'wait:no-status'
  | 'moving'
  | 'moved'
  | 'failed'
  | 'pinned'
  | 'off'
  | 'ask'
  | 'skipped'

export type ClaudeSessionMoveNotice = {
  kind: 'moved' | 'ask' | 'skipped' | 'failed'
  ptyId: string
  from: ClaudeManagedAccountSummary
  to: ClaudeManagedAccountSummary | null
  detail: string
}

export type ClaudeSessionMoverDeps = {
  getSettings: () => Pick<
    GlobalSettings,
    | 'claudeSessionMover'
    | 'activeClaudeManagedAccountId'
    | 'activeClaudeManagedAccountIdsByRuntime'
    | 'claudeManagedAccounts'
  >
  rateLimits: Pick<
    RateLimitService,
    'onStateChange' | 'getState' | 'fetchInactiveClaudeAccountsOnOpen'
  >
  accounts: Pick<ClaudeAccountService, 'listAccounts'>
  hooks: Pick<
    AgentHookServer,
    | 'subscribeStatusChanges'
    | 'getStatusChangeSnapshot'
    | 'getProviderSessionIdentities'
    | 'getStatusSnapshotForPane'
  >
  registry: {
    list: () => ClaudePaneAccountRecord[]
    record: (record: ClaudePaneAccountRecord) => void
  }
  resolvePaneKey: (ptyId: string) => string | null
  resolvePtyIdForPaneKey: (paneKey: string) => string | null
  resolveWorktreeId: (ptyId: string) => string | null
  accountHomes: (accountId: string) => string[]
  strategy: ClaudeSessionMoveStrategy
  /** No window can answer "ask" here, so it acts as "move" (said once in the log). */
  headless: boolean
  onNotice: (notice: ClaudeSessionMoveNotice) => void
  log?: (line: string, record: ClaudeSessionMoveSummary) => void
}

export type ClaudeSessionMover = {
  start: () => () => void
  evaluate: () => void
  /** The last decision per live session, newest first. */
  lastDecisions: () => ClaudeSessionMoveSummary[]
}
