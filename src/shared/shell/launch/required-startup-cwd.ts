import {
  isWindowsAbsolutePathLike,
  normalizeRuntimePathForComparison
} from '../../cross-platform-path'

export class RequiredStartupCwdError extends Error {
  constructor(readonly reason: 'no-cwd' | 'cwd-missing') {
    super(`terminal_required_startup_${reason}`)
    this.name = 'RequiredStartupCwdError'
  }
}

export function matchesRequiredStartupCwd(actual: string | undefined, required: string): boolean {
  return Boolean(
    actual &&
    (required.startsWith('/') || isWindowsAbsolutePathLike(required)) &&
    normalizeRuntimePathForComparison(actual) === normalizeRuntimePathForComparison(required)
  )
}
