import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyDurableBackgroundJobEnv } from './durable-background-job'
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
    const env: Record<string, string> = { CLAUDE_CODE_PLUGIN_DIRS: '/user/plugin' }
    applyDurableBackgroundJobEnv(env, options({ launchAgent: 'claude' }))
    expect(env.ORCA_DURABLE_JOB_PLUGIN_DIR).toContain('orca-durable-jobs')
    expect(env.CLAUDE_CODE_PLUGIN_DIRS).toBe(
      `/user/plugin${delimiter}${env.ORCA_DURABLE_JOB_PLUGIN_DIR}`
    )
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

  it.each([
    { launchAgent: 'codex' as const },
    { launchCommand: 'codex' },
    { isWsl: true, launchAgent: 'claude' as const }
  ])('leaves non-Claude launches unchanged: %j', (overrides) => {
    const env: Record<string, string> = {
      CLAUDE_CODE_PLUGIN_DIRS: '/user/plugin',
      ORCA_DURABLE_JOB_PLUGIN_DIR: '/stale/plugin'
    }
    applyDurableBackgroundJobEnv(env, options(overrides))
    expect(env.ORCA_DURABLE_JOB_PLUGIN_DIR).toBeUndefined()
    expect(env.CLAUDE_CODE_PLUGIN_DIRS).toBe('/user/plugin')
  })

  it('stays out of the way when durable jobs are disabled', () => {
    vi.stubEnv('ORCA_DURABLE_JOBS', '0')
    const env: Record<string, string> = {}
    applyDurableBackgroundJobEnv(env, options({ launchAgent: 'claude' }))
    expect(env.ORCA_DURABLE_JOB_PLUGIN_DIR).toBeUndefined()
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
