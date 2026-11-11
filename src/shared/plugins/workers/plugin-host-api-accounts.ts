import { z } from 'zod'
import { pluginClaudeAccountListSchema } from './plugin-claude-account-contract'
import { spec, WORKER_ONLY } from './plugin-host-method-spec'

/** Fork: the managed Claude accounts and their usage, for workers holding `accounts.read`; spread into PLUGIN_HOST_API. */
export const PLUGIN_ACCOUNTS_API = {
  'accounts.listClaudeAccounts': spec({
    summary:
      'Lists the managed Claude accounts with their labels, usage windows and how many sessions each is running. Tokens and credential paths never leave the host.',
    since: 1,
    scope: 'host-accounts',
    capability: 'accounts.read',
    mutation: false,
    surfaces: WORKER_ONLY,
    params: z.strictObject({}).optional(),
    result: pluginClaudeAccountListSchema
  })
}
