import { defineMethod } from '../core'
import {
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

export const claudeAccountSettingMethods = [
  setClaudeModelPolicyMethod,
  setClaudeAccountTokenRefreshMethod,
  refreshClaudeAccountTokenNowMethod
]
