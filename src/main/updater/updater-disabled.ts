import { existsSync } from 'node:fs'
import { join } from 'node:path'

export type UpdaterDisabledInputs = {
  env: NodeJS.ProcessEnv
  isPackaged: boolean
  resourcesPath: string | undefined
  exists: (path: string) => boolean
}

/**
 * A self-built app must not check for, download, or install a stock release. The release feed
 * would offer the next upstream build and drop local patches. Two signals switch the updater off:
 * `ORCA_UPDATER_DISABLED=1`, or a packaged app without `Resources/app-update.yml`
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

/** Electron sets this on a packaged process. Plain Node leaves it absent. */
type PackagedProcess = NodeJS.Process & {
  readonly resourcesPath?: string
  readonly defaultApp?: boolean
}

function packagedProcess(proc: PackagedProcess): PackagedProcess {
  return proc
}

let cached: string | null | undefined

export function updaterDisabledReason(): string | null {
  if (cached === undefined) {
    const proc = packagedProcess(process)
    cached = resolveUpdaterDisabledReason({
      env: proc.env,
      // Packaged Electron sets versions.electron. `electron .` sets defaultApp, so that is not a packaged app.
      isPackaged: typeof proc.versions.electron === 'string' && proc.defaultApp !== true,
      resourcesPath: proc.resourcesPath,
      exists: existsSync
    })
  }
  return cached
}
