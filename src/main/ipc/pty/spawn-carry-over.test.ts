import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { carryOverFor } from './spawn-carry-over'

describe('carryOverFor (#44 restart carry-over, observe only)', () => {
  it('a replacement names the PTY it replaces; anything else names nothing', () => {
    expect(carryOverFor('old-pty')).toEqual({ carriesFrom: 'old-pty' })
    for (const none of [undefined, null, '', 7, {}]) {
      expect(carryOverFor(none)).toEqual({})
    }
  })

  it('both spawn routes map replacesPtyId through it into the launch options', () => {
    for (const route of ['runtime/spawn-options.ts', 'ipc/spawn-options.ts']) {
      const source = readFileSync(join(__dirname, route), 'utf8')
      expect(source, route).toMatch(/\.\.\.carryOverFor\(args\.replacesPtyId\)/)
    }
    const assembly = readFileSync(join(__dirname, 'spawn-options-assembly.ts'), 'utf8')
    expect(assembly).toMatch(/spawnOptions\.carriesFrom = input\.carriesFrom/)
  })
})
