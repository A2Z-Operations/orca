import { mkdirSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { writeFileAtomically } from '../codex-accounts/fs-utils'
import type { ClaudePaneAccountRecord } from './claude-pane-account-registry'

/**
 * Daemon PTYs outlive the process that holds the pane registry and the auth proxy. This file keeps
 * each pane's row, and the port its proxy slot was minted on, so a reattach after a restart can
 * recover the billed account and the slot instead of re-deriving both from today's selection.
 */

export type PersistedClaudePaneAccount = ClaudePaneAccountRecord & {
  /** Port of the listener that minted `proxySlot`. A slot is only reusable on the same port. */
  proxyPort?: number
}

type PersistedFile = {
  version: 1
  /** Port the last listener bound. The next start asks for it first. */
  proxyPort?: number
  panes: Record<string, PersistedClaudePaneAccount>
}

export type ClaudePaneAccountPersistence = {
  save: (record: ClaudePaneAccountRecord) => void
  forget: (ptyId: string) => void
  read: (ptyId: string) => PersistedClaudePaneAccount | null
  proxyPort: () => number | null
  setProxyPort: (port: number) => void
}

/** A row this old belongs to a PTY that cannot still be running under this app. */
export const CLAUDE_PANE_ACCOUNT_PERSIST_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000
export const CLAUDE_PANE_ACCOUNT_PERSIST_MAX_ROWS = 500

const PRIVATE_FILE_MODE = 0o600

function isPort(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value < 65536
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isRow(value: unknown): value is PersistedClaudePaneAccount {
  return (
    isRecord(value) &&
    typeof value.ptyId === 'string' &&
    typeof value.accountId === 'string' &&
    typeof value.launchedAt === 'number' &&
    typeof value.pinned === 'boolean'
  )
}

function parse(raw: string | null, now: number): PersistedFile {
  const empty: PersistedFile = { version: 1, panes: {} }
  if (!raw) {
    return empty
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return empty
  }
  if (!isRecord(parsed)) {
    return empty
  }
  const rows = Object.values(isRecord(parsed.panes) ? parsed.panes : {})
    .filter(isRow)
    .filter((row) => now - row.launchedAt <= CLAUDE_PANE_ACCOUNT_PERSIST_MAX_AGE_MS)
    .sort((left, right) => right.launchedAt - left.launchedAt)
    .slice(0, CLAUDE_PANE_ACCOUNT_PERSIST_MAX_ROWS)
  return {
    version: 1,
    ...(isPort(parsed.proxyPort) ? { proxyPort: parsed.proxyPort } : {}),
    panes: Object.fromEntries(rows.map((row) => [row.ptyId, row]))
  }
}

/**
 * Synchronous, atomic and private (0600): slot ids are capabilities.
 * Writes happen on spawn, move, flip, and exit, so there is no batching.
 */
export function createClaudePaneAccountFileStore(options: {
  filePath: string
  /** The port a row's slot was minted on: the live listener's port at save time. */
  listeningPort: () => number | null
  now?: () => number
}): ClaudePaneAccountPersistence {
  const now = options.now ?? Date.now
  let cache: PersistedFile | null = null

  const load = (): PersistedFile => {
    if (cache) {
      return cache
    }
    let raw: string | null = null
    try {
      raw = readFileSync(options.filePath, 'utf8')
    } catch {
      raw = null
    }
    cache = parse(raw, now())
    return cache
  }

  const persist = (file: PersistedFile): void => {
    try {
      mkdirSync(dirname(options.filePath), { recursive: true })
      writeFileAtomically(options.filePath, `${JSON.stringify(file)}\n`, {
        mode: PRIVATE_FILE_MODE
      })
    } catch (error) {
      // Persistence is a restart aid. A failed write must never fail a spawn.
      console.warn('[claude-pane-accounts] could not persist pane accounts', error)
    }
  }

  return {
    save(record) {
      const file = load()
      const port = record.proxySlot ? options.listeningPort() : null
      file.panes[record.ptyId] = { ...record, ...(isPort(port) ? { proxyPort: port } : {}) }
      persist(file)
    },
    forget(ptyId) {
      const file = load()
      if (!(ptyId in file.panes)) {
        return
      }
      delete file.panes[ptyId]
      persist(file)
    },
    read(ptyId) {
      const row = load().panes[ptyId]
      return row ? { ...row } : null
    },
    proxyPort() {
      return load().proxyPort ?? null
    },
    setProxyPort(port) {
      const file = load()
      if (!isPort(port) || file.proxyPort === port) {
        return
      }
      file.proxyPort = port
      persist(file)
    }
  }
}

let installed: ClaudePaneAccountPersistence | null = null

/** The account services install the file store. Unset (tests, WSL guest) means nothing persists. */
export function installClaudePaneAccountPersistence(
  next: ClaudePaneAccountPersistence | null
): void {
  installed = next
}

export function claudePaneAccountPersistence(): ClaudePaneAccountPersistence | null {
  return installed
}
