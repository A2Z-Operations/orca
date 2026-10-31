# Model policy experiments (2026-10-30)

Written before the policy code. No tokens are recorded here.

## (a) Does Fable usage debit the regular weekly window?

**Yes, on these Max seats.** Fable has its own weekly ceiling (50% of the regular weekly allowance) and that spend is already inside the regular weekly meter. A missing `fableWeekly` window is not treated as 0% used.

### Evidence

Read `https://api.anthropic.com/api/oauth/usage` for the signed-in accounts on this machine (keychain credentials, percents only). Three accounts returned 200. Seven others returned 401 (stale keychain items) and were not used.

The payload's `weekly_scoped_shares` row for the Fable `weekly_scoped` limit is `used_percent_of_weekly = fablePercent * allowance_percent_of_weekly / 100`:

| Account              | Plan | Weekly | Fable meter | Allowance of weekly | Fable share of weekly      | Active limit |
| -------------------- | ---- | ------ | ----------- | ------------------- | -------------------------- | ------------ |
| reports@sabrent.com  | max  | 88%    | 39%         | 50%                 | 20 (39 × 0.5 rounds to 20) | weekly       |
| nachumi770@gmail.com | max  | 46%    | 32%         | 50%                 | 16 (exact)                 | weekly       |
| hello@getblowzer.com | max  | 76%    | 78%         | 50%                 | 39 (exact)                 | fable        |

Fable can read higher than weekly because the denominators differ. The share column is the part of the regular weekly window Fable has already consumed. When the weekly window is the active limit, `weekly_scoped.is_active` is false: Fable is gated by the regular window, which is why the 91% weekly guard exists.

A same-minute before/after on nachumi770 did not move the integer percents (weekly stayed 46, Fable stayed 32, share stayed 16) after one Claude Code turn that created about 52k cache-write tokens. The integer meters are too coarse for a single turn. The share identity above is the evidence, not that delta.

`seven_day`, `fable_weekly`, `fable_seven_day`, and `seven_day_fable` were null on all three. The Fable window arrives only as `limits[].kind === 'weekly_scoped'` with `scope.model.display_name === 'Fable'`, which `mapFableWeeklyWindow` already reads.

### Design consequence

Choose Fable only when both windows are present and under their lines. A missing Fable window (Pro and standard seats, where Fable is credits) or a missing weekly window means Opus. Do not treat a missing window as empty headroom.

## (b) Rewriting `model` through a loopback proxy

Claude Code 2.1.316, `CLAUDE_CONFIG_DIR` of nachumi770@gmail.com (Max), `ANTHROPIC_BASE_URL` pointed at a loopback proxy that parsed the JSON body and replaced `model`.

Command: `claude -p --model claude-fable-5-1 --output-format json --max-turns 1` with the prompt `Reply with the single word pong.` `--bare` skips the keychain login and reports "Not logged in". Without `--bare` the turn completed.

### What Claude Code sent

One `POST /v1/messages`, status 200, `content-type: text/event-stream`.

- Body 134,864 bytes. `JSON.parse` plus rewrite took 0.357 ms.
- Top-level keys: `model`, `messages`, `system`, `tools`, `metadata`, `max_tokens` (64000), `thinking`, `context_management`, `output_config`, `stream`.
- `model` was `claude-fable-5-1`. `stream` was true. `thinking.type` was `adaptive`. `output_config` had `effort`.
- `anthropic-beta` listed `claude-code-20250219`, `oauth-2025-04-20`, `interleaved-thinking-2025-05-14`, `effort-2025-11-24`, and further betas. Those headers stay. Stripping them is not required for the rewrite.
- The client result was `pong`. `modelUsage.canonicalModel` stayed `claude-fable-5-1`. Claude Code reports the model it asked for, not the model the proxy wrote. The Orca chip, phone status, and moves list have to show the effective model.

Synthetic buffer cost on this machine (parse and re-stringify, no network):

| Body   | Time    |
| ------ | ------- |
| 50 KB  | 0.06 ms |
| 200 KB | 0.52 ms |
| 400 KB | 0.83 ms |
| 800 KB | 1.1 ms  |

`claude-fable-5-1` is 16 characters and `claude-opus-5-5` is 15, so this replacement shortened the body by one byte (134,864 → 134,863). Content-Length has to be recomputed. The existing proxy drops Content-Length and pipes chunked; the rewrite path sets it from the new buffer.

The experiment proxy buffered the response before forwarding, so it did not measure SSE time-to-first-byte. The client still completed the streamed turn. The production proxy keeps piping the response and does not buffer SSE.

### Fields that 400 on the rewritten model

Follow-up calls with a tiny body (no Claude Code system prompt) through the same rewrite (`claude-fable-5-1` → `claude-opus-5-5`):

- `thinking.type: "disabled"` → 400. `"thinking.type.disabled" is not supported for this model. Use "thinking.type.adaptive" and "output_config.effort"`.
- `tool_choice.type: "any"` → 400. `type "tool" and "any" are not supported for this model.`
- `thinking.type: "enabled"` with `budget_tokens` → 429 before a validation answer, so that case was not observed live. The Fable migration guide says manual `budget_tokens` returns 400. The rewriter still maps `enabled` / `budget_tokens` to `adaptive` when it changes the model.
- A `claude-sonnet-4-5` body was not rewritten (`passthrough`).
- Inference calls in that burst returned 429 `rate_limit_error`. The successful Claude Code turn is the completion evidence. A second full Claude Code turn in the other direction was not run: the first turn's cache write was about $1 of list price, and the integer meters did not move.

`output_config.effort` was on the successful request. It is left as Claude Code sent it.

### Choice

**Live path: buffer and `JSON.parse` up to 8 MB.** Real compact posts are a few hundred KB and parse in about a millisecond, which is noise next to an 800 ms time-to-headers. Parsing is what lets the rewriter touch only the top-level `model` (a nested `"model"` inside messages stays) and map the fields that 400:

- `thinking.type` of `disabled` or `enabled` becomes `adaptive`, and `budget_tokens` is dropped.
- `tool_choice` of `any` or `tool` becomes `{ "type": "auto" }`.

**Over 8 MB: a streaming scan that replaces only the top-level `"model"` string and fixes Content-Length by the length delta.** That path does not remap thinking or tool_choice. Both paths are unit-tested. Non-JSON bodies and responses, including SSE, are piped unchanged.

Only a policy id or alias (`claude-fable-5-1`, `fable`, `claude-opus-5-5`, `opus`) is rewritten, and only when it differs from the slot's effective model. A pinned model is not rewritten.
