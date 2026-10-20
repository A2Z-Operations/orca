import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ClaudeProfileRouter } from '../../../claude-accounts/claude-profile-router'
import { installClaudeProfileRouter } from '../../../claude-accounts/claude-profile-installed-router'
import type { ClaudeRuntimeAuthPreparation } from '../../../claude-accounts/runtime-auth-service'
import {
  CLAUDE_INJECTED_CONFIG_DIR_ENV,
  CLAUDE_PROFILE_POINTER_ENV,
  CLAUDE_USER_CONFIG_DIR_ENV
} from '../../../../shared/claude-profile-routing'
import { applyRuntimeClaudeAuthEnv, resolveRuntimeClaudeAuth } from './spawn-claude-auth'

const selected: ClaudeRuntimeAuthPreparation = {
  configDir: '/a',
  envPatch: { CLAUDE_CONFIG_DIR: '/a' },
  provenance: 'profile:a'
}
const target: ClaudeRuntimeAuthPreparation = {
  configDir: '/b',
  envPatch: { CLAUDE_CONFIG_DIR: '/b' },
  provenance: 'profile:b'
}

afterEach(() => {
  installClaudeProfileRouter(undefined)
})

describe('resolveRuntimeClaudeAuth', () => {
  it('uses the selected account unless the spawn names one', async () => {
    const prepareClaudeAuth = vi.fn(async () => selected)
    const prepareLaunchFor = vi.fn(async () => target)
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: only prepareLaunchFor is read here.
    installClaudeProfileRouter({ prepareLaunchFor } as unknown as ClaudeProfileRouter)
    const codexSelectionTarget = { runtime: 'host' as const }

    await expect(
      resolveRuntimeClaudeAuth({ args: {}, deps: { prepareClaudeAuth }, codexSelectionTarget })
    ).resolves.toBe(selected)
    expect(prepareClaudeAuth).toHaveBeenCalledWith(codexSelectionTarget)

    await expect(
      resolveRuntimeClaudeAuth({
        args: { claudeAccountId: 'b' },
        deps: { prepareClaudeAuth },
        codexSelectionTarget
      })
    ).resolves.toBe(target)
    expect(prepareLaunchFor).toHaveBeenCalledWith('b')
  })

  it('refuses a named account when no router is installed, and yields null without any resolver', async () => {
    await expect(
      resolveRuntimeClaudeAuth({
        args: { claudeAccountId: 'b' },
        deps: {},
        codexSelectionTarget: { runtime: 'host' }
      })
    ).rejects.toThrow('claude_account_router_unavailable')
    await expect(
      resolveRuntimeClaudeAuth({ args: {}, deps: {}, codexSelectionTarget: { runtime: 'host' } })
    ).resolves.toBeNull()
  })
})

describe('applyRuntimeClaudeAuthEnv', () => {
  // What `withClaudeProfileTerminalEnv` gives every host pane before the login shell's env arrives.
  const terminalEnv = {
    KEEP: '1',
    [CLAUDE_PROFILE_POINTER_ENV]: '/data/claude-profiles/selected-host',
    [CLAUDE_USER_CONFIG_DIR_ENV]: '/home/u/.claude-own'
  }
  // The same pane once the selected account's launch env has been merged in too.
  const selectedEnv = {
    ...terminalEnv,
    [CLAUDE_INJECTED_CONFIG_DIR_ENV]: '/a',
    CLAUDE_CONFIG_DIR: '/a'
  }

  it('returns the env untouched when there is no Claude auth', () => {
    expect(applyRuntimeClaudeAuthEnv(undefined, null, false)).toBeUndefined()
    expect(applyRuntimeClaudeAuthEnv(selectedEnv, null, true)).toBe(selectedEnv)
  })

  it("keeps the selected account's pointer and markers for an unpinned launch and spreads the patch", () => {
    expect(applyRuntimeClaudeAuthEnv(terminalEnv, selected, false)).toEqual({
      ...terminalEnv,
      CLAUDE_CONFIG_DIR: '/a'
    })
  })

  it('drops the pointer, the injected marker and the selected CLAUDE_CONFIG_DIR for a pinned launch, keeps the user dir, then applies the patch', () => {
    expect(applyRuntimeClaudeAuthEnv(selectedEnv, target, true)).toEqual({
      KEEP: '1',
      [CLAUDE_USER_CONFIG_DIR_ENV]: '/home/u/.claude-own',
      CLAUDE_CONFIG_DIR: '/b'
    })
    // The caller's env is never mutated (the renderer may reuse it).
    expect(selectedEnv.CLAUDE_CONFIG_DIR).toBe('/a')
    expect(selectedEnv).toHaveProperty(CLAUDE_PROFILE_POINTER_ENV)
  })

  it("resumes an account System default covers on the user's own folder, never the selected one", () => {
    // Task 3 hands a covered account an ADDITIVE patch: the user's own CLAUDE_CONFIG_DIR, or nothing.
    const covered = (envPatch: ClaudeRuntimeAuthPreparation['envPatch']) => ({
      configDir: '/home/u/.claude-own',
      envPatch,
      provenance: 'system' as const
    })
    expect(
      applyRuntimeClaudeAuthEnv(
        selectedEnv,
        covered({ CLAUDE_CONFIG_DIR: '/home/u/.claude-own' }),
        true
      )
    ).toEqual({
      KEEP: '1',
      [CLAUDE_USER_CONFIG_DIR_ENV]: '/home/u/.claude-own',
      CLAUDE_CONFIG_DIR: '/home/u/.claude-own'
    })
    const unset = applyRuntimeClaudeAuthEnv(selectedEnv, covered({}), true)
    expect(unset).toEqual({ KEEP: '1', [CLAUDE_USER_CONFIG_DIR_ENV]: '/home/u/.claude-own' })
    expect(unset).not.toHaveProperty('CLAUDE_CONFIG_DIR')
    expect(unset).not.toHaveProperty(CLAUDE_INJECTED_CONFIG_DIR_ENV)
    expect(unset).not.toHaveProperty(CLAUDE_PROFILE_POINTER_ENV)
  })
})
