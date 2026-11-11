import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const storageMocks = vi.hoisted(() => ({
  available: true,
  backend: 'gnome_libsecret',
  encryptString: vi.fn((value: string) => Buffer.from(`encrypted:${value}`, 'utf8')),
  decryptString: vi.fn((value: Buffer) => {
    const text = value.toString('utf8')
    if (!text.startsWith('encrypted:')) {
      throw new Error('wrong key or corrupt ciphertext')
    }
    return text.slice('encrypted:'.length)
  })
}))

import { _resetSecretStoreForTests, setSecretStore } from '../../shared/secret-store'
import { PluginSecretsStore } from './plugin-secrets-store'

const roots: string[] = []
const originalPlatform = process.platform

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'orca-plugin-secrets-'))
  roots.push(root)
  return root
}

beforeEach(() => {
  storageMocks.available = true
  storageMocks.backend = 'gnome_libsecret'
  // The store reads the host's installed SecretStore, never Electron directly.
  setSecretStore({
    isEncryptionAvailable: () => storageMocks.available,
    encryptString: (value) => storageMocks.encryptString(value),
    decryptString: (value) => storageMocks.decryptString(value),
    describeProtectionGap: () =>
      storageMocks.backend === 'basic_text'
        ? 'built-in key'
        : storageMocks.available
          ? null
          : 'no keyring'
  })
  storageMocks.encryptString.mockImplementation((value) =>
    Buffer.from(`encrypted:${value}`, 'utf8')
  )
  storageMocks.decryptString.mockImplementation((value) => {
    const text = value.toString('utf8')
    if (!text.startsWith('encrypted:')) {
      throw new Error('wrong key or corrupt ciphertext')
    }
    return text.slice('encrypted:'.length)
  })
})

afterEach(async () => {
  _resetSecretStoreForTests()
  Object.defineProperty(process, 'platform', { value: originalPlatform })
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('PluginSecretsStore', () => {
  it('fails closed without OS encryption and writes no plaintext file', async () => {
    const root = await tempRoot()
    storageMocks.available = false
    const store = new PluginSecretsStore(root, 'acme.demo')

    expect(store.set('token', 'plaintext')).toMatchObject({ ok: false })
    expect(store.get('token')).toMatchObject({ ok: true, value: null })
    await expect(readFile(join(root, 'acme.demo', 'secrets.json.enc'))).rejects.toMatchObject({
      code: 'ENOENT'
    })
  })

  it('refuses a seal whose key sits beside the data, naming the gap', async () => {
    const root = await tempRoot()
    storageMocks.backend = 'basic_text'
    const store = new PluginSecretsStore(root, 'acme.demo')

    expect(store.set('token', 'plaintext')).toMatchObject({
      ok: false,
      error: expect.stringContaining('built-in key')
    })
    expect(storageMocks.encryptString).not.toHaveBeenCalled()
  })

  it('keeps the desktop refusal sentence verbatim under the Electron runtime', async () => {
    const root = await tempRoot()
    storageMocks.backend = 'basic_text'
    const hadElectron = Object.hasOwn(process.versions, 'electron')
    Object.defineProperty(process.versions, 'electron', { value: '39.0.0', configurable: true })
    try {
      const store = new PluginSecretsStore(root, 'acme.demo')
      expect(store.set('token', 'plaintext')).toEqual({
        ok: false,
        error:
          'OS keyring is unavailable (Linux basic_text backend); secret not stored. Install and unlock gnome-keyring or kwallet, then restart Orca.'
      })
    } finally {
      if (!hadElectron) {
        // oxlint-disable-next-line typescript/no-dynamic-delete -- SAFETY: restores the plain-Node shape the suite started with.
        delete (process.versions as { electron?: string }).electron
      }
    }
    expect(storageMocks.encryptString).not.toHaveBeenCalled()
  })

  it('round-trips a secret through the installed store when the OS seals it', async () => {
    const root = await tempRoot()
    const store = new PluginSecretsStore(root, 'acme.demo')

    expect(store.set('token', 'hunter2')).toEqual({ ok: true, value: true })
    expect(store.get('token')).toEqual({ ok: true, value: 'hunter2' })
    const file = await readFile(join(root, 'acme.demo', 'secrets.json.enc'), 'utf8')
    expect(file).not.toContain('hunter2')
  })
})
