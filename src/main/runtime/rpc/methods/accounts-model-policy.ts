import { defineMethod } from '../core'
import {
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

export const claudeAccountSettingMethods = [
  setClaudeModelPolicyMethod,
  setClaudeAccountTokenRefreshMethod
]
