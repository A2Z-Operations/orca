import { app } from 'electron'
import { configureSystemLanguageReader } from '../i18n/system-language'

/** Electron owns the native language list. Plain-node hosts never import this file. */
export function installElectronSystemLanguageReader(): void {
  configureSystemLanguageReader(() => (app.isReady() ? app.getPreferredSystemLanguages() : null))
}
