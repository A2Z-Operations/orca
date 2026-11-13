import type { Stats } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { basename, dirname } from 'node:path'
import { isDefinitiveAbsence } from '../../shared/definitive-filesystem-absence'

export type ClaudeConfigProbe = Stats | 'missing' | 'unreadable'

export function failedClaudeConfigProbe(error: unknown): ClaudeConfigProbe {
  return isDefinitiveAbsence(error) ? 'missing' : 'unreadable'
}

/** Claude Code 2.1.323 z_: nonempty legacy wins; empty legacy normally yields to current. */
export function selectsLegacyClaudeConfig(
  legacy: ClaudeConfigProbe,
  current: ClaudeConfigProbe,
  listed: boolean
): boolean {
  if (typeof legacy === 'string' || !legacy.isFile()) {
    return false
  }
  if (legacy.size === 0 && (legacy.mode & 0o222) === 0) {
    return false
  }
  if (current === 'missing') {
    return true
  }
  if (current === 'unreadable') {
    return legacy.size === 0 || listed
  }
  if (legacy.size > 0) {
    return !current.isFile() || current.size === 0 || listed
  }
  return (
    process.platform === 'linux' &&
    current.isFile() &&
    current.size === 0 &&
    (current.mode & 0o222) === 0 &&
    current.nlink === 1
  )
}

export async function selectClaudeGlobalConfigFileAsync(
  legacy: string,
  current: string
): Promise<string> {
  const [oldStat, newStat, listed] = await Promise.all([
    stat(legacy).catch(failedClaudeConfigProbe),
    stat(current).catch(failedClaudeConfigProbe),
    readdir(dirname(legacy)).then(
      (names) => names.includes(basename(legacy)),
      (error: unknown) => !isDefinitiveAbsence(error)
    )
  ])
  return selectsLegacyClaudeConfig(oldStat, newStat, listed) ? legacy : current
}
