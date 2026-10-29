import { describe, expect, it } from 'vitest'
import { resolveUpdaterDisabledReason } from './updater-disabled'

const base = {
  env: {} as NodeJS.ProcessEnv,
  isPackaged: true,
  resourcesPath: '/App/Contents/Resources'
}

describe('resolveUpdaterDisabledReason', () => {
  it('switches the updater off when ORCA_UPDATER_DISABLED=1', () => {
    expect(
      resolveUpdaterDisabledReason({
        ...base,
        env: { ORCA_UPDATER_DISABLED: '1' },
        exists: () => true
      })
    ).toBe('ORCA_UPDATER_DISABLED=1')
  })

  it('switches the updater off for a packaged app without app-update.yml (ORCA_NO_PUBLISH build)', () => {
    const seen: string[] = []
    expect(
      resolveUpdaterDisabledReason({
        ...base,
        exists: (p) => {
          seen.push(p)
          return false
        }
      })
    ).toBe('self-built app without app-update.yml')
    expect(seen).toEqual(['/App/Contents/Resources/app-update.yml'])
  })

  it('keeps updates on for a packaged app that ships app-update.yml', () => {
    expect(resolveUpdaterDisabledReason({ ...base, exists: () => true })).toBeNull()
  })

  it('keeps updates on outside a packaged app (dev)', () => {
    expect(
      resolveUpdaterDisabledReason({
        ...base,
        isPackaged: false,
        resourcesPath: undefined,
        exists: () => false
      })
    ).toBeNull()
  })
})
