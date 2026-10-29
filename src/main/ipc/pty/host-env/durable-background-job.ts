import { delimiter } from 'node:path'
import { getAgentLaunchExecutableName } from '../../../../shared/agent-command-line-intent'
import { ensureDurableBackgroundJobPlugin } from '../../../claude/durable-background-job-plugin'
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

export function applyDurableBackgroundJobEnv(
  env: Record<string, string>,
  opts: BuildPtyHostEnvOptions
): void {
  stripPluginDir(env, env.ORCA_DURABLE_JOB_PLUGIN_DIR)
  delete env.ORCA_DURABLE_JOB_PLUGIN_DIR
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
}
