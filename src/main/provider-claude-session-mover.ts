import type { RuntimePtyController } from './runtime/runtime-pty-controller-contract'
import { agentHookServer } from './agent-hooks/server'
import {
  listClaudePaneAccounts,
  recordClaudePaneAccount
} from './claude-accounts/claude-pane-account-registry'
import {
  createClaudeSessionMover,
  type ClaudeSessionMoveNotice,
  type ClaudeSessionMover
} from './claude-accounts/claude-session-mover'
import { createResumeMoveStrategy } from './claude-accounts/claude-session-move-strategy'
import { getPtyIdForPaneKey, ptyPaneKey } from './ipc/pty/pane/key-state'
import { listRegisteredPtys } from './memory/pty-registry'
import type { Store } from './persistence'
import type { ProviderAccountServices } from './provider-account-services'

export type StartedClaudeSessionMover = ClaudeSessionMover & { stop: () => void }

export type ProviderClaudeSessionMoverOptions = {
  headless: boolean
  getController: () => Pick<RuntimePtyController, 'spawn' | 'getCwd' | 'getSize'> | null
  onNotice: (notice: ClaudeSessionMoveNotice) => void
}

export function createProviderClaudeSessionMover(
  store: Store,
  services: Pick<ProviderAccountServices, 'rateLimits' | 'claudeAccounts' | 'claudeRuntimeAuth'>,
  options: ProviderClaudeSessionMoverOptions | undefined
): StartedClaudeSessionMover | null {
  const { rateLimits, claudeAccounts, claudeRuntimeAuth } = services
  const sessionMover = options
    ? createClaudeSessionMover({
        getSettings: () => store.getSettings(),
        rateLimits,
        accounts: claudeAccounts,
        hooks: agentHookServer,
        registry: { list: listClaudePaneAccounts, record: recordClaudePaneAccount },
        resolvePaneKey: (ptyId) => ptyPaneKey.get(ptyId) ?? null,
        resolvePtyIdForPaneKey: (paneKey) => getPtyIdForPaneKey(paneKey) ?? null,
        resolveWorktreeId: (ptyId) =>
          listRegisteredPtys().find((pty) => pty.ptyId === ptyId)?.worktreeId ?? null,
        // Why the System-default home too: a pane on System default records the COVERED account's id (Task 1
        // convention), so transcript inference must own ~/.claude for that account or the two sources disagree.
        accountHomes: (accountId) =>
          claudeRuntimeAuth.router.coveredBySystemDefault(accountId)
            ? [
                claudeRuntimeAuth.router.accountHome(accountId),
                claudeRuntimeAuth.router.systemDefaultHome()
              ]
            : [claudeRuntimeAuth.router.accountHome(accountId)],
        strategy: createResumeMoveStrategy({
          getController: options.getController,
          getSettings: () => store.getSettings(),
          platform: process.platform
        }),
        headless: options.headless,
        onNotice: options.onNotice
      })
    : null
  if (sessionMover) {
    claudeAccounts.setSessionMovesProvider(() => sessionMover.lastDecisions())
    return { ...sessionMover, stop: sessionMover.start() }
  }
  return null
}
