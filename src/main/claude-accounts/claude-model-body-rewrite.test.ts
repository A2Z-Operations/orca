import { describe, expect, it } from 'vitest'
import {
  CLAUDE_MODEL_REWRITE_BUFFER_CAP,
  rewriteClaudeModelBody,
  rewriteClaudeModelStreaming
} from './claude-model-body-rewrite'
import { CLAUDE_FABLE_MODEL_ID, CLAUDE_OPUS_MODEL_ID } from './claude-model-policy'

function body(value: unknown): Buffer {
  return Buffer.from(JSON.stringify(value))
}

describe('rewriteClaudeModelBody', () => {
  it('rewrites only the top-level model and maps fields that 400', () => {
    const rewritten = rewriteClaudeModelBody(
      body({
        model: CLAUDE_FABLE_MODEL_ID,
        thinking: { type: 'enabled', budget_tokens: 1024 },
        tool_choice: { type: 'any' },
        output_config: { effort: 'high' },
        messages: [{ role: 'user', content: 'hi', model: CLAUDE_FABLE_MODEL_ID }]
      }),
      CLAUDE_OPUS_MODEL_ID
    )
    expect(rewritten.mode).toBe('buffer')
    expect(rewritten.rewritten).toBe(true)
    expect(rewritten.body.length).toBe(Buffer.byteLength(rewritten.body))
    const parsed = JSON.parse(rewritten.body.toString('utf8'))
    expect(parsed.model).toBe(CLAUDE_OPUS_MODEL_ID)
    expect(parsed.messages[0].model).toBe(CLAUDE_FABLE_MODEL_ID)
    expect(parsed.thinking).toEqual({ type: 'adaptive' })
    expect(parsed.tool_choice).toEqual({ type: 'auto' })
    expect(parsed.output_config).toEqual({ effort: 'high' })
  })

  it('leaves a non-policy model, a matching model, and a non-JSON body alone', () => {
    const sonnet = body({ model: 'claude-sonnet-4-5', messages: [] })
    expect(rewriteClaudeModelBody(sonnet, CLAUDE_OPUS_MODEL_ID).rewritten).toBe(false)
    const same = body({ model: CLAUDE_OPUS_MODEL_ID })
    const kept = rewriteClaudeModelBody(same, CLAUDE_OPUS_MODEL_ID)
    expect(kept.rewritten).toBe(false)
    expect(kept.body).toBe(same)
    const text = Buffer.from('not-json')
    expect(rewriteClaudeModelBody(text, CLAUDE_OPUS_MODEL_ID).body).toBe(text)
  })

  it('rewrites an alias and reports the new length', () => {
    const rewritten = rewriteClaudeModelBody(body({ model: 'fable', n: 1 }), CLAUDE_OPUS_MODEL_ID)
    expect(JSON.parse(rewritten.body.toString('utf8')).model).toBe(CLAUDE_OPUS_MODEL_ID)
    expect(rewritten.body.length).not.toBe(body({ model: 'fable', n: 1 }).length)
  })
})

describe('rewriteClaudeModelStreaming', () => {
  it('swaps the top-level model string and keeps a nested model and the rest of the bytes', () => {
    const source = body({
      model: CLAUDE_OPUS_MODEL_ID,
      messages: [{ model: CLAUDE_OPUS_MODEL_ID, content: 'leave "model":"x"' }],
      stream: true
    })
    const rewritten = rewriteClaudeModelStreaming(source, CLAUDE_FABLE_MODEL_ID)
    expect(rewritten.mode).toBe('stream')
    const text = rewritten.body.toString('utf8')
    expect(text).toContain(`"model":"${CLAUDE_FABLE_MODEL_ID}"`)
    expect(text).toContain(`"model":"${CLAUDE_OPUS_MODEL_ID}"`)
    expect(JSON.parse(text).messages[0].model).toBe(CLAUDE_OPUS_MODEL_ID)
    expect(rewritten.body.length - source.length).toBe(
      CLAUDE_FABLE_MODEL_ID.length - CLAUDE_OPUS_MODEL_ID.length
    )
  })

  it('changes Content-Length when the alias is shorter than the target id', () => {
    const source = Buffer.from('{"model":"opus","messages":[]}')
    const rewritten = rewriteClaudeModelStreaming(source, CLAUDE_FABLE_MODEL_ID)
    expect(rewritten.body.toString('utf8')).toBe(
      `{"model":"${CLAUDE_FABLE_MODEL_ID}","messages":[]}`
    )
    expect(rewritten.body.length).toBe(
      source.length + (CLAUDE_FABLE_MODEL_ID.length - 'opus'.length)
    )
  })

  it('is the path a body over the cap would take', () => {
    expect(CLAUDE_MODEL_REWRITE_BUFFER_CAP).toBe(8 * 1024 * 1024)
  })
})
