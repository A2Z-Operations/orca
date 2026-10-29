import { GLOBAL_FLAGS, LOCAL_COMMAND_FLAGS, type CommandSpec } from '../args'

// Terminal login lets headless hosts manage accounts without the desktop login UI.
export const ACCOUNT_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['account', 'add'],
    summary: 'Add a managed agent account by signing in on this Orca host',
    usage:
      'orca account add [--agent claude|codex|opencode|devin] [--label <name>] [--integration <id>] [--json]',
    allowedFlags: [...LOCAL_COMMAND_FLAGS, 'agent', 'label', 'integration'],
    notes: [
      'Runs the agent login (`claude login` / `codex login`) in this terminal, then registers the account with the local Orca runtime.',
      'Codex uses device authorization so the browser can complete sign-in from a different machine.',
      'OpenCode 2 uses `opencode auth login --standalone` in private XDG directories. Devin uses `devin auth login --force-manual-token-flow`.',
      'Use --integration <id> to skip the OpenCode integration picker; --label names the saved OpenCode or Devin profile.',
      'OpenCode and Devin profiles apply to new explicit host agent launches. Direct SSH relay and Windows-hosted WSL selection are not supported; run the command on a headless Orca runtime on that host.',
      'Sign in with the account you want to add (e.g. use a private/incognito browser window for a second account).',
      '--agent defaults to claude. Requires the Orca runtime to be running on this machine.'
    ],
    examples: ['orca account add', 'orca account add --agent codex']
  },
  {
    path: ['account', 'list'],
    summary: 'List managed agent accounts on this Orca host',
    usage: 'orca account list [--agent opencode|devin] [--json]',
    allowedFlags: [...LOCAL_COMMAND_FLAGS, 'agent'],
    notes: [
      'Lists the accounts on this machine. `--environment` / `--pairing-code` are rejected rather than ignored; run it on the host whose accounts you want to see.'
    ],
    examples: ['orca account list']
  },
  {
    path: ['account', 'select'],
    summary: 'Select an OpenCode or Devin profile for new agent launches',
    usage: 'orca account select --agent opencode|devin --account <id|system> [--json]',
    allowedFlags: [...LOCAL_COMMAND_FLAGS, 'agent', 'account']
  },
  {
    path: ['account', 'rm'],
    aliases: [['account', 'remove']],
    destructive: true,
    summary: 'Remove a managed OpenCode or Devin profile and its private data',
    usage: 'orca account rm --agent opencode|devin --account <id> [--json]',
    allowedFlags: [...LOCAL_COMMAND_FLAGS, 'agent', 'account'],
    notes: [
      'Deletes credentials and conversation data in the managed profile. Stop its running agents first. System credentials are never removed.'
    ]
  },
  {
    path: ['account', 'auto-switch'],
    summary: 'Turn automatic Claude account switching before a usage limit on or off',
    usage:
      'orca account auto-switch --agent claude (--on | --off) [--environment <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'agent', 'on', 'off'],
    notes: [
      'Writes the host setting behind Settings › Accounts › Claude › "Switch accounts before a usage limit" (accounts.setClaudeAutoSwitch). Default off.',
      'With --environment the setting is written on that paired Orca server, whose accounts the switch then rotates.',
      'Lines: 5-hour window 95 %, weekly and Fable-weekly windows 90 %; the switch applies to the next Claude started.'
    ],
    examples: [
      'orca account auto-switch --agent claude --on',
      'orca account auto-switch --agent claude --on --environment macstudio'
    ]
  },
  {
    path: ['account', 'session-mover'],
    summary: 'Choose whether running Claude sessions move to another account before a usage limit',
    usage:
      'orca account session-mover --agent claude (--off | --ask | --move) [--environment <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'agent', 'off', 'ask', 'move'],
    notes: [
      'Writes the host setting behind Settings › Accounts › Claude › "Move running sessions before a usage limit" (accounts.setClaudeSessionMover). Default ask.',
      'move: a running session whose own account passes a line (5-hour 95 %, weekly or Fable-weekly 90 %) resumes between turns, in the same pane, on the account with the most room. ask: the desktop shows a notice instead; a headless server treats ask as move. off: never.',
      'With --environment the setting is written on that paired Orca server, whose sessions it then governs. `orca account list --json` shows the last decision per live session under claude.sessionMoves.'
    ],
    examples: [
      'orca account session-mover --agent claude --move',
      'orca account session-mover --agent claude --move --environment macstudio'
    ]
  },
  {
    path: ['account', 'auth-proxy'],
    summary: 'Bill Claude through a local auth proxy so a running session can change accounts',
    usage:
      'orca account auth-proxy --agent claude (--on | --off | --status) [--environment <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'agent', 'on', 'off', 'status'],
    notes: [
      'Writes the host setting behind Settings › Accounts › Claude › "Bill Claude through a local auth proxy" (accounts.setClaudeAuthProxy). Default off.',
      '--status reads the live listener (accounts.claudeAuthProxyStatus): port, slots, requests in the last hour, and the last error. It does not change the setting.',
      'A user-set ANTHROPIC_BASE_URL is left unchanged. With --environment the setting is written on that paired Orca server.'
    ],
    examples: [
      'orca account auth-proxy --agent claude --off',
      'orca account auth-proxy --agent claude --on --environment macstudio',
      'orca account auth-proxy --agent claude --status'
    ]
  }
]
