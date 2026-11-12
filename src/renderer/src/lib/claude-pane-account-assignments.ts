import type {
  ClaudePaneAssignedEvent,
  ClaudeRateLimitAccountsState,
  ClaudeStructuredSessionSnapshot
} from '../../../shared/managed-account-types'
import { structuredAgentSessionTabId } from '../../../shared/agent-session/view/structured-agent-session-projection'

export type ClaudePaneAccountAssignment = {
  label: string
  email: string
  accountId: string
  model?: string
}

const listeners = new Set<() => void>()
let snapshot: ReadonlyMap<string, ClaudePaneAccountAssignment> = new Map()
/** Saved native chats by pane key, from the host's record of each chat's account home. */
let savedChats: ReadonlyMap<string, ClaudeStructuredSessionSnapshot> = new Map()
let savedChatsRefreshing = false
let savedChatsRefreshQueued = false
let subscribers = 0
let stopEvents: (() => void) | null = null
let startId = 0

function notify(): void {
  for (const listener of listeners) {
    listener()
  }
}

function emit(next: ReadonlyMap<string, ClaudePaneAccountAssignment>): void {
  snapshot = next
  notify()
}

function emitSavedChats(state: ClaudeRateLimitAccountsState): void {
  savedChats = new Map((state.structuredSessions ?? []).map((chat) => [chat.paneKey, chat]))
  notify()
}

const STRUCTURED_PANE_KEY_PREFIX = structuredAgentSessionTabId('')

/** A chat that starts, stops or flips model changes its saved row too. */
function refreshSavedChats(id: number): void {
  const api = window.api?.claudeAccounts
  if (!api) {
    return
  }
  if (savedChatsRefreshing) {
    savedChatsRefreshQueued = true
    return
  }
  savedChatsRefreshing = true
  void api
    .list()
    .then((state) => {
      if (id === startId) {
        emitSavedChats(state)
      }
    })
    .catch(() => {})
    .finally(() => {
      savedChatsRefreshing = false
      if (savedChatsRefreshQueued && id === startId) {
        savedChatsRefreshQueued = false
        refreshSavedChats(id)
      }
    })
}

function applyEvent(
  current: ReadonlyMap<string, ClaudePaneAccountAssignment>,
  event: ClaudePaneAssignedEvent
): ReadonlyMap<string, ClaudePaneAccountAssignment> {
  const next = new Map(current)
  if (!event.accountId) {
    next.delete(event.ptyId)
    return next
  }
  const previous = current.get(event.ptyId)
  const model = event.model !== undefined ? event.model : previous?.model
  next.set(event.ptyId, {
    accountId: event.accountId,
    label: event.label,
    email: event.email,
    ...(model ? { model } : {})
  })
  return next
}

function fromList(
  state: ClaudeRateLimitAccountsState
): ReadonlyMap<string, ClaudePaneAccountAssignment> {
  const next = new Map<string, ClaudePaneAccountAssignment>()
  for (const pane of state.paneAccounts ?? []) {
    next.set(pane.ptyId, {
      accountId: pane.accountId,
      label: pane.label,
      email: pane.email,
      ...(pane.model ? { model: pane.model } : {})
    })
  }
  return next
}

function start(): void {
  const api = window.api?.claudeAccounts
  if (!api || typeof api.list !== 'function' || typeof api.onPaneAssigned !== 'function') {
    return
  }
  const id = ++startId
  const events: ClaudePaneAssignedEvent[] = []
  let listed = false
  stopEvents = api.onPaneAssigned((event) => {
    if (!listed) {
      events.push(event)
      return
    }
    emit(applyEvent(snapshot, event))
    if (event.ptyId.startsWith(STRUCTURED_PANE_KEY_PREFIX)) {
      refreshSavedChats(id)
    }
  })
  void api
    .list()
    .then((state) => {
      if (id !== startId) {
        return
      }
      savedChats = new Map((state.structuredSessions ?? []).map((chat) => [chat.paneKey, chat]))
      let next = fromList(state)
      let applied = 0
      for (;;) {
        while (applied < events.length) {
          const event = events[applied]
          applied += 1
          if (event) {
            next = applyEvent(next, event)
          }
        }
        if (listed) {
          break
        }
        listed = true
      }
      events.length = 0
      emit(next)
    })
    .catch(() => {
      if (id !== startId) {
        return
      }
      let next = snapshot
      const pending = events.slice()
      for (const event of pending) {
        next = applyEvent(next, event)
      }
      listed = true
      for (const event of events.slice(pending.length)) {
        next = applyEvent(next, event)
      }
      events.length = 0
      emit(next)
    })
}

function stop(): void {
  startId += 1
  stopEvents?.()
  stopEvents = null
}

export function subscribeClaudePaneAccounts(listener: () => void): () => void {
  listeners.add(listener)
  subscribers += 1
  if (subscribers === 1) {
    start()
  }
  return () => {
    listeners.delete(listener)
    subscribers -= 1
    if (subscribers === 0) {
      stop()
    }
  }
}

export function getClaudePaneAccountSnapshot(): ReadonlyMap<string, ClaudePaneAccountAssignment> {
  return snapshot
}

export function getClaudeSavedChatSnapshot(): ReadonlyMap<string, ClaudeStructuredSessionSnapshot> {
  return savedChats
}
