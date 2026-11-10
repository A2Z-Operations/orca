import { LOCAL_COMMAND_FLAGS, type CommandSpec } from '../args'

// Terminal login lets headless hosts manage accounts without the desktop login UI.
export const ACCOUNT_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['account', 'add'],
    summary: 'Add a managed agent account by signing in on this Orca host',
    usage:
      'orca account add [--agent claude|codex|opencode|devin] [--label <name>] [--integration <id>] [--method <id>] [--answer <key=value>]... [--json]',
    allowedFlags: [...LOCAL_COMMAND_FLAGS, 'agent', 'label', 'integration', 'method', 'answer'],
    repeatableFlags: ['answer'],
    notes: [
      'Runs the agent login (`claude login` / `codex login`) in this terminal, then registers the account with the local Orca runtime.',
      'Codex uses device authorization so the browser can complete sign-in from a different machine.',
      'OpenCode 2 uses `opencode auth login --standalone` in private XDG directories. Devin uses `devin auth login --force-manual-token-flow`.',
      'Use --integration <id> to skip the OpenCode integration picker; --label names the saved OpenCode or Devin profile.',
      'Use --method <id> and repeated --answer <key=value> to pass OpenCode its login method and form answers, so sign-in can finish without an interactive terminal.',
      'Antigravity accounts are saved from the current `agy` login in Orca Settings > AI Provider Accounts.',
      'OpenCode and Devin profiles apply to new explicit host agent launches. Direct SSH relay and Windows-hosted WSL selection are not supported; run the command on a headless Orca runtime on that host.',
      'Sign in with the account you want to add (e.g. use a private/incognito browser window for a second account).',
      '--agent defaults to claude. Requires the Orca runtime to be running on this machine.'
    ],
    examples: [
      'orca account add',
      'orca account add --agent codex',
      'orca account add --agent opencode --integration github-copilot --method <id> --answer <key=value>'
    ]
  },
  {
    path: ['account', 'list'],
    summary: 'List managed agent accounts on this Orca host',
    usage: 'orca account list [--agent claude|codex|opencode|devin|antigravity] [--json]',
    allowedFlags: [...LOCAL_COMMAND_FLAGS, 'agent'],
    notes: [
      "Lists the accounts on this machine with the ids `orca account select` and `orca account rm` accept. `system` is the provider's own sign-in outside Orca.",
      '`--environment` / `--pairing-code` are rejected rather than ignored; run it on the host whose accounts you want to see.'
    ],
    examples: ['orca account list', 'orca account list --agent claude']
  },
  {
    path: ['account', 'select'],
    summary: 'Select the account new agent launches use on this Orca host',
    usage:
      'orca account select --agent claude|codex|opencode|devin|antigravity --account <id|email|label|system> [--json]',
    allowedFlags: [...LOCAL_COMMAND_FLAGS, 'agent', 'account'],
    notes: [
      "--account takes an id, email or label from `orca account list`, or `system` for the provider's own sign-in. An email shared by several accounts is refused; pass the id.",
      'The selection applies to agents launched on this host after it, like the status-bar account switcher. Antigravity has no `system` default.'
    ],
    examples: [
      'orca account select --agent claude --account me@work.example',
      'orca account select --agent codex --account system',
      'orca account select --agent antigravity --account me@gmail.example'
    ]
  },
  {
    path: ['account', 'rm'],
    aliases: [['account', 'remove']],
    destructive: true,
    summary: 'Remove a managed agent account and its private data',
    usage:
      'orca account rm --agent claude|codex|opencode|devin|antigravity --account <id|email|label> [--json]',
    allowedFlags: [...LOCAL_COMMAND_FLAGS, 'agent', 'account'],
    notes: [
      'Deletes the credentials Orca saved for that account (and, for OpenCode and Devin, the conversation data in its profile). Stop its running agents first. System credentials are never removed.',
      'Select another Antigravity account before removing the one in use.'
    ]
  },
  {
    path: ['account', 'auto-switch'],
    summary: 'Turn automatic Claude account switching before a usage limit on or off',
    usage:
      'orca account auto-switch --agent claude (--on | --off | --status) [--environment <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'agent', 'on', 'off', 'status'],
    notes: [
      'Writes the host setting behind Settings › Accounts › Claude › "Switch accounts before a usage limit" (accounts.setClaudeAutoSwitch). Default on.',
      'With --environment the setting is written on that paired Orca server, whose accounts the switch then rotates.',
      'Lines: 5-hour window 95 %, weekly and Fable-weekly windows 90 %; the switch applies to the next Claude started.',
      '--status reads accounts.list and changes nothing: the setting, the selected account, and how many accounts have a usage reading and how many are at a line.'
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
      'orca account session-mover --agent claude (--off | --ask | --move | --status) [--environment <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'agent', 'off', 'ask', 'move', 'status'],
    notes: [
      'Writes the host setting behind Settings › Accounts › Claude › "Move running sessions before a usage limit" (accounts.setClaudeSessionMover). Default move.',
      'move: a running session whose own account passes a line (5-hour 95 %, weekly or Fable-weekly 90 %) resumes between turns, in the same pane, on the account with the most room. ask: the desktop shows a notice instead; a headless server treats ask as move. off: never.',
      'With --environment the setting is written on that paired Orca server, whose sessions it then governs. `orca account list --json` shows the last decision per live session under claude.sessionMoves.',
      '--status reads accounts.list and changes nothing: the setting, live sessions by strategy (proxy or resume), the last decisions counted by reason, and model flips.'
    ],
    examples: [
      'orca account session-mover --agent claude --move',
      'orca account session-mover --agent claude --move --environment macstudio'
    ]
  },
  {
    path: ['account', 'pool'],
    summary: 'Spread new Claude sessions across signed-in accounts',
    usage:
      'orca account pool --agent claude (--on | --off | --status) [--environment <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'agent', 'on', 'off', 'status'],
    notes: [
      'Writes the host setting behind Settings › Accounts › Claude › "Spread sessions across accounts" (accounts.setClaudeAccountPool). Default on.',
      'On: a new Claude session starts on the signed-in account with the most room left. Off: launches use the selected account.',
      'With --environment the setting is written on that paired Orca server. `orca account list` shows pool: on|off and sessions: <count> on each account.',
      '--status reads accounts.list and changes nothing: the setting and the live sessions billed to each account.'
    ],
    examples: [
      'orca account pool --agent claude --on',
      'orca account pool --agent claude --off --environment macstudio'
    ]
  },
  {
    path: ['account', 'model-policy'],
    summary: 'Spend Fable while both weekly windows have room, otherwise Opus 5.5',
    usage:
      'orca account model-policy --agent claude (--on | --off | --status | --set fable-line=<n> | --set weekly-guard=<n> | --set covers-explicit=on|off) [--environment <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'agent', 'on', 'off', 'status', 'set'],
    repeatableFlags: ['set'],
    notes: [
      'Writes claudeModelPolicy (accounts.setClaudeModelPolicy). Default on: Fable while Fable is under 90% and the regular weekly window is under 91%. Otherwise that account runs Opus 5.5.',
      '--set accepts fable-line and weekly-guard, repeated or comma-separated (fable-line=80,weekly-guard=85). Lines clamp to 1–100.',
      'covers-explicit=on (claudeModelPolicyCoversExplicit) lets the policy also switch a session launched with --model or ANTHROPIC_MODEL set to Fable or Opus, and take over one that recorded no model. Off, the default, leaves them on their model. Another model such as Sonnet is never switched.',
      '--status reads accounts.list and does not change the setting. It prints the lines and the last evaluation per live pane (pane, account, model, source, choice, reason, when). A running session switches models through the auth proxy, without a restart, at most once per 10 minutes. Changing the lines re-evaluates immediately.',
      'With --environment the setting is written on that paired Orca server. An explicit --model or ANTHROPIC_MODEL on a launch stays pinned.'
    ],
    examples: [
      'orca account model-policy --agent claude --status',
      'orca account model-policy --agent claude --set fable-line=80 --set weekly-guard=85',
      'orca account model-policy --agent claude --set covers-explicit=on',
      'orca account model-policy --agent claude --off --environment macstudio'
    ]
  },
  {
    path: ['account', 'usage'],
    summary: "Print each managed Claude account's last usage reading",
    usage: 'orca account usage --agent claude [--environment <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'agent'],
    notes: [
      'Reads usageWindows from accounts.list without asking the runtime to fetch: 5-hour, weekly, and Fable-weekly percent, the age of the reading, and whether it is the selected reading or the inactive-account cache. * marks the selected account.',
      'A blank window was not read yet; a named failure (401, 429, keychain denied, sign in again) says why.'
    ],
    examples: ['orca account usage --agent claude', 'orca account usage --agent claude --json']
  },
  {
    path: ['account', 'moves'],
    summary: "Show the Claude session mover's last decision for each live session",
    usage:
      'orca account moves [--agent claude] [--log [--since <iso>]] [--environment <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'agent', 'log', 'since'],
    notes: [
      'Reads claude.sessionMoves from accounts.list on the runtime that owns the sessions.',
      '--log reads the durable account log (accounts.claudeAccountLog, account-moves.log in the Orca logs folder): every mover decision with its reason, model flip, unknown proxy slot, and proxy upstream error, across restarts. --since keeps rows at or after that time. No tokens, headers, or bodies are logged.',
      'Each line is the time, the pane (or pty when the pane key is absent), from → to, the reason, and the strategy (resume or proxy). A host that predates strategies prints -.',
      'With --environment the decisions are read from that paired Orca server. --json prints the sessionMoves array.'
    ],
    examples: [
      'orca account moves',
      'orca account moves --log --since 2026-11-05T06:00:00Z',
      'orca account moves --environment my-server --json'
    ]
  },
  {
    path: ['account', 'auth-proxy'],
    summary:
      'Bill Claude through a local auth proxy so a session can change accounts without restarting',
    usage:
      'orca account auth-proxy --agent claude (--on | --off | --status) [--environment <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'agent', 'on', 'off', 'status'],
    notes: [
      'Writes the host setting behind Settings › Accounts › Claude › "Bill Claude through a local auth proxy" (accounts.setClaudeAuthProxy). Default on.',
      "On: each Claude pane talks to a loopback proxy that sets the bearer for the account assigned to that pane. Off: today's behaviour, CLAUDE_CONFIG_DIR only.",
      '--status prints the live listener (accounts.claudeAuthProxyStatus): port, slot → account, requests in the last hour, and the last error. It does not change the setting.',
      'With --environment the setting is written on that paired Orca server. A user-set ANTHROPIC_BASE_URL is left unchanged.'
    ],
    examples: [
      'orca account auth-proxy --agent claude --off',
      'orca account auth-proxy --agent claude --on --environment macstudio',
      'orca account auth-proxy --agent claude --status'
    ]
  },
  {
    path: ['account', 'token-refresh'],
    summary: 'Refresh access tokens for idle managed Claude accounts',
    usage:
      'orca account token-refresh --agent claude (--on | --off | --status | --now <email|id>) [--force] [--environment <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'agent', 'on', 'off', 'status', 'now', 'force'],
    notes: [
      'Writes claudeAccountTokenRefresh (accounts.setClaudeAccountTokenRefresh). Default on: an idle account refreshes its access token the way Claude Code does, then usage and the auth proxy retry once.',
      'Refreshes are serialized, capped per usage poll, and back off together when the token endpoint returns 429.',
      'A live Claude session for that account is left alone. invalid_grant is lapsed and is not retried.',
      '--status reads accounts.list and does not change the setting. It prints last refresh, next retry, lapsed, queue position, and backoff level.',
      '--now refreshes one account on the runtime that holds it. --force skips the backoff wait. A live session is still left alone.',
      'With --environment the setting is written on that paired Orca server.'
    ],
    examples: [
      'orca account token-refresh --agent claude --status',
      'orca account token-refresh --agent claude --now ada@example.com',
      'orca account token-refresh --agent claude --off',
      'orca account token-refresh --agent claude --on --environment macstudio'
    ]
  }
]
