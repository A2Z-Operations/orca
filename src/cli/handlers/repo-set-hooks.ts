import type { RepoHookSettings, SetupRunPolicy } from '../../shared/orca-yaml-hook-types'
import type { CommandHandler } from '../dispatch'
import { printResult } from '../format'
import { getPresentStringFlag, getRequiredStringFlag } from '../flags'
import { RuntimeClientError } from '../runtime/types'

const SETUP_RUN_POLICIES: readonly SetupRunPolicy[] = ['ask', 'run-by-default', 'skip-by-default']

type RepoShowResult = {
  repo: { hookSettings?: Partial<RepoHookSettings> } & Record<string, unknown>
}

export type RepoHookSettingsResult = {
  repo: { id: unknown; displayName: unknown; path: unknown }
  hookSettings: RepoHookSettings | null
}

export type RepoSetHooksRequest = {
  setup?: string
  archive?: string
  setupPolicy?: SetupRunPolicy
  clearSetup: boolean
  clearArchive: boolean
}

function isSetupRunPolicy(value: string): value is SetupRunPolicy {
  return SETUP_RUN_POLICIES.some((policy) => policy === value)
}

function parseSetupPolicy(value: string | undefined): SetupRunPolicy | undefined {
  if (value === undefined) {
    return undefined
  }
  if (!isSetupRunPolicy(value)) {
    throw new RuntimeClientError(
      'invalid_argument',
      `--setup-policy must be ${SETUP_RUN_POLICIES.join(', ')}.`
    )
  }
  return value
}

export function readRepoSetHooksRequest(flags: Map<string, string | boolean>): RepoSetHooksRequest {
  const request: RepoSetHooksRequest = {
    setup: getPresentStringFlag(flags, 'setup'),
    archive: getPresentStringFlag(flags, 'archive'),
    setupPolicy: parseSetupPolicy(getPresentStringFlag(flags, 'setup-policy')),
    clearSetup: flags.get('clear-setup') === true,
    clearArchive: flags.get('clear-archive') === true
  }
  if (request.setup !== undefined && request.clearSetup) {
    throw new RuntimeClientError(
      'invalid_argument',
      '--setup and --clear-setup cannot be combined.'
    )
  }
  if (request.archive !== undefined && request.clearArchive) {
    throw new RuntimeClientError(
      'invalid_argument',
      '--archive and --clear-archive cannot be combined.'
    )
  }
  const hasChange =
    request.setup !== undefined ||
    request.archive !== undefined ||
    request.setupPolicy !== undefined ||
    request.clearSetup ||
    request.clearArchive
  if (!hasChange) {
    throw new RuntimeClientError(
      'invalid_argument',
      'Missing required --setup, --archive, --setup-policy, --clear-setup, or --clear-archive'
    )
  }
  return request
}

/** Merge onto the stored settings: repo.update replaces hookSettings whole, so every untouched field must be carried over. */
export function mergeRepoHookSettings(
  current: Partial<RepoHookSettings> | undefined,
  request: RepoSetHooksRequest
): RepoHookSettings {
  const scripts = {
    setup: request.clearSetup ? '' : (request.setup ?? current?.scripts?.setup ?? ''),
    archive: request.clearArchive ? '' : (request.archive ?? current?.scripts?.archive ?? '')
  }
  const setupRunPolicy = request.setupPolicy ?? current?.setupRunPolicy ?? 'run-by-default'
  return { ...current, mode: current?.mode ?? 'auto', setupRunPolicy, scripts }
}

/** The runtime returns the object it stored; anything else means the write left no hookSettings. */
function readStoredHookSettings(
  value: Partial<RepoHookSettings> | undefined
): RepoHookSettings | null {
  if (!value || !value.scripts || !value.mode) {
    return null
  }
  return { ...value, mode: value.mode, scripts: value.scripts }
}

export function formatRepoHookSettings(result: RepoHookSettingsResult): string {
  const hooks = result.hookSettings
  const lines = [`repo: ${String(result.repo.id)}  ${String(result.repo.displayName)}`]
  if (!hooks) {
    lines.push('hookSettings: none')
    return lines.join('\n')
  }
  lines.push(
    `setupRunPolicy: ${String(hooks.setupRunPolicy ?? 'run-by-default')}`,
    `commandSourcePolicy: ${String(hooks.commandSourcePolicy ?? 'auto')}`,
    `setup: ${hooks.scripts?.setup ? JSON.stringify(hooks.scripts.setup) : '(none)'}`,
    `archive: ${hooks.scripts?.archive ? JSON.stringify(hooks.scripts.archive) : '(none)'}`
  )
  return lines.join('\n')
}

export const REPO_SET_HOOKS_HANDLERS: Record<string, CommandHandler> = {
  'repo set-hooks': async ({ flags, client, json }) => {
    const repo = getRequiredStringFlag(flags, 'repo')
    const request = readRepoSetHooksRequest(flags)
    const shown = await client.call<RepoShowResult>('repo.show', { repo })
    const hookSettings = mergeRepoHookSettings(shown.result.repo.hookSettings, request)
    const updated = await client.call<RepoShowResult>('repo.update', {
      repo,
      updates: { hookSettings }
    })
    const stored = updated.result.repo
    printResult(
      {
        ...updated,
        result: {
          repo: { id: stored.id, displayName: stored.displayName, path: stored.path },
          hookSettings: readStoredHookSettings(stored.hookSettings)
        }
      },
      json,
      formatRepoHookSettings
    )
  }
}
