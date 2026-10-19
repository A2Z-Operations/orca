import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ClaudeManagedAccount } from '../../shared/managed-account-types'
import {
  CLAUDE_INJECTED_CONFIG_DIR_ENV,
  CLAUDE_PROFILE_MISSING_MESSAGE,
  CLAUDE_PROFILE_POINTER_ENV
} from '../../shared/claude-profile-routing'
import type { ClaudeProfileSetupReport } from './claude-profile-setup'
import {
  claudeProfileMarkerPath,
  describeClaudeProfile,
  type ClaudeProfileDescriptor
} from './claude-profile-paths'
import { ClaudeProfileRouter, type ClaudeProfileRouterSettings } from './claude-profile-router'

const roots: string[] = []
afterEach(() => {
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }))
})

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'claude-router-for-'))
  roots.push(root)
  const userHome = join(root, 'personal')
  const dataRoot = join(root, 'data')
  mkdirSync(join(userHome, '.claude'), { recursive: true })
  const account = (id: string): ClaudeManagedAccount => ({
    id,
    email: `${id}@example.test`,
    authMethod: 'subscription-oauth',
    managedAuthPath: '/unused-legacy',
    createdAt: 0,
    updatedAt: 0,
    lastAuthenticatedAt: 0
  })
  const settings: ClaudeProfileRouterSettings = {
    claudeManagedAccounts: [account('a'), account('b')],
    activeClaudeManagedAccountId: 'a',
    activeClaudeManagedAccountIdsByRuntime: undefined,
    // Hooks off: setup must not probe a real Claude here.
    agentStatusHooksEnabled: false,
    disabledTuiAgents: []
  }
  const setupCalls: string[] = []
  const runSetup = async ({
    profile
  }: {
    profile: ClaudeProfileDescriptor
  }): Promise<ClaudeProfileSetupReport> => {
    setupCalls.push(profile.accountId)
    mkdirSync(profile.home, { recursive: true })
    writeFileSync(claudeProfileMarkerPath(profile), '{}')
    return { outcome: 'prepared', warnings: [], surfaces: {} }
  }
  const router = new ClaudeProfileRouter({
    getSettings: () => settings,
    dataRoot,
    userHome,
    env: {},
    runSetup,
    refreshWaitMs: 10
  })
  const home = (id: string) => join(dataRoot, 'claude-profiles', id, 'home')
  const describe = (id: string) =>
    describeClaudeProfile(dataRoot, id, { executionHostId: 'local', runtime: 'host' })
  return { router, home, describe, setupCalls }
}

describe('ClaudeProfileRouter.launchEnvFor', () => {
  it("names a non-selected account's folder, not the selected one's", () => {
    const { router, home } = fixture()
    mkdirSync(home('a'), { recursive: true })
    mkdirSync(home('b'), { recursive: true })
    expect(router.launchEnvFor('b')).toEqual({
      [CLAUDE_PROFILE_POINTER_ENV]: router.pointerPath,
      CLAUDE_CONFIG_DIR: home('b'),
      [CLAUDE_INJECTED_CONFIG_DIR_ENV]: home('b')
    })
    expect(router.launchEnvFor('b').CLAUDE_CONFIG_DIR).not.toBe(
      router.launchEnv().CLAUDE_CONFIG_DIR
    )
  })

  it('refuses a missing folder rather than run the wrong account', () => {
    const { router } = fixture()
    expect(() => router.launchEnvFor('b')).toThrow(CLAUDE_PROFILE_MISSING_MESSAGE)
  })

  it('preparationFor tags the account and prepareLaunchFor sets a folder up first', async () => {
    const { router, home, describe, setupCalls } = fixture()
    const prepared = await router.prepareLaunchFor('b')
    expect(setupCalls).toEqual(['b'])
    expect(prepared).toEqual({
      configDir: home('b'),
      runtime: 'host',
      wslDistro: null,
      wslLinuxConfigDir: null,
      envPatch: router.launchEnvFor('b'),
      provenance: 'profile:b'
    })
    // A set-up folder is refreshed in the background and launches at once.
    writeFileSync(claudeProfileMarkerPath(describe('b')), '{}')
    expect((await router.prepareLaunchFor('b')).provenance).toBe('profile:b')
    expect(router.preparationFor('b').configDir).toBe(home('b'))
  })
})
