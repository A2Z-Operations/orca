import { describe, expect, it } from 'vitest'
import {
  AGENT_SESSION_HELD_CODE,
  findLivePtyHoldingSession,
  refuseResumeOfHeldAgentSession,
  resumedSessionIdOfCommand,
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
    showsBareShell: async () => false,
    holderTitle: () => null,
    ...overrides
  }
}

describe('refuseResumeOfHeldAgentSession', () => {
  it('refuses a second process resuming a session a live terminal still runs', async () => {
    const held = sources({
      providerSessionIdentities: () => [{ paneKey: 'tab-a:leaf-a', sessionId: SESSION }],
      ptyIdForPaneKey: (paneKey) => (paneKey === 'tab-a:leaf-a' ? 'pty-working' : undefined),
      holderTitle: (ptyId) => (ptyId === 'pty-working' ? 'Z8 Features' : null)
    })

    const refusal = refuseResumeOfHeldAgentSession({ resumeProviderSession: resume }, held)
    await expect(refusal).rejects.toMatchObject({
      code: AGENT_SESSION_HELD_CODE,
      holderPtyId: 'pty-working'
    })
    // Scripts match the code; people read which terminal holds the session.
    await expect(
      refuseResumeOfHeldAgentSession({ resumeProviderSession: resume }, held)
    ).rejects.toThrow(
      `${AGENT_SESSION_HELD_CODE}: This agent session is still running in the terminal "Z8 Features" (pty pty-working).`
    )
  })

  it('finds a holder from its launch row when its agent has not reported since a restart', async () => {
    const held = sources({
      recordedPtySessions: () => [
        { ptyId: 'pty-other', providerSessionId: 'other-session' },
        { ptyId: 'pty-orphaned', providerSessionId: SESSION }
      ]
    })

    await expect(findLivePtyHoldingSession(SESSION, new Set(), held)).resolves.toBe('pty-orphaned')
    await expect(
      refuseResumeOfHeldAgentSession({ resumeProviderSession: resume }, held)
    ).rejects.toThrow('a terminal that no tab shows (pty pty-orphaned')
  })

  it('lets a restart replace the PTY that holds the session, and a reattach attach to it', () => {
    const held = sources({
      recordedPtySessions: () => [{ ptyId: 'pty-old', providerSessionId: SESSION }]
    })

    expect(
      refuseResumeOfHeldAgentSession(
        { resumeProviderSession: resume, replacesPtyId: 'pty-old' },
        held
      )
    ).toBeUndefined()
    expect(
      refuseResumeOfHeldAgentSession({ resumeProviderSession: resume, sessionId: 'pty-old' }, held)
    ).toBeUndefined()
  })

  it('resumes a session whose last terminal has exited', () => {
    const held = sources({
      recordedPtySessions: () => [{ ptyId: 'pty-gone', providerSessionId: SESSION }],
      isKnownExited: (ptyId) => ptyId === 'pty-gone'
    })

    expect(refuseResumeOfHeldAgentSession({ resumeProviderSession: resume }, held)).toBeUndefined()
  })

  it('resumes a session whose agent exited back to a shell that is still running', async () => {
    // As `z8-features@@aae6694e`: claude exited, its shell lives on, and its row still names the session.
    const held = sources({
      recordedPtySessions: () => [{ ptyId: 'pty-shell', providerSessionId: SESSION }],
      providerSessionIdentities: () => [{ paneKey: 'tab-a:leaf-a', sessionId: SESSION }],
      ptyIdForPaneKey: () => 'pty-shell',
      showsBareShell: async (ptyId) => ptyId === 'pty-shell'
    })

    await expect(
      refuseResumeOfHeldAgentSession({ resumeProviderSession: resume }, held)
    ).resolves.toBeUndefined()
  })

  it('still refuses when a stale shell row sits beside the PTY whose agent runs the session', async () => {
    const held = sources({
      recordedPtySessions: () => [
        { ptyId: 'pty-shell', providerSessionId: SESSION },
        { ptyId: 'pty-agent', providerSessionId: SESSION }
      ],
      showsBareShell: async (ptyId) => ptyId === 'pty-shell'
    })

    await expect(findLivePtyHoldingSession(SESSION, new Set(), held)).resolves.toBe('pty-agent')
  })

  it('counts a PTY whose foreground cannot be read as holding the session', async () => {
    const held = sources({
      recordedPtySessions: () => [{ ptyId: 'pty-unread', providerSessionId: SESSION }],
      showsBareShell: () => Promise.reject(new Error('controller gone'))
    })

    await expect(findLivePtyHoldingSession(SESSION, new Set(), held)).resolves.toBe('pty-unread')
  })

  it('refuses a hand-written resume command the same way as a structured resume', async () => {
    const held = sources({
      recordedPtySessions: () => [{ ptyId: 'pty-working', providerSessionId: SESSION }]
    })

    await expect(
      refuseResumeOfHeldAgentSession({ command: `claude --resume ${SESSION}` }, held)
    ).rejects.toThrow(AGENT_SESSION_HELD_CODE)
  })

  it('ignores spawns that resume nothing', () => {
    const held = sources({
      recordedPtySessions: () => [{ ptyId: 'pty-working', providerSessionId: SESSION }]
    })

    expect(refuseResumeOfHeldAgentSession({}, held)).toBeUndefined()
    expect(
      refuseResumeOfHeldAgentSession({ resumeProviderSession: { id: SESSION } }, held)
    ).toBeUndefined()
    expect(refuseResumeOfHeldAgentSession({ command: 'claude' }, held)).toBeUndefined()
  })
})

describe('resumedSessionIdOfCommand', () => {
  it('reads the session a plain resume command line names', () => {
    expect(resumedSessionIdOfCommand(`claude --resume ${SESSION}`)).toBe(SESSION)
    expect(resumedSessionIdOfCommand(`claude --model opus -r '${SESSION}'`)).toBe(SESSION)
    expect(resumedSessionIdOfCommand(`/usr/local/bin/claude --resume=${SESSION}`)).toBe(SESSION)
    expect(resumedSessionIdOfCommand(`cd /tmp && codex resume ${SESSION}`)).toBe(SESSION)
  })

  it('reads nothing from commands that do not resume a session', () => {
    expect(resumedSessionIdOfCommand('claude')).toBeNull()
    expect(resumedSessionIdOfCommand('claude --resume')).toBeNull()
    expect(resumedSessionIdOfCommand(`echo ${SESSION}`)).toBeNull()
    expect(resumedSessionIdOfCommand(`myclaude --resume ${SESSION}`)).toBeNull()
    expect(resumedSessionIdOfCommand(undefined)).toBeNull()
  })
})
