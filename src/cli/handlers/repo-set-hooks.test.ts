import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseArgs, validateCommandAndFlags } from '../args'
import { dispatch } from '../dispatch'
import { RuntimeClient } from '../runtime-client'
import { CORE_COMMAND_SPECS } from '../specs/core'
import { mergeRepoHookSettings } from './repo-set-hooks'

describe('repo set-hooks', () => {
  const client = new RuntimeClient('/tmp/orca-set-hooks-test', 60_000, null, null)
  const stored = {
    mode: 'auto' as const,
    setupRunPolicy: 'ask' as const,
    commandSourcePolicy: 'local-only' as const,
    scripts: { setup: 'pnpm install', archive: 'echo bye' }
  }
  const repo = { id: 'repo-1', displayName: 'My repo', path: '/tmp/repo', hookSettings: stored }
  const updateCalls: unknown[] = []

  function run(args: string[]) {
    const parsed = parseArgs(['repo', 'set-hooks', ...args])
    validateCommandAndFlags(CORE_COMMAND_SPECS, parsed)
    return dispatch(parsed.commandPath, {
      flags: parsed.flags,
      client,
      cwd: '/tmp/another-repo',
      json: true
    })
  }

  beforeEach(() => {
    updateCalls.length = 0
    vi.spyOn(client, 'call').mockImplementation(async (method, params) => {
      if (method === 'repo.show') {
        return { id: 'show', ok: true as const, result: { repo }, _meta: { runtimeId: 't' } }
      }
      updateCalls.push(params)
      const hookSettings =
        typeof params === 'object' && params !== null && 'updates' in params
          ? Object(params.updates).hookSettings
          : undefined
      return {
        id: 'update',
        ok: true as const,
        result: { repo: { ...repo, hookSettings } },
        _meta: { runtimeId: 't' }
      }
    })
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('binds both scripts and the policy, keeping commandSourcePolicy', async () => {
    await run([
      '--repo',
      'path:/tmp/repo',
      '--setup',
      'bash scripts/orca-setup.sh',
      '--archive',
      'bash scripts/orca-archive.sh',
      '--setup-policy',
      'run-by-default',
      '--json'
    ])

    expect(client.call).toHaveBeenNthCalledWith(1, 'repo.show', { repo: 'path:/tmp/repo' })
    expect(updateCalls).toEqual([
      {
        repo: 'path:/tmp/repo',
        updates: {
          hookSettings: {
            mode: 'auto',
            setupRunPolicy: 'run-by-default',
            commandSourcePolicy: 'local-only',
            scripts: {
              setup: 'bash scripts/orca-setup.sh',
              archive: 'bash scripts/orca-archive.sh'
            }
          }
        }
      }
    ])
    const printed = JSON.parse(String(vi.mocked(console.log).mock.calls[0][0]))
    expect(printed.result).toEqual({
      repo: { id: 'repo-1', displayName: 'My repo', path: '/tmp/repo' },
      hookSettings: {
        mode: 'auto',
        setupRunPolicy: 'run-by-default',
        commandSourcePolicy: 'local-only',
        scripts: { setup: 'bash scripts/orca-setup.sh', archive: 'bash scripts/orca-archive.sh' }
      }
    })
  })

  it('changes one script and leaves the other and the policy alone', async () => {
    await run(['--repo', 'id:repo-1', '--archive', 'make clean'])

    expect(updateCalls).toEqual([
      {
        repo: 'id:repo-1',
        updates: {
          hookSettings: { ...stored, scripts: { setup: 'pnpm install', archive: 'make clean' } }
        }
      }
    ])
  })

  it('clears a script with --clear-setup while a following flag still parses', async () => {
    await run(['--repo', 'id:repo-1', '--clear-setup', '--setup-policy', 'skip-by-default'])

    expect(updateCalls).toEqual([
      {
        repo: 'id:repo-1',
        updates: {
          hookSettings: {
            ...stored,
            setupRunPolicy: 'skip-by-default',
            scripts: { setup: '', archive: 'echo bye' }
          }
        }
      }
    ])
  })

  it.each([
    { args: ['--repo', 'id:repo-1'], message: 'Missing required --setup, --archive' },
    { args: ['--setup', 'x'], message: 'Missing required --repo' },
    { args: ['--repo', 'id:repo-1', '--setup'], message: 'Missing value for --setup' },
    { args: ['--repo', 'id:repo-1', '--setup='], message: 'Missing value for --setup' },
    {
      args: ['--repo', 'id:repo-1', '--setup-policy', 'always'],
      message: '--setup-policy must be ask, run-by-default, skip-by-default.'
    },
    {
      args: ['--repo', 'id:repo-1', '--setup', 'x', '--clear-setup'],
      message: '--setup and --clear-setup cannot be combined.'
    },
    {
      args: ['--repo', 'id:repo-1', '--archive', 'x', '--clear-archive'],
      message: '--archive and --clear-archive cannot be combined.'
    }
  ])('rejects $args before calling the runtime', async ({ args, message }) => {
    await expect(run(args)).rejects.toMatchObject({
      code: 'invalid_argument',
      message: expect.stringContaining(message)
    })
    expect(client.call).not.toHaveBeenCalled()
  })
})

describe('mergeRepoHookSettings', () => {
  it('starts from the defaults when the repo has no hookSettings yet', () => {
    expect(
      mergeRepoHookSettings(undefined, {
        setup: 'npm ci',
        clearSetup: false,
        clearArchive: false
      })
    ).toEqual({
      mode: 'auto',
      setupRunPolicy: 'run-by-default',
      scripts: { setup: 'npm ci', archive: '' }
    })
  })
})
