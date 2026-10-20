import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ClaudeManagedAccount } from '../../shared/managed-account-types'
import {
  CLAUDE_INJECTED_CONFIG_DIR_ENV,
  CLAUDE_PROFILE_MISSING_MESSAGE,
  CLAUDE_PROFILE_POINTER_ENV,
  CLAUDE_PROFILE_SETUP_FAILED_MESSAGE
} from '../../shared/claude-profile-routing'
import { getPosixClaudeShellFunction } from '../../shared/claude-shell-function'
import type { ClaudeProfileSetupReport } from './claude-profile-setup'
import { claudeProfileMarkerPath, describeClaudeProfile } from './claude-profile-paths'
import { ClaudeProfileRouter, type ClaudeProfileRouterSettings } from './claude-profile-router'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

function fixture(env: NodeJS.ProcessEnv = {}) {
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
    agentStatusHooksEnabled: false,
    disabledTuiAgents: []
  }
  // Why settable: one test lets setup hang, one refuses it, the rest finish at once.
  const setup = {
    calls: [] as string[],
    outcome: 'prepared' as ClaudeProfileSetupReport['outcome'],
    hang: false
  }
  const router = new ClaudeProfileRouter({
    getSettings: () => settings,
    dataRoot,
    userHome,
    env,
    runSetup: ({ profile }) => {
      setup.calls.push(profile.accountId)
      if (setup.hang) {
        return new Promise(() => {})
      }
      mkdirSync(profile.home, { recursive: true })
      if (setup.outcome === 'prepared') {
        writeFileSync(claudeProfileMarkerPath(profile), '{}')
      }
      return Promise.resolve({ outcome: setup.outcome, warnings: [], surfaces: {} })
    },
    refreshWaitMs: 10
  })
  const describe = (id: string) =>
    describeClaudeProfile(dataRoot, id, { executionHostId: 'local', runtime: 'host' })
  const home = (id: string) => describe(id).home
  return { root, userHome, dataRoot, router, describe, home, setup }
}

/** Claude's own sign-in state in a folder (the login the router reads). Copied from claude-profile-router.test.ts. */
function signIn(stateDir: string, email: string, organizationUuid?: string): void {
  mkdirSync(stateDir, { recursive: true })
  const stateFile = join(stateDir, '.claude.json')
  const previousMtimeMs = existsSync(stateFile) ? statSync(stateFile).mtimeMs : 0
  writeFileSync(
    stateFile,
    JSON.stringify({ oauthAccount: { emailAddress: email, organizationUuid } })
  )
  // Why: equal-size fixture revisions must invalidate the real reader's mtime cache.
  const mtime = new Date(
    Math.max(
      Math.floor(Date.now() / 1000) * 1000,
      Math.floor(previousMtimeMs / 1000) * 1000 + 2_000
    )
  )
  utimesSync(stateFile, mtime, mtime)
}

/** A `claude` on PATH that prints the CLAUDE_CONFIG_DIR it runs with, under the pane's shell function. */
function claudeShellProbe(root: string): (env: NodeJS.ProcessEnv) => string {
  const bin = join(root, 'bin')
  mkdirSync(bin)
  writeFileSync(join(bin, 'claude'), '#!/bin/sh\nprintf "%s" "${CLAUDE_CONFIG_DIR-unset}"\n')
  chmodSync(join(bin, 'claude'), 0o700)
  return (env) =>
    spawnSync(
      '/bin/bash',
      ['--norc', '--noprofile', '-c', `${getPosixClaudeShellFunction()}\nclaude`],
      {
        env: { ...env, PATH: `${bin}:/usr/bin:/bin` },
        encoding: 'utf8'
      }
    ).stdout
}

describe('ClaudeProfileRouter.launchEnvFor', () => {
  it("names the chosen account's folder as a bare CLAUDE_CONFIG_DIR, with no pointer or injected marker", () => {
    const f = fixture()
    mkdirSync(f.home('b'), { recursive: true })

    const env = f.router.launchEnvFor('b')

    expect(env).toEqual({ CLAUDE_CONFIG_DIR: f.home('b') })
    expect(env).not.toHaveProperty(CLAUDE_PROFILE_POINTER_ENV)
    expect(env).not.toHaveProperty(CLAUDE_INJECTED_CONFIG_DIR_ENV)
  })

  it('refuses a missing folder rather than run the wrong account', () => {
    const f = fixture()

    expect(() => f.router.launchEnvFor('b')).toThrow(CLAUDE_PROFILE_MISSING_MESSAGE)
  })

  it('refuses an id no saved account explains, before any setup', async () => {
    const f = fixture()

    expect(() => f.router.launchEnvFor('zzz')).toThrow('claude_account_unknown')
    expect(() => f.router.preparationFor('zzz')).toThrow('claude_account_unknown')
    await expect(f.router.prepareLaunchFor('zzz')).rejects.toThrow('claude_account_unknown')
    expect(f.setup.calls).toEqual([])
  })

  it('passes through when System default already covers the account', async () => {
    const f = fixture()
    signIn(f.userHome, 'b@example.test')

    expect(f.router.launchEnvFor('b')).toEqual({})
    expect(f.router.preparationFor('b')).toEqual({
      configDir: join(f.userHome, '.claude'),
      runtime: 'host',
      wslDistro: null,
      wslLinuxConfigDir: null,
      envPatch: {},
      provenance: 'system'
    })
    await expect(f.router.prepareLaunchFor('b')).resolves.toMatchObject({ provenance: 'system' })
    expect(f.setup.calls).toEqual([])
  })

  it("restores the user's own CLAUDE_CONFIG_DIR when that folder covers the account", () => {
    const own = mkdtempSync(join(tmpdir(), 'claude-router-own-'))
    roots.push(own)
    const f = fixture({ CLAUDE_CONFIG_DIR: own })
    signIn(own, 'b@example.test')

    expect(f.router.launchEnvFor('b')).toEqual({ CLAUDE_CONFIG_DIR: own })
    expect(f.router.preparationFor('b')).toMatchObject({ configDir: own, provenance: 'system' })
  })

  it('fails the launch when a first setup is refused', async () => {
    const f = fixture()
    f.setup.outcome = 'refused'

    await expect(f.router.prepareLaunchFor('b')).rejects.toThrow(
      CLAUDE_PROFILE_SETUP_FAILED_MESSAGE
    )
    expect(f.setup.calls).toEqual(['b'])
  })

  it('sets a folder up first, then runs on its last refresh when a refresh hangs', async () => {
    const f = fixture()

    await expect(f.router.prepareLaunchFor('b')).resolves.toEqual({
      configDir: f.home('b'),
      runtime: 'host',
      wslDistro: null,
      wslLinuxConfigDir: null,
      envPatch: { CLAUDE_CONFIG_DIR: f.home('b') },
      provenance: 'profile:b'
    })
    expect(existsSync(claudeProfileMarkerPath(f.describe('b')))).toBe(true)

    // Why no timer: a hang past refreshWaitMs (10 ms) fails this test on vitest's own timeout.
    f.setup.hang = true
    await expect(f.router.prepareLaunchFor('b')).resolves.toMatchObject({ provenance: 'profile:b' })
    expect(f.setup.calls).toEqual(['b', 'b'])
  })
})

// Why not win32: runs the POSIX claude function under bash.
describe.skipIf(process.platform === 'win32')(
  'the pane claude function with a chosen account',
  () => {
    it('runs the folder CLAUDE_CONFIG_DIR names unless an equal injected marker rides along', () => {
      const f = fixture()
      const probe = claudeShellProbe(f.root)
      mkdirSync(f.home('a'), { recursive: true })
      mkdirSync(f.home('b'), { recursive: true })
      mkdirSync(dirname(f.router.pointerPath), { recursive: true })
      writeFileSync(f.router.pointerPath, f.home('a'))

      // The chosen account's env: no pointer, so no function; plain claude honours the value.
      expect(probe(f.router.launchEnvFor('b'))).toBe(f.home('b'))
      // Belt and braces: beside the selected-host pointer a bare value still passes through (branch 2).
      expect(
        probe({
          [CLAUDE_PROFILE_POINTER_ENV]: f.router.pointerPath,
          CLAUDE_CONFIG_DIR: f.home('b')
        })
      ).toBe(f.home('b'))
      // The selected account's own launch env still routes to the pointer's folder.
      expect(probe(f.router.launchEnv())).toBe(f.home('a'))
      // The first cut's shape — pointer + CLAUDE_CONFIG_DIR = b + injected = b — re-read the pointer: the defect.
      expect(
        probe({
          [CLAUDE_PROFILE_POINTER_ENV]: f.router.pointerPath,
          CLAUDE_CONFIG_DIR: f.home('b'),
          [CLAUDE_INJECTED_CONFIG_DIR_ENV]: f.home('b')
        })
      ).toBe(f.home('a'))
    })
  }
)
