import type { ManagedDataAccountsState } from '../../shared/managed-account-types'

type AccountsBlock = {
  accounts: readonly { id: string; email: string; needsSignIn?: true }[]
  activeAccountId: string | null
  activeAccountIdsByRuntime?: {
    host: string | null
    wsl: Record<string, string | null>
  }
  /** Claude only: whether the host switches accounts before a usage limit (absent from older hosts). */
  autoSwitchEnabled?: boolean
  /** Claude only: what the host does with running sessions near a usage limit (absent from older hosts). */
  sessionMover?: 'off' | 'ask' | 'move'
  /** Claude only: the mover's last decision per live session. JSON carries the same records. */
  sessionMoves?: readonly { ptyId: string; reason: string }[]
  /** Claude only: whether new launches spread across accounts (absent from older hosts). */
  pool?: 'on' | 'off'
  /** Claude only: weekly and Fable percents. Absent from older hosts. */
  usageWindows?: readonly { accountId: string; weekly: number | null; fable: number | null }[]
  /** Claude only: spend Fable first. Absent from older hosts. */
  modelPolicy?: { enabled: boolean; fableLine: number; weeklyGuard: number }
  /** Claude only: live sessions billed to each account (absent from older hosts). */
  assignedSessions?: readonly { accountId: string; count: number; chatCount?: number }[]
  /** Claude only: whether the host bills requests through the local auth proxy (absent from older hosts). */
  authProxy?: 'on' | 'off'
  /** Claude only: whether a WSL guest can bill through its own listener (absent when this host has no WSL accounts). */
  wslAuthProxy?: 'on' | 'unsupported:wsl'
  /** Claude only: panes whose billed account differs from the folder they launched in. */
  paneAssignments?: readonly { ptyId: string; accountId: string }[]
}

export function formatDataAccounts(label: string, state: ManagedDataAccountsState): string {
  const system = `  system  System default${state.activeAccountId === null ? ' (active)' : ''}`
  if (state.accounts.length === 0) {
    return `No managed ${label} accounts.\n${system}`
  }
  return `Managed ${label} accounts (${state.accounts.length}):\n${system}\n${state.accounts
    .map(
      (account) =>
        `  ${account.id}  ${account.label}${account.id === state.activeAccountId ? ' (active)' : ''}`
    )
    .join('\n')}`
}

function formatWindowPercent(value: number | null): string {
  return value === null ? '—' : `${Math.round(value)}%`
}

export function formatClaudeModelPolicyLine(policy: {
  enabled: boolean
  fableLine: number
  weeklyGuard: number
}): string {
  return policy.enabled
    ? `model-policy: on (fable<${policy.fableLine}, weekly<${policy.weeklyGuard})`
    : 'model-policy: off'
}

export function formatClaudeModelPolicyEvaluationLine(row: {
  ptyId: string
  paneKey: string | null
  accountId: string | null
  model: string | null
  source: string | null
  choice: string | null
  reason: string
  skip: string | null
  at: number
}): string {
  const skip = row.skip ? `  skip ${row.skip}` : ''
  return `pane ${row.paneKey ?? row.ptyId}  account ${row.accountId ?? '-'}  model ${row.model ?? '-'}  source ${row.source ?? '-'}  choice ${row.choice ?? '-'}  reason ${row.reason}${skip}  at ${new Date(row.at).toISOString()}`
}

function formatSessionCount(count: number, chatCount: number | undefined): string {
  const chats =
    chatCount && chatCount > 0 ? ` (${chatCount} chat${chatCount === 1 ? '' : 's'})` : ''
  return `sessions: ${count}${chats}`
}

export function formatAccountsBlock(label: string, block: AccountsBlock): string {
  if (block.accounts.length === 0) {
    return `No managed ${label} accounts.`
  }
  const activeAccountIds = new Set([
    block.activeAccountId,
    block.activeAccountIdsByRuntime?.host,
    ...Object.values(block.activeAccountIdsByRuntime?.wsl ?? {})
  ])
  const sessionCountByAccount = new Map(
    (block.assignedSessions ?? []).map((row) => [row.accountId, row])
  )
  const windowsByAccount = new Map((block.usageWindows ?? []).map((row) => [row.accountId, row]))
  const lines = block.accounts.map((account) => {
    const row = sessionCountByAccount.get(account.id)
    const sessions =
      block.assignedSessions !== undefined
        ? `  ${formatSessionCount(row?.count ?? 0, row?.chatCount)}`
        : ''
    const windows = windowsByAccount.get(account.id)
    const windowText = windows
      ? `  weekly ${formatWindowPercent(windows.weekly)} · fable ${formatWindowPercent(windows.fable)}`
      : ''
    return `  ${account.email}${activeAccountIds.has(account.id) ? ' (active)' : ''}${
      account.needsSignIn ? ' (sign in again in Orca Settings > AI Provider Accounts)' : ''
    }${sessions}${windowText}`
  })
  if (block.autoSwitchEnabled !== undefined) {
    lines.push(`  auto-switch: ${block.autoSwitchEnabled ? 'on' : 'off'}`)
  }
  if (block.sessionMover !== undefined) {
    lines.push(`  session-mover: ${block.sessionMover}`)
  }
  if (block.pool !== undefined) {
    lines.push(`  pool: ${block.pool}`)
  }
  if (block.modelPolicy) {
    lines.push(`  ${formatClaudeModelPolicyLine(block.modelPolicy)}`)
  }
  for (const move of block.sessionMoves ?? []) {
    lines.push(`  session ${move.ptyId}: ${move.reason}`)
  }
  if (block.authProxy !== undefined) {
    lines.push(`  auth-proxy: ${block.authProxy}`)
  }
  if (block.wslAuthProxy !== undefined) {
    lines.push(`  wsl auth-proxy: ${block.wslAuthProxy}`)
  }
  for (const assignment of block.paneAssignments ?? []) {
    lines.push(`  pane ${assignment.ptyId}: account ${assignment.accountId}`)
  }
  return `Managed ${label} accounts (${block.accounts.length}):\n${lines.join('\n')}`
}
