import { claudePolicyModelLabel, type ClaudePolicyModel } from './claude-model-policy'

/** Bodies at or under this size are parsed. Larger ones only swap the top-level model string. */
export const CLAUDE_MODEL_REWRITE_BUFFER_CAP = 8 * 1024 * 1024

export type ClaudeModelRewrite = {
  body: Buffer
  rewritten: boolean
  /** `buffer` parsed JSON. `stream` swapped the model string. `passthrough` left the bytes alone. */
  mode: 'buffer' | 'stream' | 'passthrough'
}

/**
 * Rewrite a JSON request body to `targetModelId`.
 * Under the cap, parse and also map fields that 400 on Fable and Opus 5.5.
 * Over the cap, replace only the top-level `"model"` string.
 * A non-JSON body, or a model that is not a policy id, is returned unchanged.
 */
export function rewriteClaudeModelBody(body: Buffer, targetModelId: string): ClaudeModelRewrite {
  if (!looksLikeJson(body)) {
    return { body, rewritten: false, mode: 'passthrough' }
  }
  if (body.length > CLAUDE_MODEL_REWRITE_BUFFER_CAP) {
    return rewriteStreaming(body, targetModelId)
  }
  return rewriteBuffered(body, targetModelId)
}

/** The over-cap path, exposed so tests can force it on a small body. */
export function rewriteClaudeModelStreaming(
  body: Buffer,
  targetModelId: string
): ClaudeModelRewrite {
  if (!looksLikeJson(body)) {
    return { body, rewritten: false, mode: 'passthrough' }
  }
  return rewriteStreaming(body, targetModelId)
}

function rewriteBuffered(body: Buffer, targetModelId: string): ClaudeModelRewrite {
  let parsed: unknown
  try {
    parsed = JSON.parse(body.toString('utf8'))
  } catch {
    return { body, rewritten: false, mode: 'passthrough' }
  }
  const record = jsonObject(parsed)
  if (!record) {
    return { body, rewritten: false, mode: 'passthrough' }
  }
  const current = typeof record.model === 'string' ? record.model : null
  if (!shouldRewriteModel(current, targetModelId)) {
    return { body, rewritten: false, mode: 'passthrough' }
  }
  record.model = targetModelId
  mapModelSpecificFields(record)
  return {
    body: Buffer.from(JSON.stringify(record)),
    rewritten: true,
    mode: 'buffer'
  }
}

function rewriteStreaming(body: Buffer, targetModelId: string): ClaudeModelRewrite {
  const text = body.toString('utf8')
  const span = findTopLevelStringField(text, 'model')
  if (!span) {
    return { body, rewritten: false, mode: 'passthrough' }
  }
  const current = text.slice(span.valueStart, span.valueEnd)
  if (!shouldRewriteModel(current, targetModelId)) {
    return { body, rewritten: false, mode: 'passthrough' }
  }
  const next = text.slice(0, span.valueStart) + targetModelId + text.slice(span.valueEnd)
  return { body: Buffer.from(next), rewritten: true, mode: 'stream' }
}

function shouldRewriteModel(current: string | null, targetModelId: string): current is string {
  if (!current) {
    return false
  }
  const family = claudePolicyModelLabel(current)
  const target = claudePolicyModelLabel(targetModelId)
  return family !== null && target !== null && family !== target
}

/**
 * Fable and Opus 5.5 reject manual thinking and a forced tool choice.
 * Only called after the model itself is changing. Effort and betas are left alone.
 */
function mapModelSpecificFields(record: Record<string, unknown>): void {
  const thinking = jsonObject(record.thinking)
  if (thinking && (thinking.type === 'disabled' || thinking.type === 'enabled')) {
    delete thinking.budget_tokens
    record.thinking = { ...thinking, type: 'adaptive' }
  }
  const toolChoice = record.tool_choice
  if (typeof toolChoice === 'string' && (toolChoice === 'any' || toolChoice === 'tool')) {
    record.tool_choice = { type: 'auto' }
    return
  }
  const choice = jsonObject(toolChoice)
  if (choice && (choice.type === 'any' || choice.type === 'tool')) {
    record.tool_choice = { type: 'auto' }
  }
}

function jsonObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  return Object.fromEntries(Object.entries(value))
}

function looksLikeJson(body: Buffer): boolean {
  const start = body.toString('utf8', 0, Math.min(body.length, 16)).trimStart()
  return start.startsWith('{')
}

/** Byte span of a depth-1 string field's value, excluding the quotes. */
function findTopLevelStringField(
  source: string,
  field: string
): { valueStart: number; valueEnd: number } | null {
  let depth = 0
  let inString = false
  let escape = false
  let stringStart = -1
  let expectingKey = true
  let pendingField = false
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i]
    if (inString) {
      if (escape) {
        escape = false
        continue
      }
      if (char === '\\') {
        escape = true
        continue
      }
      if (char !== '"') {
        continue
      }
      inString = false
      if (depth === 1 && expectingKey) {
        pendingField = source.slice(stringStart, i) === field
        expectingKey = false
      } else if (depth === 1 && pendingField) {
        return { valueStart: stringStart, valueEnd: i }
      }
      continue
    }
    if (char === '"') {
      inString = true
      stringStart = i + 1
      continue
    }
    if (char === '{' || char === '[') {
      depth += 1
      if (char === '{') {
        expectingKey = true
      }
      pendingField = false
      continue
    }
    if (char === '}' || char === ']') {
      depth -= 1
      pendingField = false
      continue
    }
    if (char === ',' && depth === 1) {
      expectingKey = true
      pendingField = false
    }
  }
  return null
}

export function claudeModelFamilyOf(value: string): ClaudePolicyModel | null {
  return claudePolicyModelLabel(value)
}
