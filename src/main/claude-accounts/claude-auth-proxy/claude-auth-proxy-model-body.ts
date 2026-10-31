import type { IncomingMessage } from 'node:http'
import {
  CLAUDE_MODEL_REWRITE_BUFFER_CAP,
  rewriteClaudeModelBody,
  rewriteClaudeModelStreaming,
  type ClaudeModelRewrite
} from '../claude-model-body-rewrite'
import { claudeModelId, claudePolicyModelLabel } from '../claude-model-policy'

export type ClaudeProxySlotModel = {
  model: string
  modelSource: 'policy' | 'pinned'
}

/** Collect the request before opening upstream so Content-Length matches the rewritten bytes. */
export function readIncomingMessageBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

/**
 * Only a policy slot rewrites, and only a JSON write. A pin, a GET, or a non-JSON body stays a pipe.
 */
export function claudeProxyShouldRewriteModel(
  method: string,
  contentType: string | undefined,
  slotModel: ClaudeProxySlotModel | null
): boolean {
  if (!slotModel || slotModel.modelSource !== 'policy') {
    return false
  }
  if (method === 'GET' || method === 'HEAD') {
    return false
  }
  if (!claudePolicyModelLabel(slotModel.model)) {
    return false
  }
  return (contentType ?? '').toLowerCase().includes('json')
}

/** Under `cap`, parse. Over it, swap only the top-level model string. */
export function rewriteClaudeProxyBody(
  body: Buffer,
  slotModel: string,
  cap = CLAUDE_MODEL_REWRITE_BUFFER_CAP
): ClaudeModelRewrite {
  const label = claudePolicyModelLabel(slotModel)
  if (!label) {
    return { body, rewritten: false, mode: 'passthrough' }
  }
  const targetId = claudeModelId(label)
  if (body.length > cap) {
    return rewriteClaudeModelStreaming(body, targetId)
  }
  return rewriteClaudeModelBody(body, targetId)
}
