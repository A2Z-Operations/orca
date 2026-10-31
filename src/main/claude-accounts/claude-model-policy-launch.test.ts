import { describe, expect, it } from 'vitest'
import { CLAUDE_FABLE_MODEL_ID, CLAUDE_OPUS_MODEL_ID } from './claude-model-policy'
import { claudeLaunchModelPin, resolveClaudeLaunchModel } from './claude-model-policy-launch'

const policy = {
  model: 'fable' as const,
  modelId: CLAUDE_FABLE_MODEL_ID,
  reason: 'fable-headroom'
}

describe('resolveClaudeLaunchModel', () => {
  it('injects the policy id when the launch did not choose a model', () => {
    expect(resolveClaudeLaunchModel({ env: { PATH: '/bin' }, policy })).toEqual({
      model: 'fable',
      modelSource: 'policy',
      inject: CLAUDE_FABLE_MODEL_ID
    })
  })

  it('keeps an explicit --model and does not inject', () => {
    expect(
      resolveClaudeLaunchModel({
        env: {},
        command: 'claude --model claude-sonnet-4-6',
        policy
      })
    ).toEqual({ model: 'claude-sonnet-4-6', modelSource: 'pinned', inject: null })
    expect(claudeLaunchModelPin('claude -m=claude-opus-5-5', {})).toBe(CLAUDE_OPUS_MODEL_ID)
  })

  it('keeps a shell ANTHROPIC_MODEL', () => {
    expect(
      resolveClaudeLaunchModel({
        env: { ANTHROPIC_MODEL: 'claude-haiku-4-5' },
        policy
      })
    ).toEqual({ model: 'claude-haiku-4-5', modelSource: 'pinned', inject: null })
  })

  it('injects nothing when the policy is off', () => {
    expect(
      resolveClaudeLaunchModel({
        env: {},
        policy: { model: 'opus', modelId: CLAUDE_OPUS_MODEL_ID, reason: 'off' }
      })
    ).toBeNull()
  })
})
