import { app } from 'electron'
import { configureSystemLanguageReader } from '../i18n/system-language'

/** Electron owns the native language list. Plain-node hosts never import this file. */
export function installElectronSystemLanguageReader(): void {
  configureSystemLanguageReader(() => ({
    preferences: readPreferredSystemLanguages(),
    settled: app.isReady()
  }))
}

function readPreferredSystemLanguages(): readonly string[] {
  try {
    return app.getPreferredSystemLanguages()
  } catch {
    return []
  }
}
