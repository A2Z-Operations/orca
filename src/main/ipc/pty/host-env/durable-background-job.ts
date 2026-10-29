import { delimiter } from 'node:path'
import { getAgentLaunchExecutableName } from '../../../../shared/agent-command-line-intent'
import {
  durableJobBinDir,
  durableJobWslBinDir,
  durableJobWslPluginDir,
  ensureDurableBackgroundJobPlugin
} from '../../../claude/durable-background-job-plugin'
import type { BuildPtyHostEnvOptions } from './types'

function launchesClaude(opts: BuildPtyHostEnvOptions): boolean {
  return (
    opts.launchAgent === 'claude' || getAgentLaunchExecutableName(opts.launchCommand) === 'claude'
  )
}

function stripPluginDir(env: Record<string, string>, pluginDir: string | undefined): void {
  if (!pluginDir) {
    return
  }
  const paths = env.CLAUDE_CODE_PLUGIN_DIRS
  if (!paths?.split(delimiter).includes(pluginDir)) {
    return
  }
  env.CLAUDE_CODE_PLUGIN_DIRS = paths
    .split(delimiter)
    .filter((path) => path !== pluginDir)
    .join(delimiter)
}

function withoutBinDir(env: Record<string, string>, binDir: string): void {
  const pathKey = 'PATH'
  const current = env[pathKey]
  if (!current?.split(delimiter).includes(binDir)) {
    return
  }
  env[pathKey] = current
    .split(delimiter)
    .filter((entry) => entry !== binDir)
    .join(delimiter)
}

function prependBinDir(env: Record<string, string>, binDir: string): void {
  const pathKey = 'PATH'
  const inherited = (env[pathKey] ?? '')
    .split(delimiter)
    .filter((entry) => entry.length > 0 && entry !== binDir)
  env[pathKey] = [binDir, ...inherited].join(delimiter)
}

export type DurableJobInjectionTarget = 'skip' | 'posix' | 'windows' | 'wsl'

/** Pure platform choice. WSL wins over win32 because the guest, not the host shell, runs the waiter. */
export function durableJobInjectionTarget(input: {
  platform: NodeJS.Platform
  isWsl: boolean
  launchesClaude: boolean
  disabled: boolean
}): DurableJobInjectionTarget {
  if (!input.launchesClaude || input.disabled) {
    return 'skip'
  }
  if (input.isWsl) {
    return 'wsl'
  }
  if (input.platform === 'win32') {
    return 'windows'
  }
  return 'posix'
}

export function applyDurableBackgroundJobEnv(
  env: Record<string, string>,
  opts: BuildPtyHostEnvOptions
): void {
  stripPluginDir(env, env.ORCA_DURABLE_JOB_PLUGIN_DIR)
  delete env.ORCA_DURABLE_JOB_PLUGIN_DIR
  const binDir = durableJobBinDir(opts.userDataPath)
  const wslBinDir = durableJobWslBinDir(opts.userDataPath)
  withoutBinDir(env, binDir)
  withoutBinDir(env, wslBinDir)
  const target = durableJobInjectionTarget({
    platform: process.platform,
    isWsl: opts.isWsl === true,
    launchesClaude: launchesClaude(opts),
    disabled: process.env.ORCA_DURABLE_JOBS === '0'
  })
  if (target === 'skip') {
    return
  }
  const pluginDir = ensureDurableBackgroundJobPlugin(opts.userDataPath)
  if (!pluginDir) {
    return
  }
  // Guest Claude reads a linux path. WSLENV /p on the Windows path translates it; do not put PATH in WSLENV.
  const publishedPlugin = target === 'wsl' ? durableJobWslPluginDir(pluginDir) : pluginDir
  const publishedBin = target === 'wsl' ? wslBinDir : binDir
  const paths = (env.CLAUDE_CODE_PLUGIN_DIRS ?? '')
    .split(delimiter)
    .map((path) => path.trim())
    .filter(Boolean)
  if (!paths.includes(publishedPlugin)) {
    paths.push(publishedPlugin)
  }
  env.CLAUDE_CODE_PLUGIN_DIRS = paths.join(delimiter)
  env.ORCA_DURABLE_JOB_PLUGIN_DIR = publishedPlugin
  prependBinDir(env, publishedBin)
}
