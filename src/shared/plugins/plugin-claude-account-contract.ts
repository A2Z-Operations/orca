import { z } from 'zod'

/** Public Claude account view. Tokens, credential paths, and billing balances stay on the host. */

export const PLUGIN_CLAUDE_ACCOUNT_LIMIT = 64
export const PLUGIN_CLAUDE_ACCOUNT_ID_MAX_LENGTH = 256
export const PLUGIN_CLAUDE_ACCOUNT_LABEL_MAX_LENGTH = 512
export const PLUGIN_ASSIGNED_SESSION_COUNT_MAX = 10_000
export const PLUGIN_CLAUDE_WINDOW_MINUTES_MAX = 100_000

export const pluginClaudeUsageWindowSchema = z
  .object({
    usedPercent: z.number().min(0).max(100),
    windowMinutes: z.number().int().positive().max(PLUGIN_CLAUDE_WINDOW_MINUTES_MAX),
    resetsAt: z.number().finite().nullable()
  })
  .strict()

export const pluginClaudeAccountUsageSchema = z
  .object({
    session: pluginClaudeUsageWindowSchema.nullable(),
    weekly: pluginClaudeUsageWindowSchema.nullable(),
    fableWeekly: pluginClaudeUsageWindowSchema.nullable(),
    updatedAt: z.number().finite().nullable()
  })
  .strict()

export const pluginClaudeAccountSchema = z
  .object({
    id: z.string().min(1).max(PLUGIN_CLAUDE_ACCOUNT_ID_MAX_LENGTH),
    label: z.string().min(1).max(PLUGIN_CLAUDE_ACCOUNT_LABEL_MAX_LENGTH),
    usage: pluginClaudeAccountUsageSchema,
    assignedSessionCount: z.number().int().nonnegative().max(PLUGIN_ASSIGNED_SESSION_COUNT_MAX)
  })
  .strict()

export const pluginClaudeAccountListSchema = z
  .object({
    accounts: z.array(pluginClaudeAccountSchema).max(PLUGIN_CLAUDE_ACCOUNT_LIMIT)
  })
  .strict()

export const pluginClaudeUsageChangedPayloadSchema = z
  .object({
    accountId: z.string().min(1).max(PLUGIN_CLAUDE_ACCOUNT_ID_MAX_LENGTH),
    label: z.string().min(1).max(PLUGIN_CLAUDE_ACCOUNT_LABEL_MAX_LENGTH),
    usage: pluginClaudeAccountUsageSchema
  })
  .strict()

export const pluginClaudeSessionMovedPayloadSchema = z
  .object({
    ptyId: z.string().min(1).max(1024),
    fromAccountId: z.string().min(1).max(PLUGIN_CLAUDE_ACCOUNT_ID_MAX_LENGTH),
    toAccountId: z.string().min(1).max(PLUGIN_CLAUDE_ACCOUNT_ID_MAX_LENGTH),
    /** Set when a resume move replaced the PTY. Absent when the same process kept running. */
    previousPtyId: z.string().min(1).max(1024).optional()
  })
  .strict()

export type PluginClaudeUsageWindow = z.infer<typeof pluginClaudeUsageWindowSchema>
export type PluginClaudeAccountUsage = z.infer<typeof pluginClaudeAccountUsageSchema>
export type PluginClaudeAccountView = z.infer<typeof pluginClaudeAccountSchema>
export type PluginClaudeUsageChangedPayload = z.infer<typeof pluginClaudeUsageChangedPayloadSchema>
export type PluginClaudeSessionMovedPayload = z.infer<typeof pluginClaudeSessionMovedPayloadSchema>
