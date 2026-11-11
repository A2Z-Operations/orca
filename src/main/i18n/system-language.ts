import { detectUiLanguage, type UiLanguageDetection } from '../../shared/ui-locale'

/** The host's native language list. `settled: false` means the host is not ready yet: serve the read, cache nothing. */
export type SystemLanguageRead = { preferences: readonly string[]; settled: boolean }
export type SystemLanguageReader = () => SystemLanguageRead

let reader: SystemLanguageReader | undefined
let snapshot: UiLanguageDetection | null | undefined

/** Install the host reader. A later install starts a fresh snapshot. */
export function configureSystemLanguageReader(next: SystemLanguageReader): void {
  reader = next
  snapshot = undefined
}

export function getSystemLanguageDetection(
  browserPreferences?: readonly string[]
): UiLanguageDetection | null {
  if (snapshot === undefined) {
    if (!reader) {
      // Headless hosts have no native list. Cache the miss so browser hints can apply.
      snapshot = null
    } else {
      try {
        const read = reader()
        const detection = read.preferences.length
          ? detectUiLanguage(read.preferences, 'native')
          : null
        if (!read.settled) {
          // Pre-ready startup-failure dialogs still need a language; cache only the post-ready read.
          return detection
        }
        snapshot = detection
      } catch {
        snapshot = null
      }
    }
  }
  if (snapshot === null && browserPreferences) {
    snapshot = detectUiLanguage(browserPreferences, 'browser-fallback')
  }
  return snapshot
}
