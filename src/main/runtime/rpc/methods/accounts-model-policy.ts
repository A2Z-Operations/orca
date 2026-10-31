import { defineMethod } from '../core'
import { SetClaudeModelPolicyParams } from '../../../../shared/rpc-contract/accounts-params'

export const setClaudeModelPolicyMethod = defineMethod({
  name: 'accounts.setClaudeModelPolicy',
  permission: 'accounts-admin',
  params: SetClaudeModelPolicyParams,
  handler: async (params, { runtime }) => runtime.setClaudeModelPolicy(params)
})
