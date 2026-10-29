import {
  AGENT_PROMPT_SUBMIT,
  buildAgentPromptPasteBytes
} from '../../shared/agent-prompt-injection'
import type { RuntimePtyController } from '../runtime/runtime-pty-controller-contract'
import { listJobs } from '../../../resources/durable-jobs/durable-background-job.mjs'
import {
  buildClaudeSessionMoveHandoffNote,
  claudeResumeHookBaseline,
  claudeResumeHooksReady,
  claudeResumeScreenAcceptsHandoff,
  claudeResumeScreenIsShellPrompt,
  detachedJobsForSession,
  type ClaudeSessionDetachedJob,
  type ClaudeSessionMoveEndedWork,
  type ClaudeSessionMoveHandoffTranslate
} from './claude-session-move-handoff-note'

export const CLAUDE_SESSION_MOVE_HANDOFF_TIMEOUT_MS = 30_000
export const CLAUDE_SESSION_MOVE_HANDOFF_POLL_MS = 250

export type ClaudeSessionMoveHandoff = {
  fromEmail: string
  toEmail: string
  detail: string
  endedWork: ClaudeSessionMoveEndedWork
}

type HandoffHooks = {
  getStatusSnapshotForPane: (paneKey: string) => readonly {
    state: string
    receivedAt: number
    providerSession?: { id: string }
    providerSessionOnly?: boolean
  }[]
  getProviderSessionIdentities: () => readonly { paneKey: string; sessionId: string }[]
}

type HandoffController = Pick<RuntimePtyController, 'write'> &
  Partial<Pick<RuntimePtyController, 'serializeBuffer'>>

export async function deliverClaudeSessionMoveHandoff(args: {
  controller: HandoffController
  hooks: HandoffHooks
  ptyId: string
  paneKey: string
  sessionId: string
  /** Highest `receivedAt` on the pane before `claude --resume` was spawned. */
  baselineReceivedAt?: number
  handoff: ClaudeSessionMoveHandoff
  translate: ClaudeSessionMoveHandoffTranslate
  /** Job directory. The default is the host durable-job root. */
  jobRoot?: string
  timeoutMs?: number
  sleep?: (ms: number) => Promise<void>
}): Promise<'sent' | 'unsent'> {
  const timeoutMs = args.timeoutMs ?? CLAUDE_SESSION_MOVE_HANDOFF_TIMEOUT_MS
  const sleep = args.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)))
  const polls = Math.max(1, Math.ceil(timeoutMs / CLAUDE_SESSION_MOVE_HANDOFF_POLL_MS))
  const baseline =
    args.baselineReceivedAt ??
    claudeResumeHookBaseline(args.hooks.getStatusSnapshotForPane(args.paneKey))
  let readyByHooks = false
  for (let poll = 0; poll < polls; poll += 1) {
    if (hooksReady(args.hooks, args.paneKey, args.sessionId, baseline)) {
      readyByHooks = true
      break
    }
    await sleep(CLAUDE_SESSION_MOVE_HANDOFF_POLL_MS)
  }
  if (!readyByHooks && hooksReady(args.hooks, args.paneKey, args.sessionId, baseline)) {
    readyByHooks = true
  }
  const screen = await readScreen(args.controller, args.ptyId)
  if (screen !== null && claudeResumeScreenIsShellPrompt(screen)) {
    return 'unsent'
  }
  if (!readyByHooks && (screen === null || !claudeResumeScreenAcceptsHandoff(screen))) {
    return 'unsent'
  }
  const listed: unknown = listJobs(args.jobRoot)
  const jobs = Array.isArray(listed) ? listed.filter(isDetachedJob) : []
  const note = buildClaudeSessionMoveHandoffNote(
    {
      ...args.handoff,
      detachedJobs: detachedJobsForSession(args.sessionId, jobs)
    },
    args.translate
  )
  const wrote = args.controller.write(
    args.ptyId,
    `${buildAgentPromptPasteBytes(note)}${AGENT_PROMPT_SUBMIT}`,
    'orchestration'
  )
  return wrote ? 'sent' : 'unsent'
}

function isDetachedJob(value: unknown): value is ClaudeSessionDetachedJob {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  if (!('id' in value) || typeof value.id !== 'string') {
    return false
  }
  if (!('state' in value) || typeof value.state !== 'string') {
    return false
  }
  if (!('logPath' in value) || typeof value.logPath !== 'string') {
    return false
  }
  return (
    !('sessionId' in value) || value.sessionId === undefined || typeof value.sessionId === 'string'
  )
}

function hooksReady(
  hooks: HandoffHooks,
  paneKey: string,
  sessionId: string,
  baselineReceivedAt: number
): boolean {
  return claudeResumeHooksReady({
    rows: hooks.getStatusSnapshotForPane(paneKey),
    identities: hooks.getProviderSessionIdentities(),
    paneKey,
    sessionId,
    baselineReceivedAt
  })
}

async function readScreen(controller: HandoffController, ptyId: string): Promise<string | null> {
  if (!controller.serializeBuffer) {
    return null
  }
  try {
    const snapshot = await controller.serializeBuffer(ptyId, { scrollbackRows: 0 })
    return snapshot?.data ?? null
  } catch {
    return null
  }
}
