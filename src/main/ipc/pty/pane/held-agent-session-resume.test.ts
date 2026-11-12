import { describe, expect, it } from 'vitest'
import {
  AGENT_SESSION_HELD_CODE,
  findLivePtyHoldingSession,
  refuseResumeOfHeldAgentSession,
  type HeldAgentSessionSources
} from './held-agent-session-resume'

const SESSION = 'bdd6f6d7-0000-4000-8000-000000000000'
const resume = { key: 'session_id', id: SESSION }

function sources(overrides: Partial<HeldAgentSessionSources> = {}): HeldAgentSessionSources {
  return {
    providerSessionIdentities: () => [],
    ptyIdForPaneKey: () => undefined,
    recordedPtySessions: () => [],
    isKnownExited: () => false,
    ...overrides
  }
}

describe('refuseResumeOfHeldAgentSession', () => {
  it('refuses a second process resuming a session a live terminal still runs', () => {
    const held = sources({
      providerSessionIdentities: () => [{ paneKey: 'tab-a:leaf-a', sessionId: SESSION }],
      ptyIdForPaneKey: (paneKey) => (paneKey === 'tab-a:leaf-a' ? 'pty-working' : undefined)
    })

    expect(() => refuseResumeOfHeldAgentSession({ resumeProviderSession: resume }, held)).toThrow(
      AGENT_SESSION_HELD_CODE
    )
    try {
      refuseResumeOfHeldAgentSession({ resumeProviderSession: resume }, held)
    } catch (error) {
      expect(error).toMatchObject({ code: AGENT_SESSION_HELD_CODE, holderPtyId: 'pty-working' })
    }
  })

  it('finds a holder from its launch row when its agent has not reported since a restart', () => {
    const held = sources({
      recordedPtySessions: () => [
        { ptyId: 'pty-other', providerSessionId: 'other-session' },
        { ptyId: 'pty-orphaned', providerSessionId: SESSION }
      ]
    })

    expect(findLivePtyHoldingSession(SESSION, new Set(), held)).toBe('pty-orphaned')
    expect(() => refuseResumeOfHeldAgentSession({ resumeProviderSession: resume }, held)).toThrow(
      'terminal pty-orphaned'
    )
  })

  it('lets a restart replace the PTY that holds the session, and a reattach attach to it', () => {
    const held = sources({
      recordedPtySessions: () => [{ ptyId: 'pty-old', providerSessionId: SESSION }]
    })

    expect(() =>
      refuseResumeOfHeldAgentSession(
        { resumeProviderSession: resume, replacesPtyId: 'pty-old' },
        held
      )
    ).not.toThrow()
    expect(() =>
      refuseResumeOfHeldAgentSession({ resumeProviderSession: resume, sessionId: 'pty-old' }, held)
    ).not.toThrow()
  })

  it('resumes a session whose last terminal has exited', () => {
    const held = sources({
      recordedPtySessions: () => [{ ptyId: 'pty-gone', providerSessionId: SESSION }],
      isKnownExited: (ptyId) => ptyId === 'pty-gone'
    })

    expect(() =>
      refuseResumeOfHeldAgentSession({ resumeProviderSession: resume }, held)
    ).not.toThrow()
  })

  it('ignores spawns that resume nothing', () => {
    const held = sources({
      recordedPtySessions: () => [{ ptyId: 'pty-working', providerSessionId: SESSION }]
    })

    expect(() => refuseResumeOfHeldAgentSession({}, held)).not.toThrow()
    expect(() =>
      refuseResumeOfHeldAgentSession({ resumeProviderSession: { id: SESSION } }, held)
    ).not.toThrow()
  })
})
