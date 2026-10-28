import { describe, expect, it, vi } from 'vitest'
import { getDefaultSettings } from '../../shared/constants'
import { makePaneKey } from '../../shared/stable-pane-id'
import type { RuntimePtyController } from '../runtime/runtime-pty-controller-contract'
import { TEST_LEAF_1 } from '../persistence/persistence-session-fixtures'
import {
  createResumeMoveStrategy,
  type ClaudeSessionMoveRequest
} from './claude-session-move-strategy'

type Controller = Pick<RuntimePtyController, 'spawn' | 'getCwd' | 'getSize'>

function request(): ClaudeSessionMoveRequest {
  return {
    ptyId: 'pty-old',
    paneKey: makePaneKey('tab-1', TEST_LEAF_1),
    worktreeId: 'repo-local::/fixture/local',
    connectionId: null,
    toAccountId: 'c',
    providerSession: {
      key: 'session_id',
      id: 'sess-abc',
      transcriptPath: '/profiles/b/home/projects/x/sess-abc.jsonl'
    }
  }
}

function controller(spawn: Controller['spawn']): Controller {
  return {
    spawn,
    getCwd: async () => '/fixture/local/sub',
    getSize: () => ({ cols: 100, rows: 30 })
  }
}

describe('createResumeMoveStrategy', () => {
  it('resumes the conversation in the same pane on the target account', async () => {
    const spawn = vi.fn<NonNullable<Controller['spawn']>>(async () => ({ id: 'pty-new' }))
    const strategy = createResumeMoveStrategy({
      getController: () => controller(spawn),
      getSettings: () => getDefaultSettings('/tmp'),
      platform: 'darwin'
    })
    await expect(strategy.move(request())).resolves.toEqual({ kind: 'moved', newPtyId: 'pty-new' })
    expect(spawn).toHaveBeenCalledTimes(1)
    const opts = spawn.mock.calls[0]![0]
    expect(opts).toMatchObject({
      cols: 100,
      rows: 30,
      cwd: '/fixture/local/sub',
      launchAgent: 'claude',
      commandDelivery: 'provider',
      resumeProviderSession: { key: 'session_id', id: 'sess-abc' },
      worktreeId: 'repo-local::/fixture/local',
      tabId: 'tab-1',
      leafId: TEST_LEAF_1,
      replacesPtyId: 'pty-old',
      claudeAccountId: 'c',
      initiallyHidden: true,
      persistHostSessionBinding: true,
      isNewSession: true
    })
    // Posix quoting wraps every argv token in single quotes (see agent-resume-argv-drop.spec.ts:166).
    expect(opts.command).toMatch(/'--resume' 'sess-abc'$/)
    expect(opts.env?.CLAUDE_CONFIG_DIR).toBeUndefined()
  })

  it('resumes from the recorded run folder while the shell starts in the pane folder', async () => {
    const spawn = vi.fn<NonNullable<Controller['spawn']>>(async () => ({ id: 'pty-new' }))
    const strategy = createResumeMoveStrategy({
      getController: () => controller(spawn),
      getSettings: () => getDefaultSettings('/tmp'),
      platform: 'darwin'
    })
    const move = request()
    move.providerSession.cwd = '/fixture/recorded run'
    await expect(strategy.move(move)).resolves.toEqual({ kind: 'moved', newPtyId: 'pty-new' })
    expect(spawn).toHaveBeenCalledTimes(1)
    const opts = spawn.mock.calls[0]![0]
    expect(opts.cwd).toBe('/fixture/local/sub')
    expect(opts.command).toMatch(/^cd '\/fixture\/recorded run' && /)
    expect(opts.command).toMatch(/'--resume' 'sess-abc'$/)
    expect(opts.resumeProviderSession?.cwd).toBe('/fixture/recorded run')
  })

  it('preserves the recorded Claude effort in the resume command', async () => {
    const spawn = vi.fn<NonNullable<Controller['spawn']>>(async () => ({ id: 'pty-new' }))
    const strategy = createResumeMoveStrategy({
      getController: () => controller(spawn),
      getSettings: () => getDefaultSettings('/tmp'),
      platform: 'darwin'
    })
    const move = request()
    move.providerSession.effort = 'high'
    await expect(strategy.move(move)).resolves.toEqual({ kind: 'moved', newPtyId: 'pty-new' })
    expect(spawn).toHaveBeenCalledTimes(1)
    const opts = spawn.mock.calls[0]![0]
    expect(opts.command).toMatch(/'--effort' 'high' '--resume' 'sess-abc'$/)
    expect(opts.resumeProviderSession?.effort).toBe('high')
  })

  it('reports an owner change as a failure without touching anything else', async () => {
    const spawn = vi.fn<NonNullable<Controller['spawn']>>(async () => {
      throw new Error('terminal_pane_owner_changed')
    })
    const strategy = createResumeMoveStrategy({
      getController: () => controller(spawn),
      getSettings: () => getDefaultSettings('/tmp'),
      platform: 'darwin'
    })
    await expect(strategy.move(request())).resolves.toEqual({
      kind: 'failed',
      reason: 'owner-changed',
      error: 'terminal_pane_owner_changed'
    })
  })

  it('reports any other spawn error, a missing controller and a pane it cannot name', async () => {
    const spawn = vi.fn<NonNullable<Controller['spawn']>>(async () => {
      throw new Error('spawn exploded')
    })
    const strategy = createResumeMoveStrategy({
      getController: () => controller(spawn),
      getSettings: () => getDefaultSettings('/tmp'),
      platform: 'darwin'
    })
    await expect(strategy.move(request())).resolves.toEqual({
      kind: 'failed',
      reason: 'spawn-failed',
      error: 'spawn exploded'
    })
    const none = createResumeMoveStrategy({
      getController: () => null,
      getSettings: () => getDefaultSettings('/tmp'),
      platform: 'darwin'
    })
    await expect(none.move(request())).resolves.toEqual({
      kind: 'skipped',
      reason: 'no-controller'
    })
    await expect(strategy.move({ ...request(), paneKey: 'not-a-pane-key' })).resolves.toEqual({
      kind: 'skipped',
      reason: 'no-pane'
    })
  })
})
