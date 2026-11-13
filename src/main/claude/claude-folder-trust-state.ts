import { posix, win32 } from 'node:path'
export type ClaudeTrustPathStyle = 'posix' | 'win32'

export type ClaudeFolderTrustOutcome =
  | 'granted'
  | 'unchanged'
  | 'missing-config'
  | 'locked'
  | 'unreadable'

export type ClaudeConfigEnv = {
  CLAUDE_CONFIG_DIR?: string
  CLAUDE_CODE_CUSTOM_OAUTH_URL?: string
}

/** Claude looks up NFC `path.normalize` output, with `/` separators on Windows. */
export function toClaudeTrustKey(folderPath: string, style: ClaudeTrustPathStyle): string {
  const normalized = (style === 'win32' ? win32 : posix).normalize(folderPath.normalize('NFC'))
  return style === 'win32' ? normalized.replaceAll('\\', '/') : normalized
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export type ClaudeGlobalConfigChange =
  | { kind: 'unchanged' }
  | { kind: 'refuse' }
  | { kind: 'changed'; config: Record<string, unknown> }

export function applyClaudeFolderTrust(
  config: Record<string, unknown>,
  folderKeys: readonly string[]
): ClaudeGlobalConfigChange {
  if (config.projects !== undefined && !isPlainObject(config.projects)) {
    return { kind: 'refuse' }
  }
  const projects: Record<string, unknown> = { ...config.projects }
  const alreadyTrusted = folderKeys.some((key) => {
    const entry = projects[key]
    return isPlainObject(entry) && entry.hasTrustDialogAccepted === true
  })
  if (alreadyTrusted) {
    return { kind: 'unchanged' }
  }
  for (const key of folderKeys) {
    const entry = projects[key]
    projects[key] = isPlainObject(entry)
      ? { ...entry, hasTrustDialogAccepted: true }
      : { hasTrustDialogAccepted: true }
  }
  return { kind: 'changed', config: { ...config, projects } }
}
