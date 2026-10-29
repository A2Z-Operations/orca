import type { Store } from '../persistence'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import type {
  GetSelectedCodexHomePath,
  PrepareClaudeAuth,
  PrepareCodexSessionResume
} from '../ipc/pty/host-env/types'
import type {
  AiVaultPrepareSessionResumeArgs,
  AiVaultPrepareSessionResumeResult
} from '../../shared/ai-vault-resume-preparation'
import type { ClaudeStatusLineRateLimits } from '../../shared/claude-statusline-rate-limits'
import { resolveTuiAgentLaunchEnv } from '../../shared/tui-agent-launch-defaults'
import { createProviderAccountServices } from '../provider-account-services'
import { createClaudeUsagePollingSwitch } from '../claude-accounts/claude-usage-polling-policy'
import { createCodexRuntimeHomeLaunchPreparation } from '../codex/codex-runtime-home-launch-preparation'
import { createCodexSessionResumeLaunchPreparation } from '../codex/codex-session-resume-launch-preparation'
import { prepareCodexAiVaultSessionResume } from '../codex/codex-ai-vault-session-resume'
import { resolveHostCodexSessionSourceHome } from '../codex/codex-session-source-home'
import { resolveHostAgentBaseEnvironment } from '../runtime/structured-agent-shell-environment'
import { isWslHostOrcadProcess } from '../ipc/wsl-guest-windows-drive-path'
import {
  startClaudeAuthProxy,
  stopClaudeAuthProxy
} from '../claude-accounts/claude-auth-proxy/claude-auth-proxy-host'
import type { OrcadRuntimeCleanup } from './orcad-runtime-lifetime'

type StructuredLaunchInput = { launchEnv: NodeJS.ProcessEnv }

type OrcadAccountServices = {
  prepareCodexHome: ReturnType<typeof createCodexRuntimeHomeLaunchPreparation>
  prepareClaudeAuth: PrepareClaudeAuth
  /** Pin auto-resume to the account home that recorded the session. */
  prepareCodexSessionResume: PrepareCodexSessionResume
  runtimeDeps: {
    prepareCodexStructuredLaunch: (input: StructuredLaunchInput) => Promise<string | null>
    resolveCodexStructuredLaunchHome: (input: StructuredLaunchInput) => string | null
    prepareCodexCatalogProbeHome: (homePath: string) => void
    prepareAiVaultSessionResume: (
      args: AiVaultPrepareSessionResumeArgs
    ) => Promise<AiVaultPrepareSessionResumeResult>
  }
  listCodexSessionHomes: () => string[]
  attachToRuntime: (
    runtime: Pick<
      OrcaRuntimeService,
      | 'setAccountServices'
      | 'setCommitMessageAgentEnvironmentResolvers'
      | 'getPtyController'
      | 'dispatchMobileNotification'
    >
  ) => void
}

/** WSL accounts remain desktop-owned, including pushed CODEX_HOME and structured launch selection. */
export function createOrcadAccountServices(args: {
  store: Store
  setClaudeStatusLineListener: (
    listener: ((event: ClaudeStatusLineRateLimits) => void) | null
  ) => void
  registerCleanup: (cleanup: OrcadRuntimeCleanup) => void
  /** Client-provided account homes override host selection, as for PTYs. */
  clientCodexHomes: {
    selectLaunchHome: GetSelectedCodexHomePath
    readLaunchHome: (launchEnv?: NodeJS.ProcessEnv) => string | null
  }
  isWslHost?: () => boolean
}): OrcadAccountServices | null {
  if ((args.isWslHost ?? isWslHostOrcadProcess)()) {
    return null
  }
  const { store, clientCodexHomes } = args
  let attachedRuntime: Pick<
    OrcaRuntimeService,
    'getPtyController' | 'dispatchMobileNotification'
  > | null = null
  const services = createProviderAccountServices(store, {
    setClaudeStatusLineListener: args.setClaudeStatusLineListener,
    sessionMover: {
      headless: true,
      getController: () => attachedRuntime?.getPtyController() ?? null,
      // Why the notification stream: no window is attached here; a paired client sees it when it next connects.
      onNotice: (notice) =>
        attachedRuntime?.dispatchMobileNotification({
          type: 'notification',
          source: 'plugin',
          title: 'Claude session mover',
          body: notice.balance
            ? `${notice.from.email} continues on ${notice.to?.email ?? ''} to balance your accounts`
            : notice.restartless
              ? `${notice.from.email} continues on ${notice.to?.email ?? ''} without a restart`
              : `${notice.kind}: session ${notice.ptyId} on ${notice.from.email}${notice.to ? ` → ${notice.to.email}` : ''} (${notice.detail})`
        })
    }
  })
  // Headless usage-driven features need readings even without a window requesting them.
  const polling = createClaudeUsagePollingSwitch(services.rateLimits, () => store.getSettings())
  polling.apply()
  const unsubscribePolling = store.onSettingsChanged((updates) => {
    polling.apply(updates)
  })
  void startClaudeAuthProxy()
  args.registerCleanup(async () => {
    unsubscribePolling()
    services.sessionMover?.stop()
    await stopClaudeAuthProxy()
    attachedRuntime = null
    services.rateLimits.stop()
    args.setClaudeStatusLineListener(null)
  })
  const { codexRuntimeHome } = services
  const prepareCodexHome = createCodexRuntimeHomeLaunchPreparation({
    getRuntimeHome: () => codexRuntimeHome,
    getSettings: () => store.getSettings()
  })
  const prepareClaudeAuth: PrepareClaudeAuth = (target) =>
    services.claudeRuntimeAuth.prepareForClaudeLaunch(target)
  const resumeLaunch = createCodexSessionResumeLaunchPreparation({
    getRuntimeHome: () => codexRuntimeHome,
    getSettings: () => store.getSettings()
  })
  return {
    prepareCodexHome,
    prepareClaudeAuth,
    // Client-owned sessions live outside the host’s trusted home list.
    prepareCodexSessionResume: async (resumeArgs) =>
      clientCodexHomes.readLaunchHome(resumeArgs.launchEnv)
        ? null
        : resumeLaunch.prepareCodexSessionResumeForLaunch(resumeArgs),
    runtimeDeps: {
      prepareCodexStructuredLaunch: async ({ launchEnv }) =>
        (await clientCodexHomes.selectLaunchHome(undefined, launchEnv)) ??
        prepareCodexHome(undefined, launchEnv),
      resolveCodexStructuredLaunchHome: ({ launchEnv }) =>
        clientCodexHomes.readLaunchHome(launchEnv) ??
        codexRuntimeHome.resolveHostCodexHomePathForLaunchReadOnly(launchEnv),
      prepareCodexCatalogProbeHome: (homePath) =>
        codexRuntimeHome.prepareHostCodexHomeForReadOnlyAppServer(
          homePath,
          resolveTuiAgentLaunchEnv('codex', store.getSettings())
        ),
      prepareAiVaultSessionResume: (resumeArgs) =>
        prepareCodexAiVaultSessionResume(resumeArgs, {
          runtimeHome: codexRuntimeHome,
          systemCodexHomePath: resolveHostCodexSessionSourceHome(store.getSettings()),
          preparePinnedLaunchHome: (home) => resumeLaunch.prepareCodexPinnedLaunchHome(home)
        })
    },
    listCodexSessionHomes: () => codexRuntimeHome.getHostCodexHomePathsForSessionDiscovery(),
    attachToRuntime: (runtime) => {
      attachedRuntime = runtime
      runtime.setAccountServices({
        claudeAccounts: services.claudeAccounts,
        codexAccounts: services.codexAccounts,
        rateLimits: services.rateLimits
      })
      runtime.setCommitMessageAgentEnvironmentResolvers({
        prepareForCodexLaunch: prepareCodexHome,
        prepareForClaudeLaunch: prepareClaudeAuth,
        resolveBaseEnvironment: () => resolveHostAgentBaseEnvironment(store.getSettings())
      })
    }
  }
}
