import { delimiter } from 'node:path'
import { getAgentLaunchExecutableName } from '../../../../shared/agent-command-line-intent'
import {
  durableJobBinDir,
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

export function applyDurableBackgroundJobEnv(
  env: Record<string, string>,
  opts: BuildPtyHostEnvOptions
): void {
  stripPluginDir(env, env.ORCA_DURABLE_JOB_PLUGIN_DIR)
  delete env.ORCA_DURABLE_JOB_PLUGIN_DIR
  const binDir = durableJobBinDir(opts.userDataPath)
  withoutBinDir(env, binDir)
  if (
    process.platform === 'win32' ||
    opts.isWsl ||
    !launchesClaude(opts) ||
    process.env.ORCA_DURABLE_JOBS === '0'
  ) {
    return
  }
  const pluginDir = ensureDurableBackgroundJobPlugin(opts.userDataPath)
  if (!pluginDir) {
    return
  }
  const paths = (env.CLAUDE_CODE_PLUGIN_DIRS ?? '')
    .split(delimiter)
    .map((path) => path.trim())
    .filter(Boolean)
  if (!paths.includes(pluginDir)) {
    paths.push(pluginDir)
  }
  env.CLAUDE_CODE_PLUGIN_DIRS = paths.join(delimiter)
  env.ORCA_DURABLE_JOB_PLUGIN_DIR = pluginDir
  prependBinDir(env, binDir)
}
