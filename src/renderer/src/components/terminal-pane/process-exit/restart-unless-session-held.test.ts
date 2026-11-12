import { describe, expect, it, vi } from 'vitest'
import { restartUnlessSessionHeld } from './restart-unless-session-held'

const resumeProviderSession = {
  key: 'session_id' as const,
  id: 'bdd6f6d7-0000-4000-8000-000000000000'
}
const refusal =
  'agent_session_held_by_live_terminal: This agent session is still running in the terminal "Z8 Features" (pty pty-holder).'

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

describe('restartUnlessSessionHeld', () => {
  it('never unbinds the old PTY when another live terminal holds the session, and shows why', async () => {
    const restart = vi.fn()
    const refuse = vi.fn()
    const findHolder = vi.fn(async () => ({ holderPtyId: 'pty-holder', refusal }))

    restartUnlessSessionHeld({
      replacesPtyId: 'pty-old',
      resumeProviderSession,
      findHolder,
      isStillCurrent: () => true,
      restart,
      refuse
    })
    await flush()

    expect(findHolder).toHaveBeenCalledWith({ resumeProviderSession, replacesPtyId: 'pty-old' })
    // The restart (which clears the pane's binding) never ran, so the old PTY keeps its pane.
    expect(restart).not.toHaveBeenCalled()
    expect(refuse).toHaveBeenCalledWith(refusal)
  })

  it('restarts when no other terminal holds the session', async () => {
    const restart = vi.fn()
    const refuse = vi.fn()

    restartUnlessSessionHeld({
      replacesPtyId: 'pty-old',
      resumeProviderSession,
      findHolder: async () => null,
      isStillCurrent: () => true,
      restart,
      refuse
    })
    await flush()

    expect(restart).toHaveBeenCalledOnce()
    expect(refuse).not.toHaveBeenCalled()
  })

  it('leaves a pane alone that closed or changed PTY while main answered', async () => {
    const restart = vi.fn()
    const refuse = vi.fn()

    restartUnlessSessionHeld({
      replacesPtyId: 'pty-old',
      resumeProviderSession,
      findHolder: async () => ({ holderPtyId: 'pty-holder', refusal }),
      isStillCurrent: () => false,
      restart,
      refuse
    })
    await flush()

    expect(restart).not.toHaveBeenCalled()
    expect(refuse).not.toHaveBeenCalled()
  })

  it('restarts at once when there is no live PTY to strand or no session to resume', () => {
    const restart = vi.fn()
    const findHolder = vi.fn()

    restartUnlessSessionHeld({
      replacesPtyId: null,
      resumeProviderSession,
      findHolder,
      isStillCurrent: () => true,
      restart,
      refuse: vi.fn()
    })
    restartUnlessSessionHeld({
      replacesPtyId: 'pty-old',
      resumeProviderSession: undefined,
      findHolder,
      isStillCurrent: () => true,
      restart,
      refuse: vi.fn()
    })

    expect(restart).toHaveBeenCalledTimes(2)
    expect(findHolder).not.toHaveBeenCalled()
  })

  it('restarts when the lookup itself fails, leaving the refusal to the spawn', async () => {
    const restart = vi.fn()

    restartUnlessSessionHeld({
      replacesPtyId: 'pty-old',
      resumeProviderSession,
      findHolder: () => Promise.reject(new Error('ipc gone')),
      isStillCurrent: () => true,
      restart,
      refuse: vi.fn()
    })
    await flush()

    expect(restart).toHaveBeenCalledOnce()
  })
})
