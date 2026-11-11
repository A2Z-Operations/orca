import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { getSecretStore } from '../../shared/secret-store'
import type { SecretProtectionAssessment } from '../host/electron-secret-store'
import { isUnreadableError, writeSecureFile } from '../../shared/secure-storage/secure-file'
import {
  PLUGIN_STORAGE_KEY_LIMIT,
  PLUGIN_STORAGE_TOTAL_MAX_BYTES
} from '../../shared/plugins/workers/plugin-host-api'
import { pluginDataDir } from './plugin-storage-store'

// SafeStorage vault writes fail without OS encryption; never fall back to plaintext.

type PersistedSecretsFile = {
  version: 1
  format: 'electron-safe-storage-v1'
  ciphertexts: Record<string, string>
}

export type PluginSecretsResult<T> = { ok: true; value: T } | { ok: false; error: string }

const UNREADABLE_VAULT_ERROR = 'secret vault exists but could not be read; refusing to overwrite it'

// Fork: seal through the host's installed SecretStore (Electron safeStorage on the desktop, the
// plain-Node serve host's own sealed key file), so this module imports no Electron.
const safeStorage = {
  isEncryptionAvailable: () => getSecretStore().isEncryptionAvailable(),
  encryptString: (plainText: string) => getSecretStore().encryptString(plainText),
  decryptString: (cipher: Buffer) => getSecretStore().decryptString(cipher)
}

/** At-rest protection plugin secrets get; backs the `secrets.protection` host method. A reported
 *  gap with sealing still available is `obfuscated` (Linux basic_text, a key kept beside the data). */
export function pluginSecretsProtection(): SecretProtectionAssessment {
  const store = getSecretStore()
  const gap = store.describeProtectionGap()
  if (gap === null) {
    return { level: 'os', gap: null }
  }
  return { level: store.isEncryptionAvailable() ? 'obfuscated' : 'unavailable', gap }
}

export class PluginSecretsStore {
  private readonly filePath: string

  constructor(pluginsDataDir: string, qualifiedKey: string) {
    this.filePath = join(pluginDataDir(pluginsDataDir, qualifiedKey), 'secrets.json.enc')
  }

  /** Null means unreadable, never empty. */
  private read(): PersistedSecretsFile | null {
    const empty: PersistedSecretsFile = {
      version: 1,
      format: 'electron-safe-storage-v1',
      ciphertexts: {}
    }
    try {
      if (!existsSync(this.filePath)) {
        return empty
      }
      if (statSync(this.filePath).size > PLUGIN_STORAGE_TOTAL_MAX_BYTES) {
        return empty
      }
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as PersistedSecretsFile
      if (
        parsed &&
        parsed.version === 1 &&
        parsed.format === 'electron-safe-storage-v1' &&
        parsed.ciphertexts &&
        typeof parsed.ciphertexts === 'object' &&
        !Array.isArray(parsed.ciphertexts)
      ) {
        return parsed
      }
    } catch (error) {
      // Read denial cannot prove emptiness; replacing the vault would silently drop every other secret.
      if (isUnreadableError(error)) {
        return null
      }
      // Corrupt vaults read as empty; set() rewrites a valid file.
    }
    return empty
  }

  get(key: string): PluginSecretsResult<string | null> {
    const file = this.read()
    if (!file) {
      return { ok: false, error: UNREADABLE_VAULT_ERROR }
    }
    const ciphertext = file.ciphertexts[key]
    if (typeof ciphertext !== 'string') {
      return { ok: true, value: null }
    }
    if (!safeStorage.isEncryptionAvailable()) {
      return { ok: false, error: 'OS-backed encryption is unavailable' }
    }
    try {
      return { ok: true, value: safeStorage.decryptString(Buffer.from(ciphertext, 'base64')) }
    } catch {
      return { ok: false, error: 'failed to decrypt stored secret' }
    }
  }

  set(key: string, value: string): PluginSecretsResult<true> {
    if (!safeStorage.isEncryptionAvailable()) {
      return { ok: false, error: 'OS-backed encryption is unavailable; secret not stored' }
    }
    // Why: a seal whose key sits beside the data (Linux basic_text, a headless host's key file) is
    // plaintext to anyone reading the account; third-party secrets never go there.
    const protection = pluginSecretsProtection()
    if (protection.level === 'obfuscated') {
      return {
        ok: false,
        error: `OS keyring protection is weak; secret not stored. ${protection.gap}`
      }
    }
    const file = this.read()
    if (!file) {
      return { ok: false, error: UNREADABLE_VAULT_ERROR }
    }
    if (
      !Object.hasOwn(file.ciphertexts, key) &&
      Object.keys(file.ciphertexts).length >= PLUGIN_STORAGE_KEY_LIMIT
    ) {
      return { ok: false, error: `secret vault exceeds the ${PLUGIN_STORAGE_KEY_LIMIT}-key limit` }
    }
    file.ciphertexts[key] = safeStorage.encryptString(value).toString('base64')
    const nextFile = JSON.stringify(file, null, 2)
    if (Buffer.byteLength(nextFile, 'utf8') > PLUGIN_STORAGE_TOTAL_MAX_BYTES) {
      return { ok: false, error: `secret vault exceeds ${PLUGIN_STORAGE_TOTAL_MAX_BYTES} bytes` }
    }
    writeSecureFile(this.filePath, nextFile)
    return { ok: true, value: true }
  }

  delete(key: string): void {
    const file = this.read()
    if (!file) {
      // Rewriting what we could not read would drop every other secret in the vault.
      return
    }
    if (Object.hasOwn(file.ciphertexts, key)) {
      delete file.ciphertexts[key]
      writeSecureFile(this.filePath, JSON.stringify(file, null, 2))
    }
  }
}
