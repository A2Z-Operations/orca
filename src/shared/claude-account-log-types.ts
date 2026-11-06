/**
 * One line of the durable Claude account log (`account-moves.log`, ndjson). Never a token,
 * header, or body: proxy rows carry the method, the upstream path without its query, and the status.
 */
export type ClaudeAccountLogEntry =
  | {
      type: 'decision'
      at: number
      ptyId: string
      paneKey: string | null
      fromAccountId: string
      toAccountId: string | null
      reason: string
      strategy?: 'resume' | 'proxy'
      window?: 'session' | 'weekly' | 'fableWeekly' | null
      percent?: number | null
      detail?: string
      chat?: true
    }
  | {
      type: 'flip'
      at: number
      ptyId: string
      paneKey: string | null
      accountId: string
      modelFrom: string
      modelTo: string
      reason: string
      kind?: 'model'
      strategy?: 'proxy'
    }
  | {
      type: 'proxy-unknown-slot'
      at: number
      method: string
      path: string
      /** Unknown-slot requests folded into this row since the previous one. */
      count: number
    }
  | {
      type: 'proxy-error'
      at: number
      method: string
      path: string
      status: number
      accountId: string | null
      /** Identical errors folded into this row since the previous one. */
      count: number
    }

export type ClaudeAccountLogType = ClaudeAccountLogEntry['type']
