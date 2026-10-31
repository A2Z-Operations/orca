import { createHash } from 'node:crypto'
import type { ClaudeOAuthCredentialReadOptions } from './claude-oauth-credentials'
import type {
  ClaudeOAuthCredentialDocument,
  ClaudeOAuthCredentialStore
} from './claude-oauth-credential-document'

export type ClaudeOAuthRefreshResult =
  | { outcome: 'refreshed'; accessToken: string }
  | { outcome: 'skipped'; reason: 'disabled' | 'live-session' | 'backoff' | 'no-refresh-token' }
  | { outcome: 'failed'; reason: string }
  | { outcome: 'lapsed' }

export type ClaudeOAuthRefreshAccountStatus = {
  accountId: string
  lastRefreshAt: number | null
  nextRetryAt: number | null
  lapsed: boolean
}

export type PendingWrite = {
  store: ClaudeOAuthCredentialStore
  json: string
  accessToken: string
}

export type AccountBook = {
  lastRefreshAt: number | null
  nextRetryAt: number | null
  failures: number
  lapsed: boolean
  lapsedHash: string | null
  pending: PendingWrite | null
}

export type ClaudeOAuthRefreshDeps = {
  now: () => number
  fetch: (url: string, init: RequestInit) => Promise<Response>
  readDocument: (
    options: ClaudeOAuthCredentialReadOptions | undefined
  ) => Promise<
    | { ok: true; document: ClaudeOAuthCredentialDocument }
    | { ok: false; reason: 'keychain-unavailable' | 'no-refresh-token' | 'unreadable' }
  >
  writeDocument: (pending: PendingWrite) => Promise<void>
  hasLiveSession: (accountId: string) => boolean
  enabled: () => boolean
}

const FIRST_BACKOFF_MS = 5 * 60 * 1000
const NEXT_BACKOFF_MS = 30 * 60 * 1000

const books = new Map<string, AccountBook>()
const inflight = new Map<string, Promise<ClaudeOAuthRefreshResult>>()
let enabledReader: () => boolean = () => true
let cycleId = 0
const claimedCycle = new Map<string, number>()

export function setClaudeOAuthRefreshEnabled(read: () => boolean): void {
  enabledReader = read
}

export function claudeOAuthRefreshIsEnabled(): boolean {
  return enabledReader()
}

export function beginClaudeOAuthRefreshCycle(): void {
  cycleId += 1
}

/** One refresh attempt per account for the current inactive-usage cycle. */
export function claimClaudeUsageRefresh(accountId: string): boolean {
  if (claimedCycle.get(accountId) === cycleId) {
    return false
  }
  claimedCycle.set(accountId, cycleId)
  return true
}

export function claudeOAuthRefreshStatus(): ClaudeOAuthRefreshAccountStatus[] {
  return [...books.entries()].map(([accountId, book]) => ({
    accountId,
    lastRefreshAt: book.lastRefreshAt,
    nextRetryAt: book.nextRetryAt,
    lapsed: book.lapsed
  }))
}

export function resetClaudeOAuthRefreshStateForTests(): void {
  books.clear()
  inflight.clear()
  claimedCycle.clear()
  cycleId = 0
  enabledReader = () => true
}

/** `profile:<id>` and `profile:<id>:wsl:<distro>`. System default keeps its provenance string. */
export function claudeOAuthRefreshAccountId(provenance: string | undefined): string | null {
  if (!provenance || provenance === 'profile:unavailable') {
    return null
  }
  if (provenance.startsWith('profile:')) {
    const rest = provenance.slice('profile:'.length)
    const wslAt = rest.indexOf(':wsl:')
    const accountId = wslAt === -1 ? rest : rest.slice(0, wslAt)
    return accountId && accountId !== 'unavailable' ? accountId : null
  }
  if (provenance === 'system' || provenance.startsWith('wsl:')) {
    return provenance
  }
  return null
}

export function claudeOAuthRefreshInflight(
  accountId: string,
  start: () => Promise<ClaudeOAuthRefreshResult>
): Promise<ClaudeOAuthRefreshResult> {
  const existing = inflight.get(accountId)
  if (existing) {
    return existing
  }
  const run = start().finally(() => {
    if (inflight.get(accountId) === run) {
      inflight.delete(accountId)
    }
  })
  inflight.set(accountId, run)
  return run
}

export function claudeOAuthRefreshBook(accountId: string): AccountBook {
  const existing = books.get(accountId)
  if (existing) {
    return existing
  }
  const created: AccountBook = {
    lastRefreshAt: null,
    nextRetryAt: null,
    failures: 0,
    lapsed: false,
    lapsedHash: null,
    pending: null
  }
  books.set(accountId, created)
  return created
}

export function noteClaudeOAuthRefreshFailure(book: AccountBook, now: number): void {
  book.failures += 1
  book.nextRetryAt = now + (book.failures <= 1 ? FIRST_BACKOFF_MS : NEXT_BACKOFF_MS)
}

export function noteClaudeOAuthRefreshSuccess(book: AccountBook, now: number): void {
  book.failures = 0
  book.nextRetryAt = null
  book.lapsed = false
  book.lapsedHash = null
  book.lastRefreshAt = now
}

export function logClaudeOAuthRefresh(accountId: string, outcome: 'ok' | `failed=${string}`): void {
  console.info(`[claude-usage] refresh account=${accountId} ${outcome}`)
}

export function hashClaudeOAuthRefreshToken(refreshToken: string): string {
  return createHash('sha256').update(refreshToken).digest('hex')
}
