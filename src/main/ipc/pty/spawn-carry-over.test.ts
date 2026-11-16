import { describe, expect, it } from 'vitest'
import { carryOverFor } from './spawn-carry-over'
import type { ReplacedPaneOwner } from './pane/replaced-pane-owner'

// #44 (a), observe only. #70 S3 (option B): main names the PTY a spawn replaces ONLY when it proved that PTY was the
// pane's (a bound owner with that ptyId, or the PTY's own pane-key record); the spawn path itself is unchanged.
const pane = { worktreeId: 'w', tabId: 't', leafId: 'l', hostId: undefined }

describe('carryOverFor (#44 restart carry-over, observe only)', () => {
  it('a PROVEN replacement names the PTY it replaced', () => {
    const replaced: ReplacedPaneOwner = { ptyId: 'old-pty', pane, proven: true }
    expect(carryOverFor(replaced)).toEqual({ carriesFrom: 'old-pty' })
  })

  it('an unproven replacement, or none, names nothing (no mislabelled carry)', () => {
    const unproven: ReplacedPaneOwner = { ptyId: 'old-pty', pane: null }
    expect(carryOverFor(unproven)).toEqual({})
    expect(carryOverFor(null)).toEqual({})
    expect(carryOverFor(undefined)).toEqual({})
  })
})
