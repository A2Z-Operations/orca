import { defineMethod } from '../core'
import { readClaudeAccountLog } from '../../../claude-accounts/claude-account-log-read'
import {
  ClaudeAccountLogParams,
  RefreshClaudeAccountTokenNowParams,
  SetClaudeAccountTokenRefreshParams,
  SetClaudeModelPolicyParams
} from '../../../../shared/rpc-contract/accounts-params'

export const setClaudeModelPolicyMethod = defineMethod({
  name: 'accounts.setClaudeModelPolicy',
  permission: 'accounts-admin',
  params: SetClaudeModelPolicyParams,
  handler: async (params, { runtime }) => runtime.setClaudeModelPolicy(params)
})

export const setClaudeAccountTokenRefreshMethod = defineMethod({
  name: 'accounts.setClaudeAccountTokenRefresh',
  permission: 'accounts-admin',
  params: SetClaudeAccountTokenRefreshParams,
  handler: async (params, { runtime }) => runtime.setClaudeAccountTokenRefresh(params.enabled)
})

export const refreshClaudeAccountTokenNowMethod = defineMethod({
  name: 'accounts.refreshClaudeAccountTokenNow',
  permission: 'accounts-admin',
  params: RefreshClaudeAccountTokenNowParams,
  handler: async (params, { runtime }) =>
    runtime.refreshClaudeAccountTokenNow({ account: params.account, force: params.force })
})

/** The durable account log on the runtime that owns the sessions. Read-only. */
export const claudeAccountLogMethod = defineMethod({
  name: 'accounts.claudeAccountLog',
  permission: 'accounts-admin',
  params: ClaudeAccountLogParams,
  handler: async (params) => readClaudeAccountLog({ since: params.since, limit: params.limit })
})

export const claudeAccountSettingMethods = [
  setClaudeModelPolicyMethod,
  claudeAccountLogMethod,
  setClaudeAccountTokenRefreshMethod,
  refreshClaudeAccountTokenNowMethod
]
