import { identityFixture, saved } from './claude-auth-proxy-identity-test-fixtures'
import { writeFile } from 'node:fs/promises'
import { expect, it } from 'vitest'
import { HostAccountLaunchEnvParams } from '../../../shared/agent-launch/startup/host-account-launch-env'
import { HostAccountLaunchEnvState } from '../../runtime/agent-session/environment/host-account-launch-env-state'
import { pushWslOrcadHostAccountEnv } from '../../wsl/orcad/wsl-orcad-host-account-push'
import { applyWslGuestAuthProxyEnv } from '../../ipc/pty/runtime/wsl-guest-auth-proxy-env'
import { readClaudeOAuthCredentials } from '../../rate-limits/claude-oauth-credentials'
import { registeredClaudeAccountForWslConfigDir } from '../claude-registered-account'
import {
  bindClaudeAuthProxyAccountDir,
  clearClaudeAuthProxyAccountDirs
} from './claude-auth-proxy-account-credentials'
import { claudeAuthProxySlotId } from './claude-auth-proxy-url'

it('forwards the registered WSL account through launch and refuses another login in its folder', async () => {
  const fixture = await identityFixture('guest')
  try {
    clearClaudeAuthProxyAccountDirs()
    await fixture.writeToken()
    const guest = new HostAccountLaunchEnvState(() => false)
    await pushWslOrcadHostAccountEnv(
      {
        environmentId: 'wsl-test',
        distro: 'Ubuntu',
        hostSupports: async () => 'supported',
        call: async (_method, params) => {
          guest.setHostLaunchEnv(
            HostAccountLaunchEnvParams.parse(JSON.parse(JSON.stringify(params)))
          )
          return { id: 'push', ok: true, result: null, _meta: { runtimeId: 'wsl-test' } }
        }
      },
      {
        registeredClaudeAccounts: () => [
          {
            ...saved,
            managedAuthRuntime: 'wsl',
            wslDistro: 'Ubuntu',
            wslLinuxAuthPath: fixture.configDir
          }
        ],
        prepareClaudeLaunch: async () => ({
          runtime: 'wsl',
          wslDistro: 'Ubuntu',
          configDir: fixture.configDir,
          envPatch: { CLAUDE_CONFIG_DIR: fixture.configDir },
          provenance: 'profile:account-a:wsl:Ubuntu'
        }),
        claudeTerminalEnv: () => ({}),
        prepareCodexHome: async () => null,
        managedAccountSelected: () => true,
        accountNotApplied: () => {}
      }
    )
    const applied = await applyWslGuestAuthProxyEnv({ ...guest.hostLaunchEnvFor('claude') }, true, {
      localPort: () => fixture.proxy.port(),
      ready: async () => fixture.proxy,
      registeredAccount: registeredClaudeAccountForWslConfigDir,
      readToken: async (configDir) =>
        (
          await readClaudeOAuthCredentials({
            credentialsFileConfigDir: configDir,
            keychainConfigDir: configDir
          })
        ).token,
      bindDir: bindClaudeAuthProxyAccountDir
    })
    const slot = claudeAuthProxySlotId(applied.env?.ANTHROPIC_BASE_URL ?? '')
    if (!slot) {
      throw new Error('WSL launch did not allocate a proxy slot')
    }
    expect(applied.auth?.provenance).toBe('profile:account-a')
    expect(await fixture.request(slot)).toBe(200)
    expect(fixture.seen).toEqual([true])

    await writeFile(
      fixture.stateFile,
      JSON.stringify({
        oauthAccount: {
          emailAddress: 'second@example.invalid',
          organizationUuid: 'org-second'
        }
      })
    )
    await fixture.writeToken(true)
    fixture.proxy.invalidateToken()
    expect(await fixture.request(slot)).toBe(401)
    expect(fixture.seen).toEqual([true])
  } finally {
    await fixture.close()
  }
})
