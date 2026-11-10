import { defineMethod } from '../../core'
import { readClaudeAccountLog } from '../../../../claude-accounts/claude-account-log-read'
import {
  AssignClaudePaneParams,
  ClaudeAccountLogParams,
  ClaudeAuthProxyStatusParams,
  RefreshClaudeAccountTokenNowParams,
  SetClaudeAccountPoolParams,
  SetClaudeAccountTokenRefreshParams,
  SetClaudeAuthProxyParams,
  SetClaudeAutoSwitchParams,
  SetClaudeModelPolicyParams,
  SetClaudeSessionMoverParams
} from '../../../../../shared/rpc-contract/accounts-params'

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
  handler: async (params) =>
    readClaudeAccountLog({ since: params.since, before: params.before, limit: params.limit })
})

/** The fork's Claude account policies and pane assignment; each acts on the runtime that owns the accounts. */
export const claudeAccountSettingMethods = [
  defineMethod({
    name: 'accounts.setClaudeAuthProxy',
    permission: 'accounts-admin',
    params: SetClaudeAuthProxyParams,
    handler: async (params, { runtime }) => runtime.setClaudeAuthProxy(params.enabled)
  }),
  defineMethod({
    name: 'accounts.claudeAuthProxyStatus',
    permission: 'accounts-admin',
    params: ClaudeAuthProxyStatusParams,
    handler: async (_params, { runtime }) => runtime.claudeAuthProxyStatus()
  }),
  defineMethod({
    name: 'accounts.setClaudeAccountPool',
    permission: 'accounts-admin',
    params: SetClaudeAccountPoolParams,
    handler: async (params, { runtime }) => runtime.setClaudeAccountPool(params.enabled)
  }),
  setClaudeModelPolicyMethod,
  claudeAccountLogMethod,
  setClaudeAccountTokenRefreshMethod,
  refreshClaudeAccountTokenNowMethod,
  defineMethod({
    name: 'accounts.assignClaudePane',
    permission: 'accounts-admin',
    params: AssignClaudePaneParams,
    handler: async (params, { runtime }) => runtime.assignClaudePane(params)
  }),
  defineMethod({
    name: 'accounts.setClaudeAutoSwitch',
    permission: 'accounts-admin',
    params: SetClaudeAutoSwitchParams,
    handler: async (params, { runtime }) => runtime.setClaudeAutoSwitch(params.enabled)
  }),
  defineMethod({
    name: 'accounts.setClaudeSessionMover',
    permission: 'accounts-admin',
    params: SetClaudeSessionMoverParams,
    handler: async (params, { runtime }) => runtime.setClaudeSessionMover(params.setting)
  })
]
