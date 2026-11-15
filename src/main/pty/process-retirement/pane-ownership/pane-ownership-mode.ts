import { readFile } from 'node:fs/promises'

/**
 * Pane process ownership (#44), stage 2: the only modes that exist are `off` and `observe`. There is no kill mode in this
 * code at all (stage 4), so a request for `kill` reads as `observe` and is reported once by the observer.
 */
export type PaneOwnershipMode = 'off' | 'observe'

export type PaneOwnershipModeRead = {
  mode: PaneOwnershipMode
  /** What was asked for, lower-cased, when it was not exactly the mode in effect; null when nothing was set. */
  requested: string | null
}

export const PANE_OWNERSHIP_MODE_ENV = 'ORCA_PANE_DESCENDANT_OWNERSHIP'

/** Missing, empty, unknown and `kill` all read as `observe`; only an explicit `off` turns the sampler off. */
export function parsePaneOwnershipMode(raw: string | null | undefined): PaneOwnershipModeRead {
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  if (value === 'off') {
    return { mode: 'off', requested: null }
  }
  if (value === '' || value === 'observe') {
    return { mode: 'observe', requested: null }
  }
  return { mode: 'observe', requested: value }
}

/**
 * The environment variable wins when it is set to something; otherwise the one-word mode file, re-read on every call, so
 * `off` takes effect at the next tick without restarting the terminal host (a GUI-launched host has no shell env).
 * An unreadable file is the same as a missing one: observe.
 */
export async function readPaneOwnershipMode(
  env: NodeJS.ProcessEnv,
  modeFilePath: string | null,
  read: (path: string) => Promise<string> = (path) => readFile(path, 'utf8')
): Promise<PaneOwnershipModeRead> {
  const fromEnv = env[PANE_OWNERSHIP_MODE_ENV]
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') {
    return parsePaneOwnershipMode(fromEnv)
  }
  if (!modeFilePath) {
    return parsePaneOwnershipMode(null)
  }
  try {
    return parsePaneOwnershipMode(await read(modeFilePath))
  } catch {
    return parsePaneOwnershipMode(null)
  }
}
