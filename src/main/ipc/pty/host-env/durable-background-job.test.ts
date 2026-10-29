import { lstatSync, mkdtempSync, readFileSync, readlinkSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyDurableBackgroundJobEnv, durableJobInjectionTarget } from './durable-background-job'
import type { BuildPtyHostEnvOptions } from './types'

const userDataPaths: string[] = []

function options(overrides: Partial<BuildPtyHostEnvOptions> = {}): BuildPtyHostEnvOptions {
  const userDataPath = mkdtempSync(join(tmpdir(), 'orca-durable-plugin-'))
  userDataPaths.push(userDataPath)
  return {
    userDataPath,
    isPackaged: false,
    selectedCodexHomePath: null,
    agentStatusHooksEnabled: true,
    ...overrides
  }
}

afterEach(() => {
  vi.unstubAllEnvs()
  for (const path of userDataPaths) {
    rmSync(path, { recursive: true, force: true })
  }
  userDataPaths.length = 0
})

describe('applyDurableBackgroundJobEnv', () => {
  it('installs the plugin for a Claude launch and appends its directory', () => {
    const opts = options({ launchAgent: 'claude' })
    const env: Record<string, string> = {
      CLAUDE_CODE_PLUGIN_DIRS: '/user/plugin',
      PATH: '/usr/bin'
    }
    applyDurableBackgroundJobEnv(env, opts)
    const binDir = join(opts.userDataPath, 'claude-durable-jobs', 'bin')
    expect(env.ORCA_DURABLE_JOB_PLUGIN_DIR).toContain('orca-durable-jobs')
    expect(env.CLAUDE_CODE_PLUGIN_DIRS).toBe(
      `/user/plugin${delimiter}${env.ORCA_DURABLE_JOB_PLUGIN_DIR}`
    )
    expect(env.PATH.split(delimiter)[0]).toBe(binDir)
    const waiter = join(binDir, 'orca-durable-job')
    expect(lstatSync(waiter).isSymbolicLink()).toBe(true)
    expect(readlinkSync(waiter)).toContain('durable-background-job.mjs')
    const hooks = JSON.parse(
      readFileSync(join(env.ORCA_DURABLE_JOB_PLUGIN_DIR!, 'hooks', 'hooks.json'), 'utf8')
    ) as {
      hooks: { PreToolUse: { matcher: string; hooks: { command: string }[] }[] }
    }
    expect(hooks.hooks.PreToolUse[0]?.matcher).toBe('Bash')
    expect(hooks.hooks.PreToolUse[0]?.hooks[0]?.command).toContain(
      'durable-background-job-hook.mjs'
    )
  })

  it('recognizes a claude command when the launch agent is unset', () => {
    const env: Record<string, string> = {}
    applyDurableBackgroundJobEnv(env, options({ launchCommand: 'claude --resume abc' }))
    expect(env.ORCA_DURABLE_JOB_PLUGIN_DIR).toBeTruthy()
  })

  it.each([{ launchAgent: 'codex' as const }, { launchCommand: 'codex' }])(
    'leaves non-Claude launches unchanged: %j',
    (overrides) => {
      const opts = options(overrides)
      const binDir = join(opts.userDataPath, 'claude-durable-jobs', 'bin')
      const env: Record<string, string> = {
        CLAUDE_CODE_PLUGIN_DIRS: '/user/plugin',
        ORCA_DURABLE_JOB_PLUGIN_DIR: '/stale/plugin',
        PATH: `${binDir}${delimiter}/usr/bin`
      }
      applyDurableBackgroundJobEnv(env, opts)
      expect(env.ORCA_DURABLE_JOB_PLUGIN_DIR).toBeUndefined()
      expect(env.CLAUDE_CODE_PLUGIN_DIRS).toBe('/user/plugin')
      expect(env.PATH).toBe('/usr/bin')
    }
  )

  it('publishes the guest plugin and linux waiter for a WSL Claude launch', () => {
    const opts = options({ isWsl: true, launchAgent: 'claude' })
    const env: Record<string, string> = {
      CLAUDE_CODE_PLUGIN_DIRS: '/user/plugin',
      PATH: '/usr/bin'
    }
    applyDurableBackgroundJobEnv(env, opts)
    const wslBin = join(opts.userDataPath, 'claude-durable-jobs', 'bin-wsl')
    expect(env.ORCA_DURABLE_JOB_PLUGIN_DIR).toContain('orca-durable-jobs-wsl')
    expect(env.CLAUDE_CODE_PLUGIN_DIRS).toBe(
      `/user/plugin${delimiter}${env.ORCA_DURABLE_JOB_PLUGIN_DIR}`
    )
    expect(env.PATH.split(delimiter)[0]).toBe(wslBin)
    const hooks = JSON.parse(
      readFileSync(join(env.ORCA_DURABLE_JOB_PLUGIN_DIR!, 'hooks', 'hooks.json'), 'utf8')
    ) as {
      hooks: { PreToolUse: { matcher: string; hooks: { command: string }[] }[] }
    }
    expect(hooks.hooks.PreToolUse[0]?.matcher).toBe('Bash')
    expect(hooks.hooks.PreToolUse[0]?.hooks[0]?.command).toContain(
      'durable-background-job-hook.mjs'
    )
    expect(hooks.hooks.PreToolUse[0]?.hooks[0]?.command.startsWith('node ')).toBe(true)
    const waiter = readFileSync(join(wslBin, 'orca-durable-job'), 'utf8')
    expect(waiter).toContain('exec node ')
    expect(waiter).toContain('durable-background-job.mjs')
  })

  it.each(['darwin', 'linux', 'win32'] as const)(
    'chooses a durable-job injection target on %s',
    (platform) => {
      expect(
        durableJobInjectionTarget({
          platform,
          isWsl: false,
          launchesClaude: true,
          disabled: false
        })
      ).toBe(platform === 'win32' ? 'windows' : 'posix')
      expect(
        durableJobInjectionTarget({
          platform,
          isWsl: true,
          launchesClaude: true,
          disabled: false
        })
      ).toBe('wsl')
      expect(
        durableJobInjectionTarget({
          platform,
          isWsl: false,
          launchesClaude: false,
          disabled: false
        })
      ).toBe('skip')
      expect(
        durableJobInjectionTarget({
          platform,
          isWsl: true,
          launchesClaude: true,
          disabled: true
        })
      ).toBe('skip')
    }
  )

  it('stays out of the way when durable jobs are disabled', () => {
    vi.stubEnv('ORCA_DURABLE_JOBS', '0')
    const env: Record<string, string> = { PATH: '/usr/bin' }
    applyDurableBackgroundJobEnv(env, options({ launchAgent: 'claude' }))
    expect(env.ORCA_DURABLE_JOB_PLUGIN_DIR).toBeUndefined()
    expect(env.PATH).toBe('/usr/bin')
  })

  it('skips injection when the plugin cannot be written', () => {
    const opts = options({ launchAgent: 'claude' })
    const blocked = join(opts.userDataPath, 'not-a-directory')
    writeFileSync(blocked, 'file')
    const env: Record<string, string> = {}
    applyDurableBackgroundJobEnv(env, { ...opts, userDataPath: blocked })
    expect(env.ORCA_DURABLE_JOB_PLUGIN_DIR).toBeUndefined()
  })
})
