import type { ClaudeModelPolicyEvaluation } from './managed-account-types'

/**
 * Live sessions the policy leaves on their own model because they were launched with one:
 * `pinned` (`--model` or `ANTHROPIC_MODEL`) and `not-policy` (no model recorded at launch).
 */
export function claudeFixedModelSessionCount(
  evaluations: readonly ClaudeModelPolicyEvaluation[] | undefined
): number {
  return (evaluations ?? []).filter((row) => row.skip === 'pinned' || row.skip === 'not-policy')
    .length
}
