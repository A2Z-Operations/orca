import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SystemLanguageRead } from './system-language'

let readPreferences: () => SystemLanguageRead = () => ({
  preferences: ['fr-FR', 'en-US'],
  settled: true
})

beforeEach(() => {
  vi.resetModules()
  readPreferences = () => ({ preferences: ['fr-FR', 'en-US'], settled: true })
})

async function loadSystemLanguage() {
  const language = await import('./system-language')
  language.configureSystemLanguageReader(() => readPreferences())
  return language
}

describe('native language snapshot', () => {
  it('reads preferences once after app readiness and shares the ordered result', async () => {
    let ready = false
    let reads = 0
    readPreferences = () => {
      reads += 1
      return { preferences: ready ? ['fr-FR', 'en-US'] : ['ja-JP'], settled: ready }
    }
    const { getSystemLanguageDetection } = await loadSystemLanguage()
    // Pre-ready reads serve startup-failure dialogs without pinning the post-ready snapshot.
    expect(getSystemLanguageDetection()?.locale).toBe('ja')
    ready = true
    expect(getSystemLanguageDetection()).toMatchObject({
      detectedTag: 'fr-FR',
      locale: 'fr',
      source: 'native'
    })
    readPreferences = () => ({ preferences: ['en-US'], settled: true })
    expect(getSystemLanguageDetection()?.locale).toBe('fr')
    expect(reads).toBe(2)
  })

  it('keeps a C-only native result unknown so Chromium cannot override it', async () => {
    readPreferences = () => ({ preferences: ['C.UTF-8', 'POSIX'], settled: true })
    const { getSystemLanguageDetection } = await loadSystemLanguage()
    expect(getSystemLanguageDetection()).toMatchObject({ status: 'unknown', source: 'native' })
  })

  it.each(['empty', 'failed'])(
    'permits uncertain browser fallback for %s native lookup',
    async (kind) => {
      readPreferences = () => {
        if (kind === 'failed') {
          throw new Error('Unavailable')
        }
        return { preferences: [], settled: true }
      }
      const { getSystemLanguageDetection } = await loadSystemLanguage()
      expect(getSystemLanguageDetection()).toBeNull()
      const fallback = getSystemLanguageDetection(['fr-FR'])
      expect(fallback).toMatchObject({ locale: 'fr', source: 'browser-fallback' })
      expect(getSystemLanguageDetection(['ja-JP'])).toBe(fallback)
      const { getMainSystemLocale, setMainUiLanguage, mainI18n } = await import('./main-i18n')
      expect(getMainSystemLocale()).toBe('fr')
      await setMainUiLanguage('system')
      expect(mainI18n.language).toBe('fr')
      await setMainUiLanguage('en')
      expect(mainI18n.language).toBe('en')
    }
  )

  it('never replaces a successful native snapshot with browser fallback hints', async () => {
    const { getSystemLanguageDetection } = await loadSystemLanguage()
    const native = getSystemLanguageDetection()
    expect(getSystemLanguageDetection(['ja-JP'])).toBe(native)
    expect(native).toMatchObject({ locale: 'fr', source: 'native' })
  })

  it('caches a missing reader as an unknown native lookup so browser hints can apply', async () => {
    const { getSystemLanguageDetection } = await import('./system-language')
    expect(getSystemLanguageDetection()).toBeNull()
    expect(getSystemLanguageDetection(['fr-FR'])).toMatchObject({
      locale: 'fr',
      source: 'browser-fallback'
    })
  })
})

it.each([
  { platform: 'Windows', preferences: ['ja-JP', 'en-US'], locale: 'ja', status: 'supported' },
  { platform: 'macOS', preferences: ['fr-US', 'en-US'], locale: 'fr', status: 'supported' },
  {
    platform: 'Linux',
    preferences: ['zh_CN.UTF-8', 'zh_CN', 'zh', 'C'],
    locale: 'zh',
    status: 'supported'
  },
  { platform: 'Linux C-only', preferences: ['C.UTF-8', 'C'], locale: 'en', status: 'unknown' },
  { platform: 'unsupported', preferences: ['de-DE', 'fr-FR'], locale: 'en', status: 'unsupported' }
])('handles $platform preference lists', async ({ preferences, locale, status }) => {
  readPreferences = () => ({ preferences, settled: true })
  const { getSystemLanguageDetection } = await loadSystemLanguage()
  expect(getSystemLanguageDetection()).toMatchObject({ locale, status })
})
