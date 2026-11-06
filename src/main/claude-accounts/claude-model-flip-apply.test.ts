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
import { applyClaudeModelFlip, uncoverClaudePaneModel } from './claude-model-flip-apply'
import { claudeModelFlips, resetClaudeModelFlips } from './claude-model-flip-history'
import { claudeAuthProxySlotModel } from './claude-auth-proxy/claude-auth-proxy-slot-owners'
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

  it('a covered flip keeps the launch model; uncovering restores it and stops the proxy rewrite', () => {
    recordClaudePaneAccount({
      ptyId: 'pty-fixed',
      paneKey: 'tab:pty-fixed',
      accountId: 'a',
      configDir: null,
      launchedAt: 0,
      pinned: false,
      source: 'spawn',
      proxySlot: 'slot-fixed',
      model: 'fable',
      modelSource: 'pinned'
    })
    applyClaudeModelFlip(flip('pty-fixed'))
    expect(getClaudePaneAccount('pty-fixed')).toMatchObject({
      model: 'opus',
      modelSource: 'policy',
      launchModel: 'fable'
    })
    expect(claudeAuthProxySlotModel('slot-fixed')).toEqual({ model: 'opus', modelSource: 'policy' })
    // A second policy flip on the covered pane keeps the pin it started with.
    applyClaudeModelFlip({ ...flip('pty-fixed'), from: 'opus', to: 'fable', at: 6_000 })
    expect(getClaudePaneAccount('pty-fixed')?.launchModel).toBe('fable')
    applyClaudeModelFlip({ ...flip('pty-fixed'), at: 7_000 })
    uncoverClaudePaneModel({
      ptyId: 'pty-fixed',
      paneKey: 'tab:pty-fixed',
      accountId: 'a',
      at: 8_000
    })
    const record = getClaudePaneAccount('pty-fixed')
    expect(record).toMatchObject({ model: 'fable', modelSource: 'pinned' })
    expect(record?.launchModel).toBeUndefined()
    expect(claudeAuthProxySlotModel('slot-fixed')).toEqual({
      model: 'fable',
      modelSource: 'pinned'
    })
    expect(claudeModelFlips().find((row) => row.at === 8_000)).toMatchObject({
      ptyId: 'pty-fixed',
      kind: 'model',
      modelFrom: 'opus',
      modelTo: 'fable',
      reason: 'uncovered',
      strategy: 'proxy'
    })
    // Already on its own model: nothing to log, and nothing to restore twice.
    uncoverClaudePaneModel({
      ptyId: 'pty-fixed',
      paneKey: 'tab:pty-fixed',
      accountId: 'a',
      at: 9_000
    })
    expect(claudeModelFlips().some((row) => row.at === 9_000)).toBe(false)
  })
})
