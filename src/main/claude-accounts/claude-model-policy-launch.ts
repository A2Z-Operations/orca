import {
  claudePolicyModelLabel,
  type ClaudeModelSource,
  type ClaudePolicyModel
} from './claude-model-policy'

export type ClaudeLaunchPolicyModel = {
  model: ClaudePolicyModel
  modelId: string
  reason: string
}

export type ClaudeLaunchAppliedModel = {
  model: string
  modelSource: ClaudeModelSource
}

/** `--model`, `--model=`, `-m`, or `-m=` as its own argument. */
const MODEL_FLAG = /(?:^|\s)(?:--model(?:=|\s+)|-m(?:=|\s+))(\S+)/

/** The model the launch command or the shell already chose. Empty means unset. */
export function claudeLaunchModelPin(
  command: string | undefined,
  env: Record<string, string | undefined> | undefined
): string | null {
  const flagged = command ? MODEL_FLAG.exec(command)?.[1] : undefined
  if (flagged) {
    return flagged
  }
  const fromEnv = env?.ANTHROPIC_MODEL?.trim()
  return fromEnv ? fromEnv : null
}

/**
 * A user pin wins and is not injected. Otherwise the policy id is the value to set on
 * `ANTHROPIC_MODEL`. Null when the policy is off or there is nothing to record.
 */
export function resolveClaudeLaunchModel(input: {
  env: Record<string, string | undefined> | undefined
  command?: string
  policy: ClaudeLaunchPolicyModel | null | undefined
}): (ClaudeLaunchAppliedModel & { inject: string | null }) | null {
  const pin = claudeLaunchModelPin(input.command, input.env)
  if (pin) {
    return {
      model: claudePolicyModelLabel(pin) ?? pin,
      modelSource: 'pinned',
      inject: null
    }
  }
  if (!input.policy || input.policy.reason === 'off') {
    return null
  }
  return {
    model: input.policy.model,
    modelSource: 'policy',
    inject: input.policy.modelId
  }
}
