import { detectUiLanguage, type UiLanguageDetection } from '../../shared/ui-locale'

/** `null` means the host is not ready yet and the miss must not be cached. */
export type SystemLanguageReader = () => readonly string[] | null

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
        const preferences = reader()
        if (preferences === null) {
          return null
        }
        snapshot = preferences.length ? detectUiLanguage(preferences, 'native') : null
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
