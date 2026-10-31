import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  resetClaudeAuthProxySlotOwners,
  setClaudeAuthProxySlotModel
} from './claude-auth-proxy-slot-owners'

describe('claude model-policy proxy log', () => {
  afterEach(() => {
    resetClaudeAuthProxySlotOwners()
  })

  it('logs a rewrite target once per slot change and never a request body', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    setClaudeAuthProxySlotModel('slot-1', 'fable', 'policy')
    setClaudeAuthProxySlotModel('slot-1', 'fable', 'policy')
    setClaudeAuthProxySlotModel('slot-1', 'opus', 'policy')
    setClaudeAuthProxySlotModel('slot-1', 'claude-sonnet-4-5', 'pinned')
    const lines = info.mock.calls.map((call) => call.map(String).join(' '))
    expect(lines).toEqual([
      '[claude-model-policy] proxy slot slot-1 unset → fable',
      '[claude-model-policy] proxy slot slot-1 fable → opus'
    ])
    expect(lines.join('\n')).not.toContain('{')
    info.mockRestore()
  })
})
