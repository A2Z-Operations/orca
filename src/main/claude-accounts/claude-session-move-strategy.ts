import type { AgentProviderSessionMetadata } from '../../shared/agent-session-resume'
import type { AgentStartupSettings } from '../../shared/agent-startup-plan-inputs'
import { parsePaneKey } from '../../shared/stable-pane-id'
import { buildAgentResumeStartupPlan } from '../../shared/tui-agent-resume-startup'
import { resolveStartupShell } from '../../shared/tui-agent-startup-shell'
import type { RuntimePtyController } from '../runtime/runtime-pty-controller-contract'

export type ClaudeSessionMoveRequest = {
  ptyId: string
  paneKey: string
  worktreeId: string
  connectionId: string | null
  toAccountId: string
  providerSession: AgentProviderSessionMetadata
}

export type ClaudeSessionMoveOutcome =
  | { kind: 'moved'; newPtyId: string }
  | { kind: 'skipped'; reason: 'no-controller' | 'no-resume-plan' | 'no-pane' }
  | { kind: 'failed'; reason: 'owner-changed' | 'spawn-failed'; error: string }

/** How a session gets onto another account. `resume` restarts it in place; a token swap is a later strategy. */
export type ClaudeSessionMoveStrategy = {
  move(request: ClaudeSessionMoveRequest): Promise<ClaudeSessionMoveOutcome>
}

export type ResumeMoveStrategyDeps = {
  getController: () => Pick<RuntimePtyController, 'spawn' | 'getCwd' | 'getSize'> | null
  getSettings: () => AgentStartupSettings
  platform: NodeJS.Platform
}

const FALLBACK_SIZE = { cols: 120, rows: 40 }

/**
 * `claude --resume <id>` in the same pane, spawned on the target account: the resume is built as the
 * phone's cold restore builds it; `replacesPtyId` stops the old PTY and swaps the pane binding;
 * `claudeAccountId` makes main's preflight inject the target account's folder.
 */
export function createResumeMoveStrategy(deps: ResumeMoveStrategyDeps): ClaudeSessionMoveStrategy {
  return {
    async move(request) {
      const controller = deps.getController()
      if (!controller?.spawn) {
        return { kind: 'skipped', reason: 'no-controller' }
      }
      const pane = parsePaneKey(request.paneKey)
      if (!pane) {
        return { kind: 'skipped', reason: 'no-pane' }
      }
      const settings = deps.getSettings()
      const cwd = (await controller.getCwd?.(request.ptyId)) ?? undefined
      // Why no defaults: a hand-started Claude must not come back with configured args such as a permission bypass.
      const plan = buildAgentResumeStartupPlan({
        agent: 'claude',
        providerSession: request.providerSession,
        launchCwd: cwd,
        cmdOverrides: settings.agentCmdOverrides ?? {},
        agentArgs: null,
        agentEnv: null,
        platform: deps.platform,
        shell: resolveStartupShell(deps.platform)
      })
      if (!plan) {
        return { kind: 'skipped', reason: 'no-resume-plan' }
      }
      const size = controller.getSize?.(request.ptyId) ?? FALLBACK_SIZE
      try {
        const result = await controller.spawn({
          ...size,
          ...(cwd ? { cwd } : {}),
          command: plan.launchCommand,
          launchAgent: 'claude',
          commandDelivery: 'provider',
          ...(plan.startupCommandDelivery
            ? { startupCommandDelivery: plan.startupCommandDelivery }
            : {}),
          ...(plan.env ? { env: plan.env } : {}),
          resumeProviderSession: request.providerSession,
          connectionId: request.connectionId,
          worktreeId: request.worktreeId,
          tabId: pane.tabId,
          leafId: pane.leafId,
          replacesPtyId: request.ptyId,
          claudeAccountId: request.toAccountId,
          isNewSession: true,
          // Why hidden + persisted: no renderer view exists for the new PTY yet (none at all on a server);
          // the pane binding is what a window or the CLI follows to it.
          initiallyHidden: true,
          persistHostSessionBinding: true
        })
        return { kind: 'moved', newPtyId: result.id }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return {
          kind: 'failed',
          reason: message === 'terminal_pane_owner_changed' ? 'owner-changed' : 'spawn-failed',
          error: message
        }
      }
    }
  }
}
