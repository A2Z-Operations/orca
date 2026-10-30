# accounts.read example

This worker is an example, not a plugin Orca loads. `accounts.read` is read-only. The host method is `accounts.listClaudeAccounts` (`pluginApi` 1, since minor `1`). Workers call it as `orca.host.call('accounts.listClaudeAccounts')`. Sandboxed panels cannot call it.

The result is `{ accounts: [{ id, label, usage, assignedSessionCount }] }`. `usage` has `session`, `weekly`, `fableWeekly`, and `updatedAt`. Each window is `{ usedPercent, windowMinutes, resetsAt }` or null. `label` is the account email. Tokens, credential paths, and billing balances are not included.

Declare the events on the manifest. Each account event requires `accounts.read`. `events:subscribe` does not grant it.

```json
{
  "manifestVersion": 1,
  "id": "account-usage",
  "publisher": "example",
  "name": "Account usage",
  "version": "1.0.0",
  "engines": { "orca": ">=1.4.243" },
  "pluginApi": 1,
  "main": "main.mjs",
  "capabilities": [{ "kind": "accounts.read" }],
  "contributes": {
    "events": [{ "on": "accounts.usage.changed" }, { "on": "accounts.session.moved" }]
  }
}
```

```js
// Capability accounts.read. The host never sends tokens or credential paths.
// Declare the events in contributes.events. events:subscribe does not cover them.
export default async function activate(orca) {
  const line = (label, usage, sessions) => {
    const session = usage.session?.usedPercent ?? '-'
    const weekly = usage.weekly?.usedPercent ?? '-'
    orca.log(`${label} sessions=${sessions} session=${session}% weekly=${weekly}%`)
  }
  orca.events.on('accounts.usage.changed', (event) => {
    line(event.label, event.usage, '?')
  })
  orca.events.on('accounts.session.moved', (event) => {
    orca.log(`moved ${event.ptyId} ${event.fromAccountId} -> ${event.toAccountId}`)
  })
  const { accounts } = await orca.host.call('accounts.listClaudeAccounts')
  for (const account of accounts) {
    line(account.label, account.usage, account.assignedSessionCount)
  }
}
```
