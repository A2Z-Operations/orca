import type { ClaudeEnvPatch } from '../environment'
import type { ClaudeModelSource, ClaudePolicyModel } from '../claude-model-policy'

export type ClaudeRuntimeAuthPreparation = {
  configDir: string
  runtime?: 'host' | 'wsl'
  wslDistro?: string | null
  wslLinuxConfigDir?: string | null
  envPatch: ClaudeEnvPatch
  provenance: string
  /** Report unavailable usage without throwing out the entire polling cycle. */
  usageError?: string
  /** The account pool chose this launch, including when it fell back to the selected account. */
  pooled?: boolean
  /** The model the policy wants for this account, before a user pin. */
  policyModel?: { model: ClaudePolicyModel; modelId: string; reason: string }
  /** What the child actually runs. Set while the launch env is stamped. */
  appliedModel?: { model: string; modelSource: ClaudeModelSource }
}
