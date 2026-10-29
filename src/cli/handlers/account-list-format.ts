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
  /** Claude only: whether launches bill through the local auth proxy. */
  authProxy?: 'on' | 'off'
  /** Claude only: Windows view of WSL guest billing. */
  wslAuthProxy?: 'on' | 'unsupported:wsl'
  /** Claude only: the mover's last decision per live session. JSON carries the same records. */
  sessionMoves?: readonly { ptyId: string; reason: string }[]
  /** Claude only: live sessions billed to each account (absent from older hosts). */
  assignedSessions?: readonly { accountId: string; count: number }[]
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
    (block.assignedSessions ?? []).map((row) => [row.accountId, row.count])
  )
  const lines = block.accounts.map((account) => {
    const sessions =
      block.assignedSessions !== undefined
        ? `  sessions: ${sessionCountByAccount.get(account.id) ?? 0}`
        : ''
    return `  ${account.email}${activeAccountIds.has(account.id) ? ' (active)' : ''}${
      account.needsSignIn ? ' (sign in again in Orca Settings > AI Provider Accounts)' : ''
    }${sessions}`
  })
  if (block.autoSwitchEnabled !== undefined) {
    lines.push(`  auto-switch: ${block.autoSwitchEnabled ? 'on' : 'off'}`)
  }
  if (block.sessionMover !== undefined) {
    lines.push(`  session-mover: ${block.sessionMover}`)
  }
  if (block.authProxy !== undefined) {
    lines.push(`  auth-proxy: ${block.authProxy}`)
  }
  if (block.wslAuthProxy !== undefined) {
    lines.push(`  wsl auth-proxy: ${block.wslAuthProxy}`)
  }
  for (const move of block.sessionMoves ?? []) {
    lines.push(`  session ${move.ptyId}: ${move.reason}`)
  }
  for (const assignment of block.paneAssignments ?? []) {
    lines.push(`  pane ${assignment.ptyId}: account ${assignment.accountId}`)
  }
  return `Managed ${label} accounts (${block.accounts.length}):\n${lines.join('\n')}`
}
