import { DurableJobIndex, durableJobRoot } from './pane-ownership-durable'
import { readLinuxFds, readMacFds } from './pane-ownership-fds'
import { readLinuxKeepMarkers, readMacKeepMarkers } from './pane-ownership-marker'
import { readPaneOwnershipMode } from './pane-ownership-mode'
import { PaneOwnershipObserver } from './pane-ownership-observer'
import type { LiveAgentRoot } from './pane-ownership-sets'
import { readLinuxStartTicks, readOwnershipTable } from './pane-ownership-table'

/**
 * Builds the #44 stage 2 observer for this OS: macOS reads fds through one lsof helper process, Linux through /proc.
 * Windows has no sampler (the owned job is the set), so it gets none. Observe only: see pane-ownership-observer.ts.
 */
export function paneOwnershipFor(
  config:
    | {
        log: (event: string, details: Record<string, unknown>) => void
        /** The one-word mode file, re-read every tick; null = env var or the default (observe). */
        modeFilePath: string | null
      }
    | undefined,
  listAgentRoots: () => LiveAgentRoot[],
  overrides: { platform?: NodeJS.Platform; env?: NodeJS.ProcessEnv } = {}
): PaneOwnershipObserver | null {
  if (!config) {
    return null
  }
  const options = { ...config, ...overrides, listAgentRoots }
  const platform = options.platform ?? process.platform
  if (platform !== 'darwin' && platform !== 'linux') {
    return null
  }
  const env = options.env ?? process.env
  const hostUid = process.getuid?.()
  if (hostUid === undefined) {
    return null
  }
  const durableJobs = new DurableJobIndex(durableJobRoot(env, platform))
  return new PaneOwnershipObserver({
    listAgentRoots: options.listAgentRoots,
    readTable: () => readOwnershipTable(),
    readFds:
      platform === 'darwin'
        ? (pids, fds) => readMacFds(pids, fds)
        : (pids, fds) => readLinuxFds(pids, fds),
    readStartTicks: platform === 'linux' ? (pid) => readLinuxStartTicks(pid) : null,
    readKeepMarkers:
      platform === 'darwin'
        ? (targets) => readMacKeepMarkers(targets)
        : (targets) => readLinuxKeepMarkers(targets),
    listDurableJobs: () => durableJobs.refresh(),
    readMode: () => readPaneOwnershipMode(env, options.modeFilePath),
    log: options.log,
    hostUid,
    hostPid: process.pid
  })
}
