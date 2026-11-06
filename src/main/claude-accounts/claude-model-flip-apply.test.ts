import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  closeClaudeAccountLog,
  flushClaudeAccountLog,
  openClaudeAccountLog
} from './claude-account-log'
import { readClaudeAccountLog } from './claude-account-log-read'
import { applyClaudeModelFlip } from './claude-model-flip-apply'
import { claudeModelFlips, resetClaudeModelFlips } from './claude-model-flip-history'
import {
  _internals,
  getClaudePaneAccount,
  recordClaudePaneAccount
} from './claude-pane-account-registry'

const flip = (ptyId: string) => ({
  ptyId,
  paneKey: `tab:${ptyId}`,
  accountId: 'a',
  from: 'fable' as const,
  to: 'opus' as const,
  reason: 'fable-line',
  at: 5_000
})

describe('applyClaudeModelFlip', () => {
  let directory = ''
  let path = ''

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'claude-flip-'))
    path = join(directory, 'account-moves.log')
    openClaudeAccountLog(path)
  })

  afterEach(() => {
    closeClaudeAccountLog()
    resetClaudeModelFlips()
    _internals.reset()
    rmSync(directory, { recursive: true, force: true })
  })

  it("records a proxy pane's flip as kind model, strategy proxy, in history and the log", () => {
    const base = {
      accountId: 'a',
      configDir: null,
      launchedAt: 0,
      pinned: false,
      source: 'spawn' as const
    }
    recordClaudePaneAccount({
      ...base,
      ptyId: 'pty-proxy',
      paneKey: 'tab:pty-proxy',
      proxySlot: 'slot-1',
      model: 'fable',
      modelSource: 'policy'
    })
    recordClaudePaneAccount({
      ...base,
      ptyId: 'pty-plain',
      paneKey: 'tab:pty-plain',
      model: 'fable',
      modelSource: 'policy'
    })
    applyClaudeModelFlip(flip('pty-proxy'))
    applyClaudeModelFlip(flip('pty-plain'))
    expect(getClaudePaneAccount('pty-proxy')).toMatchObject({
      model: 'opus',
      modelSource: 'policy'
    })
    const rows = claudeModelFlips()
    expect(rows.find((row) => row.ptyId === 'pty-proxy')).toMatchObject({
      kind: 'model',
      strategy: 'proxy',
      modelFrom: 'fable',
      modelTo: 'opus'
    })
    expect(rows.find((row) => row.ptyId === 'pty-plain')?.strategy).toBeUndefined()
    flushClaudeAccountLog()
    const logged = readClaudeAccountLog({ filePath: path }).entries
    expect(logged.find((row) => row.type === 'flip' && row.ptyId === 'pty-proxy')).toMatchObject({
      kind: 'model',
      strategy: 'proxy'
    })
    expect(
      logged.find((row) => row.type === 'flip' && row.ptyId === 'pty-plain')
    ).not.toHaveProperty('strategy')
  })
})
