import { afterEach, describe, expect, it } from 'vitest'
import {
  _internals,
  forgetClaudePaneAccount,
  getClaudePaneAccount,
  inferClaudeAccountIdFromTranscript,
  listClaudePaneAccounts,
  listClaudePaneAccountsByAccount,
  recordClaudePaneAccount,
  type ClaudePaneAccountRecord
} from './claude-pane-account-registry'

function record(ptyId: string, accountId: string, pinned = false): ClaudePaneAccountRecord {
  return {
    ptyId,
    paneKey: `tab-${ptyId}:leaf-${ptyId}`,
    accountId,
    configDir: `/data/claude-profiles/${accountId}/home`,
    launchedAt: 1_000,
    pinned,
    source: pinned ? 'transcript' : 'spawn'
  }
}

describe('claude pane account registry', () => {
  afterEach(() => {
    _internals.reset()
  })

  it('records, lists and forgets the account a PTY runs on', () => {
    recordClaudePaneAccount(record('pty-1', 'a'))
    recordClaudePaneAccount(record('pty-2', 'b'))
    recordClaudePaneAccount(record('pty-3', 'a', true))

    expect(getClaudePaneAccount('pty-1')).toEqual(record('pty-1', 'a'))
    expect(listClaudePaneAccounts().map((entry) => entry.ptyId)).toEqual([
      'pty-1',
      'pty-2',
      'pty-3'
    ])
    expect(listClaudePaneAccountsByAccount('a').map((entry) => entry.ptyId)).toEqual([
      'pty-1',
      'pty-3'
    ])

    forgetClaudePaneAccount('pty-1')
    expect(getClaudePaneAccount('pty-1')).toBeNull()
    expect(listClaudePaneAccountsByAccount('a').map((entry) => entry.ptyId)).toEqual(['pty-3'])
  })

  it('re-recording a PTY replaces its record (a restarted pane shows its new account)', () => {
    recordClaudePaneAccount(record('pty-1', 'a'))
    recordClaudePaneAccount({ ...record('pty-1', 'c'), launchedAt: 2_000 })
    expect(getClaudePaneAccount('pty-1')?.accountId).toBe('c')
    expect(listClaudePaneAccounts()).toHaveLength(1)
  })

  it('infers the account from where Claude writes its transcript', () => {
    const accounts = [
      { id: 'a', homes: ['/data/claude-profiles/a/home'] },
      { id: 'b', homes: ['/legacy/unused', '/data/claude-profiles/b/home/'] }
    ]
    expect(
      inferClaudeAccountIdFromTranscript(
        '/data/claude-profiles/b/home/projects/-Users-x-repo/4f2c.jsonl',
        accounts
      )
    ).toEqual({ accountId: 'b', configDir: '/data/claude-profiles/b/home' })
    // System default or any folder no managed account owns.
    expect(
      inferClaudeAccountIdFromTranscript(
        '/Users/x/.claude/projects/-Users-x-repo/4f2c.jsonl',
        accounts
      )
    ).toBeNull()
    // No transcript reported → the caller cannot know.
    expect(inferClaudeAccountIdFromTranscript(undefined, accounts)).toBeUndefined()
    expect(inferClaudeAccountIdFromTranscript('/no/projects/here.jsonl', accounts)).toBeUndefined()
  })

  it('ignores trailing slashes on the home and on the transcript folder', () => {
    const accounts = [{ id: 'b', homes: ['/data/claude-profiles/b/home/'] }]
    expect(
      inferClaudeAccountIdFromTranscript(
        '/data/claude-profiles/b/home/projects/-Users-x-repo/4f2c.jsonl',
        accounts
      )
    ).toEqual({ accountId: 'b', configDir: '/data/claude-profiles/b/home' })
    // A project folder (trailing slash, no file) is not a transcript: stricter than the renderer.
    expect(
      inferClaudeAccountIdFromTranscript(
        '/data/claude-profiles/b/home/projects/-Users-x-repo/',
        accounts
      )
    ).toBeUndefined()
  })
})
