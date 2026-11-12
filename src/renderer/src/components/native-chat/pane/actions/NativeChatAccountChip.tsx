import { useSyncExternalStore } from 'react'
import { useTranslate } from '@/i18n/use-translate'
import { ClaudePaneAccountChip } from '@/components/tab-bar/ClaudePaneAccountBadge'
import {
  getClaudePaneAccountSnapshot,
  getClaudeSavedChatSnapshot,
  subscribeClaudePaneAccounts
} from '@/lib/claude-pane-account-assignments'
import {
  structuredAgentSessionPaneKey,
  structuredAgentSessionTabId
} from '../../../../../../shared/agent-session/view/structured-agent-session-projection'
import type { NativeChatTabSession } from '../../../tab-bar/tab-session-history-switch'

/** The account and model a Claude chat runs on: the live launch's, else its saved record's. */
export function NativeChatAccountChip({
  nativeChat
}: {
  nativeChat: NativeChatTabSession
}): React.JSX.Element | null {
  const t = useTranslate()
  const live = useSyncExternalStore(
    subscribeClaudePaneAccounts,
    getClaudePaneAccountSnapshot,
    getClaudePaneAccountSnapshot
  )
  const saved = useSyncExternalStore(
    subscribeClaudePaneAccounts,
    getClaudeSavedChatSnapshot,
    getClaudeSavedChatSnapshot
  )
  if (nativeChat.agent !== 'claude') {
    return null
  }
  const key = structuredAgentSessionPaneKey(
    structuredAgentSessionTabId(nativeChat.sessionId),
    nativeChat.sessionId
  )
  const running = live.get(key)
  if (running) {
    return (
      <ClaudePaneAccountChip label={running.label} email={running.email} model={running.model} />
    )
  }
  const chat = saved.get(key)
  if (!chat) {
    return null
  }
  const label =
    chat.label ??
    (chat.account === 'unknown'
      ? t('accounts.claude.unknownAccount', 'unknown account')
      : t('accounts.claude.systemDefault', 'System default'))
  return <ClaudePaneAccountChip label={label} email={chat.email ?? ''} model={chat.model} />
}
