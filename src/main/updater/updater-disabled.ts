import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

export type UpdaterDisabledInputs = {
  env: NodeJS.ProcessEnv
  isPackaged: boolean
  resourcesPath: string | undefined
  exists: (path: string) => boolean
}

/**
 * BLOWZER: a self-built Orca must never check for, download or install a stock release — the release feed
 * would offer the next upstream build and silently drop our patches. Two signals switch the updater off:
 * `ORCA_UPDATER_DISABLED=1` in the environment, or a packaged app without `Resources/app-update.yml`
 * (what `ORCA_NO_PUBLISH=1` builds). Returns the reason, or null when updates stay on.
 */
export function resolveUpdaterDisabledReason(inputs: UpdaterDisabledInputs): string | null {
  if (inputs.env.ORCA_UPDATER_DISABLED === '1') {
    return 'ORCA_UPDATER_DISABLED=1'
  }
  if (
    inputs.isPackaged &&
    inputs.resourcesPath &&
    !inputs.exists(join(inputs.resourcesPath, 'app-update.yml'))
  ) {
    return 'self-built app without app-update.yml'
  }
  return null
}

let cached: string | null | undefined

export function updaterDisabledReason(): string | null {
  if (cached === undefined) {
    cached = resolveUpdaterDisabledReason({
      env: process.env,
      isPackaged: app?.isPackaged === true,
      resourcesPath: process.resourcesPath,
      exists: existsSync
    })
  }
  return cached
}
