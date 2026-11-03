# claude-pick — launch Claude Code on the Orca account with the most room for its model

Built 2026-10-19 from `docs/superpowers/plans/2026-10-19-claude-pick-launcher.md` (commits `ad76c1c`, `4ad94ce`, + this doc). Source `scripts/orca/`; installed at `~/.local/bin/claude-pick` → `~/.local/lib/claude-pick/{claude-pick,claude_pick.py,orca_usage.py,usage_policy.py}` on the MacBook and the Mac Studio.

## What it does

```
claude-pick [--model fable|opus|sonnet] [--dry-run] [--refresh] -- <claude args>
```

1. `orca_usage.py` asks `orca account list --json` for every Orca-managed Claude account (id → email), maps each id to its Orca profile folder `$ORCA_USER_DATA_PATH/claude-profiles/<id>/home`, reads that profile's OAuth token from the keychain item `Claude Code-credentials-<sha256(home)[:8]>` (the same item the `claude` binary writes), and calls Anthropic's usage endpoint (`GET https://api.anthropic.com/api/oauth/usage`, header `anthropic-beta: oauth-2025-04-20`). Result per account = the Studio `usage.json` shape (`five_hour`, `seven_day`, `fable_7d` from the `weekly_scoped` limit whose model is Fable, resets, locks), cached in `~/.config/orca-pick/usage.json` for 15 min (`--refresh` re-reads).
2. `claude_pick.py` applies the SAME policy module as the Buzz fleet — `usage_policy.py` is a verbatim copy of `scripts/buzz/usage_policy.py` and `tests/test_claude_pick.py` fails if the two copies drift. An account is OUT for a model when any window relevant to it is at or past its line, or locked, or unreadable; among the healthy ones the pick is the largest bottleneck headroom (line minus used over the model's windows), ties → the account Orca has selected, then the email.
3. It then `exec`s `claude --model <model> <args>` with `CLAUDE_CONFIG_DIR` (and `ORCA_CLAUDE_INJECTED_CONFIG_DIR`) set to that profile home and `CLAUDE_PICK_ACCOUNT=<email>` in the environment, dropping any `CLAUDE_CODE_OAUTH_TOKEN`. Orca's hook environment (`ORCA_AGENT_HOOK_*`) is inherited untouched, so Orca keeps tracking the session.

### The three lines

| window | counts for | line | env override |
|---|---|---|---|
| 5-hour | every model | 95 % | `PICK_HI5` |
| weekly (7-day) | every model | 90 % | `PICK_HI7` |
| Fable weekly (`weekly_scoped`, model Fable) | fable only | 90 % | `PICK_HIF` |

So a Fable launch and an Opus launch can land on different accounts at the same time (an account with Fable at 100 % but weekly at 50 % is fine for Opus, out for Fable), and a later global account switch in Orca's UI leaves running pinned sessions alone.

### Account ↔ profile mapping (MacBook, 2026-10-19)

`orca account list --json` → `.result.claude.accounts[] {id, email}` + `.result.claude.activeAccountId`. Seven profile folders exist here, one per account. An account WITHOUT a profile folder cannot be picked (the table says `no Orca profile folder yet (select the account once in Orca)`).

Live table from this Orca terminal (`orca_usage.py --refresh`, `*` = Orca's selected account):

```
account                                    5h%   7d% fable%  note
 sam@sabrent.com                           2.0  29.0      0
*reports@sabrent.com                      76.0  49.0     84
 nachumi770@gmail.com                      0.0  86.0    100
 admin@gmyegroup.com                       0.0  63.0    100
 nachum@gmyegroup.com                      0.0  92.0    100
 nachumi_e@me.com                          0.0  60.0    100
 hello@getblowzer.com                      7.0   5.0      0
```

Dry runs (stderr line + the chosen profile home on stdout):

```
$ claude-pick --model opus --dry-run
claude-pick: opus on hello@getblowzer.com (headroom 85 pts)
/Users/nachumieliyahu/Library/Application Support/orca/claude-profiles/9be8ca69-bdb2-4421-a960-7def7d06f36d/home
$ claude-pick --model fable --dry-run
claude-pick: fable on hello@getblowzer.com (headroom 85 pts)
/Users/nachumieliyahu/Library/Application Support/orca/claude-profiles/9be8ca69-bdb2-4421-a960-7def7d06f36d/home
```

(Both models chose the same account this time because one account had the most room for everything; the unit test `test_fable_and_opus_pick_different_accounts` covers the split case.)

## Proofs (2026-10-19, from the leader's Orca terminal)

**1. One-turn launch, pinned to the picked profile:**

```
$ claude-pick --model opus -- -p "Reply with exactly: pick ok" --max-turns 1 --output-format text
claude-pick: opus on hello@getblowzer.com (headroom 85 pts)
pick ok
(11 s, exit 0)
```

(Claude also printed a pre-existing warning about a `Bash(ssh *@…:*)` permission rule in that profile's `settings.json` — unrelated to claude-pick.)

**2. Orca terminal + orchestration adoption** — did Orca show the agent row? **Yes.** Did `worker-start` reach ready? **Yes.**

```
$ orca terminal create --worktree path:/Users/nachumieliyahu/Documents/claude/BLOWzer --command "claude-pick --model opus" --title "pick-test" --json
  → .result.terminal.handle = term_ea94deae-1525-4abf-ae85-6fd922e599f6
$ orca terminal wait --terminal $H --for tui-idle            → satisfied: true, status: running
$ orca terminal read --terminal $H --screen                   → Claude Code v2.1.303 · Opus 5.5 · Claude Max · ~/Documents/claude/BLOWzer
$ orca terminal show --terminal $H --json                      → "title": "✳ Claude Code", "agentIdentity": "claude", "connected": true
   (the list preview showed the hello@getblowzer.com profile path …/claude-profiles/9be8ca69-…/home/settings.json = the pin)

$ orca orchestration worker-start --spec "Reply with the single word READY and finish." --terminal $H --worktree path:… --timeout-ms 120000 --json
  FIRST ATTEMPT: ok=false, error.code=consumer_fenced — "worker-start requires the coordinator terminal currently bound to the Task Run."
  → orca orchestration run-current showed run: null, so:
$ orca orchestration run-create --objective "claude-pick adoption test …" --json     → run_32127c05207c bound to this coordinator
$ orca orchestration worker-start … (same command)
  → ok=true, state "ready", stage "input_accepted", turnStart "observed",
    effects: worktree reused, terminal term_ea94deae-… reused as role agent, dispatch_input accepted
    taskId task_676dd214e1a3, dispatchId ctx_6e9255c203ab (2.0 s)
$ orca orchestration check --wait --types worker_done,escalation,question --timeout-ms 90000 --json
  → type "worker_done", from_handle term_ea94deae-…, subject "READY",
    body "READY. Replied with the single word READY as instructed. Nothing left.",
    payload outcome "succeeded" (03:21:57Z, 14 s after the dispatch)
  screen: "⏺ READY — Worked for 13s · done 8:21 PM"
$ orca orchestration check --ack delivery_5f592702d704; orca orchestration worker-release --dispatch ctx_6e9255c203ab; orca terminal close --terminal $H
```

## Leader recipe: a worker on a chosen model, on the roomiest account

```bash
# once per coordinator terminal
orca orchestration run-create --objective "<what this run is for>" --json
# per worker
H=$(orca terminal create --worktree path:<abs repo> --command "claude-pick --model fable" --title "<name>" --json \
    | python3 -c "import json,sys; print(json.load(sys.stdin)['result']['terminal']['handle'])")
orca terminal wait --terminal "$H" --for tui-idle --timeout-ms 60000
orca orchestration worker-start --spec "<task text>" --terminal "$H" --worktree path:<abs repo> --timeout-ms 120000 --json
orca orchestration check --wait --types worker_done,escalation,question --timeout-ms <ms> --json
orca orchestration check --ack <deliveryId>; orca orchestration worker-release --dispatch <dispatchId>
```

The `claude-pick:` stderr line at the top of the worker's terminal names the account; `CLAUDE_PICK_ACCOUNT` is in the worker's environment. `--model` and `--effort` of `worker-start` cannot combine with `--terminal`, so the model is chosen by `claude-pick --model …` in the terminal command.

## Behaviour worth knowing

- **Expired tokens.** An account whose keychain access token has expired answers `401` on the usage call (four of seven did on 2026-10-19, expired 18–43 h earlier). `orca_usage.py` then runs ONE tiny `claude -p "reply ok" --max-turns 1` under that profile (the Studio `usage.py` path) so Claude Code refreshes the token and writes it back to the keychain, then reads again. That refresh strips `ORCA_AGENT_HOOK_*` from its environment (no agent row for it) and runs in an empty temp dir (no project context). A `claude-pick` launch on such an account works anyway — Claude refreshes at start-up.
- **No room anywhere** → exit 3 with a table of every account on stderr; nothing is started.
- **`security` needs the GUI session.** From plain ssh the keychain answers nothing; `orca_usage.py` then keeps the old cache rather than clobbering it. Run it from an Orca terminal (or a `mcp__macstudio__job_start` job on the Studio).
- **Studio:** installed the same way, but only ONE Orca profile folder exists there today (`a333f590…` = sam@sabrent.com, the selected account) for six managed accounts, so only that account is pickable until each of the others is selected once in Orca (which materialises its profile folder).
- **Python:** the bash entry runs `/usr/bin/python3` (3.9, stdlib only); tests pass on 3.9 and Homebrew 3.14: `python3 -m unittest discover -s scripts/orca/tests -p 'test_*.py'` (9 tests).
- **Cache:** `~/.config/orca-pick/usage.json` (`ORCA_PICK_CACHE`), cooldown 900 s (`ORCA_PICK_COOLDOWN`). It holds numbers and emails, never tokens.
