import { describe, expect, it, vi } from 'vitest'
import { PtyHostNotDispatchableError, getProvider } from '../provider/registry'
import { applyWslGuestAuthProxyEnv, type WslGuestAuthProxyDeps } from './wsl-guest-auth-proxy-env'

function deps(token: string | null): WslGuestAuthProxyDeps {
  return {
    localPort: () => null,
    ready: async () => ({
      port: () => 4010,
      allocateSlot: () => 'slot-a',
      slotBaseUrl: (slot) => `http://127.0.0.1:4010/p/${slot}/`
    }),
    readToken: async () => token,
    registeredAccount: () => ({
      id: 'account-a',
      email: 'first@example.invalid',
      organizationUuid: 'org-first'
    }),
    bindDir: () => {}
  }
}

describe('applyWslGuestAuthProxyEnv', () => {
  it('drops a desktop slot and does not publish a URL when the guest cannot read a token', async () => {
    const applied = await applyWslGuestAuthProxyEnv(
      {
        CLAUDE_CONFIG_DIR: '/home/u/.claude',
        ANTHROPIC_BASE_URL: 'http://127.0.0.1:9/p/desktop/'
      },
      true,
      deps(null)
    )
    expect(applied.env).not.toHaveProperty('ANTHROPIC_BASE_URL')
    expect(applied.auth).toBeNull()
  })

  it('does not publish a slot for an unregistered guest folder', async () => {
    const applied = await applyWslGuestAuthProxyEnv(
      { CLAUDE_CONFIG_DIR: '/home/u/.claude' },
      true,
      { ...deps('present'), registeredAccount: () => undefined }
    )
    expect(applied.env).not.toHaveProperty('ANTHROPIC_BASE_URL')
    expect(applied.auth).toBeNull()
  })

  it('leaves a user API host and a non-slot loopback URL alone', async () => {
    const readToken = vi.fn(async () => 'present')
    const guest = { ...deps('present'), readToken }
    const gateway = await applyWslGuestAuthProxyEnv(
      { CLAUDE_CONFIG_DIR: '/home/u/.claude', ANTHROPIC_BASE_URL: 'https://gateway.example' },
      true,
      guest
    )
    expect(gateway.env?.ANTHROPIC_BASE_URL).toBe('https://gateway.example')
    const loopback = await applyWslGuestAuthProxyEnv(
      { CLAUDE_CONFIG_DIR: '/home/u/.claude', ANTHROPIC_BASE_URL: 'http://127.0.0.1:8080/v1' },
      true,
      guest
    )
    expect(loopback.env?.ANTHROPIC_BASE_URL).toBe('http://127.0.0.1:8080/v1')
    expect(readToken).not.toHaveBeenCalled()
  })

  it('does not allocate a slot when the proxy setting is off', async () => {
    const applied = await applyWslGuestAuthProxyEnv(
      { CLAUDE_CONFIG_DIR: '/home/u/.claude' },
      false,
      deps('present')
    )
    expect(applied.env).not.toHaveProperty('ANTHROPIC_BASE_URL')
    expect(applied.auth).toBeNull()
  })
})

describe('desktop SSH spawn', () => {
  it('refuses an SSH execution host before this machine can inject its proxy URL', () => {
    expect(() => getProvider('ssh:macstudio')).toThrow(PtyHostNotDispatchableError)
  })
})
