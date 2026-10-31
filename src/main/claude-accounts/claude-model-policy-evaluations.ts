import type { ClaudeModelPolicyEvaluation } from '../../shared/managed-account-types'

/** Latest pass per live pane. The status command reads this; a later pass replaces it. */
const rows: ClaudeModelPolicyEvaluation[] = []

export function replaceClaudeModelPolicyEvaluations(
  next: readonly ClaudeModelPolicyEvaluation[]
): void {
  rows.length = 0
  rows.push(...next)
}

export function claudeModelPolicyEvaluations(): ClaudeModelPolicyEvaluation[] {
  return rows.map((row) => ({ ...row }))
}

export function resetClaudeModelPolicyEvaluations(): void {
  rows.length = 0
}
