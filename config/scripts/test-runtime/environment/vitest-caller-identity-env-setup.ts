// Clear the launching terminal’s inherited Orca identity so test branches depend on fixture env, not which agent launched runner.
//
// orca #48: an Orca terminal exports more than identity, and product code reads much of it: the WSL hosts gate state
// main publishes to its children (readers prefer it over the gate a test sets), the agent hook endpoint and token,
// pane, tab and terminal handles, the user data path, and per-agent config folders. A run from an Orca terminal then
// differed from a run started over ssh (the Dell gates), which has none of them. This list is every ORCA_* variable an
// Orca agent terminal exported on 2026-11-15 (read from a live one), plus the two identity names it did not set. The
// runner's own ORCA_* settings (ORCA_VITEST_RUNTIME, ORCA_UNIT_MODULE_CACHE_PATH, ...) are not in it.
export const INHERITED_ORCA_TERMINAL_ENV = [
  // identity
  'ORCA_AGENT_SESSION_ID',
  'ORCA_STRUCTURED_SESSION',
  'ORCA_WORKTREE_ID',
  'ORCA_WORKSPACE_ID',
  'ORCA_WORKSPACE_ROOT',
  'ORCA_PROJECT_GROUP_ID',
  'ORCA_RUNTIME_SOURCE_ID',
  'ORCA_RUNTIME_SOURCE_INCARNATION',
  'ORCA_RUNTIME_SOURCE_PROFILE_PATH',
  // the pane and terminal this runner was started from
  'ORCA_PANE_KEY',
  'ORCA_TAB_ID',
  'ORCA_TERMINAL_HANDLE',
  'ORCA_AGENT_PANE',
  'ORCA_HISTFILE',
  'ORCA_IMAGE_PROTOCOL',
  // the running app and its data
  'ORCA_APP_VERSION',
  'ORCA_USER_DATA_PATH',
  'ORCA_CLI_BIN_DIR',
  'ORCA_WSL_HOSTS_GATE_STATE',
  // the agent hook server of the running app
  'ORCA_AGENT_HOOK_ENDPOINT',
  'ORCA_AGENT_HOOK_ENV',
  'ORCA_AGENT_HOOK_OPENCODE_TUI',
  'ORCA_AGENT_HOOK_PORT',
  'ORCA_AGENT_HOOK_TOKEN',
  'ORCA_AGENT_HOOK_TRANSPORT',
  'ORCA_AGENT_HOOK_VERSION',
  // the launching agent's own config
  'ORCA_CLAUDE_AGENT_VIEW_PLUGIN_DIR',
  'ORCA_CLAUDE_CONFIG_DIR',
  'ORCA_CLAUDE_INJECTED_CONFIG_DIR',
  'ORCA_CLAUDE_PROFILE_POINTER',
  'ORCA_CODEX_HOME',
  'ORCA_DURABLE_JOB_PLUGIN_DIR',
  'ORCA_OPENCODE_AGENT',
  'ORCA_PI_SOURCE_AGENT_DIR'
] as const

for (const name of INHERITED_ORCA_TERMINAL_ENV) {
  delete process.env[name]
}
