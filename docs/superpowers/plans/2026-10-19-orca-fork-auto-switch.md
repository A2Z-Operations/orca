# Orca fork with account auto-switch — build, install, keep rebuildable

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Both Macs run an Orca build that switches the selected Claude account by itself before a usage limit (5-hour ≥ 95 %, weekly ≥ 90 %, Fable-weekly ≥ 90 %), can be toggled from the CLI (so the Studio's headless runtime gets it too), and can be rebuilt on top of each upstream release with one script.

**Architecture:** Fork `stablyai/orca` into `A2Z-Operations/orca`. Branch `blowzer/auto-switch` = upstream PR #29060's head (which already stacks PR #28044 "switch accounts before a usage limit" on `main` of 2026-10-17, including the merged #29898 restart-running-sessions dialog) + three small commits of ours: (1) per-window thresholds and the Fable window in the policy, (2) a CLI toggle `orca account auto-switch`, (3) a build switch that drops the GitHub updater config so stock releases cannot overwrite our build. Build locally on the MacBook with Node 24 (via `n`, local prefix), sign with the owner's Apple Development identity so the signing identity stays stable across our rebuilds, install on both machines, flip the toggle on both.

**Tech Stack:** TypeScript (Electron 43, electron-vite, electron-builder 26, vitest on Bun), pnpm 12 via corepack, Node 24, Xcode 27.1 (native Swift helpers). Repo clone at `~/Documents/claude/orca-fork` (outside the BLOWzer repo). Build takes 30–60 min on the MacBook; run it in the background and poll.

**Facts the engineer must know:**
- Upstream PR heads: #28044 `adifsgaid/orca:claude-auto-switch` @ f1d676bed43b0e15489bc52631af26b3d1ed8448; #29060 `adifsgaid/orca:feat/claude-auto-switch-remote` @ 3db5f1b718e3aeae2609a2bc611cdec7a7ed72bb (draft, "stacked on #28044"). Files of interest: `src/main/claude-accounts/claude-account-auto-switch-policy.ts` (+ `.test.ts`), `claude-account-auto-switch.ts`, `service.ts` (`setAutoSwitch`), `src/main/runtime/rpc/methods/accounts.ts` (`accounts.setClaudeAutoSwitch`, permission `accounts-admin`, params `SetClaudeAutoSwitchParams`), `src/shared/managed-account-types.ts` (`autoSwitchEnabled` on the Claude accounts state), `src/shared/global-settings-types.ts` (`claudeAutoSwitchEnabled`).
- `src/shared/rate-limit-types.ts`: `ProviderRateLimits { status, session: RateLimitWindow|null, weekly: RateLimitWindow|null, fableWeekly?: RateLimitWindow|null, … }`, `RateLimitWindow { usedPercent: number, resetsAt: number|null, … }`, `InactiveAccountUsage { accountId, rateLimits, … }`.
- CLI: `src/cli/specs/account.ts` (CommandSpec list: `path`, `summary`, `usage`, `allowedFlags`, `notes`, `examples`), `src/cli/handlers/account.ts` (`ACCOUNT_HANDLERS: Record<string, CommandHandler>`, `ctx.client.call('accounts.list', {refreshUsage:false})`, flags via the args helpers used by `'account select'`), `src/cli/handler-group-manifest.ts`, `src/cli/root-help-text-primary.ts`. Tests: `src/cli/handlers/account.test.ts`. `orca account list` rejects `--environment`; the new command must ACCEPT `--environment` (it is how the MacBook flips the Studio).
- Packaging (`config/electron-builder.config.cjs`): local builds (`ORCA_MAC_RELEASE` unset) have `hardenedRuntime:false`, `notarize:false`, `forceCodeSigning:false`, and `extraMetadata.version = process.env.ORCA_LOCAL_BUILD_VERSION`. `publish:` (line ~802) is unconditional → electron-builder writes `Resources/app-update.yml` → the updater would see upstream 1.4.230 later. The three native helpers (`Orca Computer Use.app`, keyboard layout, notification status) throw `Missing signing identity` without an identity → pass `CSC_NAME`. `pnpm build:mac` builds x64 + arm64 by default → call electron-builder yourself with `--arm64`.
- Signing identity on this Mac: `Apple Development: nachumi Eliyahu (BDK84XWD78)` (also an `Apple Distribution` one — do not use it). An Apple Development signature is NOT notarized; macOS runs locally built/copied apps fine (no quarantine); TCC grants for the new identity are re-asked once on the MacBook (owner clicks Allow).
- Version: upstream `package.json` on main says `1.4.214` (tags set the real version). Our build must report a version ABOVE the installed 1.4.229 so Orca never treats it as a downgrade: use `1.4.230-blowzer.1` (semver: a 1.4.230 prerelease > 1.4.229).
- Node: this Mac runs Node 26 globally; `n` 9.2.1 is installed. Use a private prefix: `export N_PREFIX=$HOME/.n-orca; n install 24; export PATH=$N_PREFIX/bin:$PATH` — never change the global Node.
- Studio: runtime = LaunchAgent `com.stablyai.orca.serve` (installed with `orca serve service install --port 6768 --pairing-address ws://blowzers-mac-studio.local:6768`); stock app backup already at `/Applications/Orca.app.bak-1.4.224`. `ssh macstudio`. Copy big files with `ssh macstudio 'cat > path' < file` (scp has hung).
- MacBook: the leader session itself runs inside Orca; quitting Orca keeps its terminals alive on the terminal daemon and they reattach after relaunch. Do the MacBook install LAST, announce it, and relaunch with `open -a Orca`.
- Never post to upstream (issue, PR, comment) in this plan — that needs the owner's yes.

---

### Task 1: Fork + clone + branch

**Files:** new clone `~/Documents/claude/orca-fork`

- [ ] **Step 1: Fork into the org (public fork; fall back to the user account if the org refuses)**

```bash
gh repo fork stablyai/orca --org A2Z-Operations --clone=false --default-branch-only 2>&1 || gh repo fork stablyai/orca --clone=false --default-branch-only
gh repo view A2Z-Operations/orca --json nameWithOwner,isFork,parent -q '"\(.nameWithOwner) fork=\(.isFork) parent=\(.parent.nameWithOwner)"'
```
Expected: `A2Z-Operations/orca fork=true parent=stablyai/orca` (or the user fork; note which).

- [ ] **Step 2: Partial clone and fetch the PR branches**

```bash
cd ~/Documents/claude && git clone --filter=blob:none https://github.com/A2Z-Operations/orca.git orca-fork && cd orca-fork
git remote add upstream https://github.com/stablyai/orca.git
git remote add adifsgaid https://github.com/adifsgaid/orca.git
git fetch adifsgaid feat/claude-auto-switch-remote claude-auto-switch
git fetch upstream main --tags
git checkout -b blowzer/auto-switch 3db5f1b718e3aeae2609a2bc611cdec7a7ed72bb
git merge-base --is-ancestor f1d676bed43b0e15489bc52631af26b3d1ed8448 HEAD && echo "28044 head already included" || git merge --no-edit f1d676bed43b0e15489bc52631af26b3d1ed8448
git log --oneline -5
```
Expected: branch at the #29060 head (plus a merge commit only if #28044 moved after it). If the merge conflicts, resolve in favour of #28044's newer policy/service files and keep #29060's `setAutoSwitch` plumbing.

- [ ] **Step 3: Confirm the auto-switch files are present**

```bash
ls src/main/claude-accounts/claude-account-auto-switch-policy.ts src/main/claude-accounts/claude-account-auto-switch.ts src/renderer/src/components/settings/accounts-pane-claude-auto-switch.tsx && grep -n "setClaudeAutoSwitch" src/main/runtime/rpc/methods/accounts.ts
```
Expected: three paths + one RPC line.

---

### Task 2: Toolchain + install dependencies

- [ ] **Step 1: Node 24 in a private prefix, pnpm via corepack**

```bash
export N_PREFIX=$HOME/.n-orca && mkdir -p $N_PREFIX && n install 24 && export PATH=$N_PREFIX/bin:$PATH && node -v && corepack enable --install-directory $N_PREFIX/bin && cd ~/Documents/claude/orca-fork && corepack pnpm -v
```
Expected: `v24.x.y`, pnpm `12.14.0` (the `packageManager` pin).

- [ ] **Step 2: Install (arm64 only) — 10–20 min, run in the background and poll**

```bash
cd ~/Documents/claude/orca-fork && export N_PREFIX=$HOME/.n-orca PATH=$HOME/.n-orca/bin:$PATH && corepack pnpm install --frozen-lockfile 2>&1 | tail -20
```
Expected: ends without `ERR_PNPM`; `postinstall` builds packages and rebuilds native deps for Electron. If `pnpm --dir mobile install --frozen-lockfile` is required by a later step (PR #28433's author needed it), run it then.

- [ ] **Step 3: Run the suites the PRs added, as the baseline**

```bash
cd ~/Documents/claude/orca-fork && export PATH=$HOME/.n-orca/bin:$PATH && corepack pnpm exec vitest run --config config/vitest.config.ts src/main/claude-accounts/claude-account-auto-switch-policy.test.ts src/main/claude-accounts/claude-account-auto-switch.test.ts src/cli/handlers/account.test.ts 2>&1 | tail -8
```
Expected: all pass. If vitest wants Bun: `bun` 1.3.13 is on PATH already.

---

### Task 3: Policy patch — per-window lines + the Fable window

**Files:**
- Modify: `src/main/claude-accounts/claude-account-auto-switch-policy.ts` (whole file)
- Modify: `src/main/claude-accounts/claude-account-auto-switch-policy.test.ts`

- [ ] **Step 1: Add failing tests (append to the existing test file; keep the PR's tests, adjusting any that assert the single 90 % line for the 5-hour window to 95)**

```ts
import { describe, expect, it } from 'vitest'
import { pickClaudeAutoSwitchTarget, isClaudeOverAutoSwitchLine, claudeAutoSwitchHeadroom } from './claude-account-auto-switch-policy'
import type { ProviderRateLimits, InactiveAccountUsage } from '../../shared/rate-limit-types'

const now = 1_800_000_000_000
const win = (usedPercent: number) => ({ usedPercent, resetsAt: now + 3_600_000 }) as ProviderRateLimits['session']
const limits = (session: number, weekly: number, fable?: number): ProviderRateLimits =>
  ({ status: 'ok', session: win(session), weekly: win(weekly), fableWeekly: fable === undefined ? null : win(fable) }) as ProviderRateLimits
const cand = (accountId: string, l: ProviderRateLimits): InactiveAccountUsage => ({ accountId, rateLimits: l }) as InactiveAccountUsage

describe('per-window lines (BLOWZER)', () => {
  it('5-hour window switches at 95, not 90', () => {
    expect(isClaudeOverAutoSwitchLine(limits(94.9, 10), now)).toBe(false)
    expect(isClaudeOverAutoSwitchLine(limits(95, 10), now)).toBe(true)
  })
  it('weekly window switches at 90', () => {
    expect(isClaudeOverAutoSwitchLine(limits(10, 89.9), now)).toBe(false)
    expect(isClaudeOverAutoSwitchLine(limits(10, 90), now)).toBe(true)
  })
  it('Fable weekly window switches at 90 and is ignored when absent', () => {
    expect(isClaudeOverAutoSwitchLine(limits(10, 10, 90), now)).toBe(true)
    expect(isClaudeOverAutoSwitchLine(limits(10, 10, 89), now)).toBe(false)
    expect(isClaudeOverAutoSwitchLine(limits(10, 10), now)).toBe(false)
  })
  it('headroom is the distance to the nearest line', () => {
    expect(claudeAutoSwitchHeadroom(limits(50, 80, 0), now)).toBe(10)   // weekly 90-80
    expect(claudeAutoSwitchHeadroom(limits(90, 10, 0), now)).toBe(5)    // session 95-90
    expect(claudeAutoSwitchHeadroom(limits(10, 10, 85), now)).toBe(5)   // fable 90-85
  })
  it('picks the candidate with the most headroom to its nearest line', () => {
    const active = limits(10, 10, 92)
    const target = pickClaudeAutoSwitchTarget(active, [cand('a', limits(10, 50, 100)), cand('b', limits(10, 70, 0)), cand('c', limits(96, 1, 0))], { now, lastSwitchAt: 0 })
    expect(target).toBe('b')
  })
  it('does not switch to a candidate that is itself within 10 points of a line', () => {
    expect(pickClaudeAutoSwitchTarget(limits(10, 92), [cand('a', limits(10, 85))], { now, lastSwitchAt: 0 })).toBeNull()
  })
})
```

- [ ] **Step 2: Run to see the new tests fail**

Run: `cd ~/Documents/claude/orca-fork && export PATH=$HOME/.n-orca/bin:$PATH && corepack pnpm exec vitest run --config config/vitest.config.ts src/main/claude-accounts/claude-account-auto-switch-policy.test.ts 2>&1 | tail -12`
Expected: failures mentioning `claudeAutoSwitchHeadroom is not a function` / 95 vs 90.

- [ ] **Step 3: Rewrite the policy**

```ts
import type { InactiveAccountUsage, ProviderRateLimits, RateLimitWindow } from '../../shared/rate-limit-types'

// BLOWZER lines (owner, 2026-10-19): the 5-hour window at 95 %, the weekly and the Fable-weekly windows at 90 %.
export const CLAUDE_AUTO_SWITCH_LINES = { session: 95, weekly: 90, fableWeekly: 90 } as const
// Why: a switch only reaches the next Claude started, so a fresh pick needs time to be used.
export const CLAUDE_AUTO_SWITCH_COOLDOWN_MS = 5 * 60_000
// Why: an account only a few points under a line would cross it again within minutes.
const MIN_HEADROOM_GAINED = 10

type LiveWindow = { name: keyof typeof CLAUDE_AUTO_SWITCH_LINES; used: number; line: number }

/** Every window still running (a window past its reset has started over; an idle session re-posts old numbers). */
function liveWindows(limits: ProviderRateLimits | null, now: number): LiveWindow[] | null {
  if (limits?.status !== 'ok') return null
  const pairs: Array<[LiveWindow['name'], RateLimitWindow | null | undefined]> = [
    ['session', limits.session],
    ['weekly', limits.weekly],
    ['fableWeekly', limits.fableWeekly]
  ]
  const live = pairs
    .filter((p): p is [LiveWindow['name'], RateLimitWindow] => p[1] !== null && p[1] !== undefined)
    .filter(([, w]) => w.resetsAt === null || w.resetsAt > now)
    .map(([name, w]) => ({ name, used: w.usedPercent, line: CLAUDE_AUTO_SWITCH_LINES[name] }))
  return live.length === 0 ? null : live
}

/** Distance to the nearest line over the live windows (negative = over), or null when usage could not be read. */
export function claudeAutoSwitchHeadroom(limits: ProviderRateLimits | null, now: number): number | null {
  const live = liveWindows(limits, now)
  if (!live) return null
  return Math.min(...live.map((w) => w.line - w.used))
}

export function isClaudeOverAutoSwitchLine(limits: ProviderRateLimits | null, now: number): boolean {
  const headroom = claudeAutoSwitchHeadroom(limits, now)
  return headroom !== null && headroom <= 0
}

function isAtLimit(limits: ProviderRateLimits | null, now: number): boolean {
  return (liveWindows(limits, now) ?? []).some((w) => w.used >= 100)
}

/** The account new Claude sessions should move to, or null to stay. */
export function pickClaudeAutoSwitchTarget(
  active: ProviderRateLimits | null,
  candidates: InactiveAccountUsage[],
  { now, lastSwitchAt }: { now: number; lastSwitchAt: number }
): string | null {
  const activeHeadroom = claudeAutoSwitchHeadroom(active, now)
  if (activeHeadroom === null || activeHeadroom > 0) return null
  const atLimit = isAtLimit(active, now)
  if (!atLimit && now - lastSwitchAt < CLAUDE_AUTO_SWITCH_COOLDOWN_MS) return null
  const best = candidates
    .flatMap((candidate) => {
      const headroom = claudeAutoSwitchHeadroom(candidate.rateLimits, now)
      return headroom !== null && !isAtLimit(candidate.rateLimits, now) ? [{ accountId: candidate.accountId, headroom }] : []
    })
    .sort((a, b) => b.headroom - a.headroom)[0]
  if (!best) return null
  // Why: at the limit the agent stops anyway, so any account with room beats staying.
  if (atLimit) return best.headroom > 0 ? best.accountId : null
  return best.headroom >= MIN_HEADROOM_GAINED ? best.accountId : null
}
```

- [ ] **Step 4: Run the policy, service and settings suites**

Run: `cd ~/Documents/claude/orca-fork && export PATH=$HOME/.n-orca/bin:$PATH && corepack pnpm exec vitest run --config config/vitest.config.ts src/main/claude-accounts 2>&1 | tail -8`
Expected: all pass (fix any PR test that hard-coded 90 for the session window by changing its fixture to 95).

- [ ] **Step 5: Fix the one docs sentence and commit**

In `docs/site/content/docs/agents/claude-code.mdx` the PR added a paragraph saying 90 %; change it to "95 % of the 5-hour window or 90 % of a weekly window (including the Fable weekly window)". Then:
```bash
git add -A && git commit -m "claude auto-switch: per-window lines (5h 95, weekly 90, Fable weekly 90) and the Fable window in the policy"
```

---

### Task 4: CLI toggle `orca account auto-switch`

**Files:**
- Modify: `src/cli/specs/account.ts`
- Modify: `src/cli/handlers/account.ts`
- Modify: `src/cli/handlers/account.test.ts`

- [ ] **Step 1: Failing test (append to `account.test.ts`, following the file's existing harness for `'account select'` — a fake `client.call` recorder)**

```ts
describe('account auto-switch', () => {
  it('turns Claude auto-switch on through accounts.setClaudeAutoSwitch and prints the state', async () => {
    const calls: Array<[string, unknown]> = []
    const client = { call: async (name: string, params: unknown) => { calls.push([name, params]); return { autoSwitchEnabled: true, accounts: [], activeAccountId: null } } }
    const out: string[] = []
    await ACCOUNT_HANDLERS['account auto-switch']({ ...baseCtx, client, flags: { agent: 'claude', on: true }, write: (s: string) => out.push(s) } as never)
    expect(calls).toEqual([['accounts.setClaudeAutoSwitch', { enabled: true }]])
    expect(out.join('\n')).toContain('auto-switch: on')
  })
  it('refuses an agent other than claude', async () => {
    await expect(ACCOUNT_HANDLERS['account auto-switch']({ ...baseCtx, flags: { agent: 'codex', on: true } } as never)).rejects.toThrow(/claude/)
  })
})
```
Adapt `baseCtx` and the output capture to whatever the existing tests in this file use (read the file first; the harness name differs between files — reuse theirs, do not invent a second one).

- [ ] **Step 2: Run to see it fail**

Run: `cd ~/Documents/claude/orca-fork && export PATH=$HOME/.n-orca/bin:$PATH && corepack pnpm exec vitest run --config config/vitest.config.ts src/cli/handlers/account.test.ts 2>&1 | tail -6`
Expected: `ACCOUNT_HANDLERS['account auto-switch'] is not a function`.

- [ ] **Step 3: Spec**

Append to `ACCOUNT_COMMAND_SPECS` in `src/cli/specs/account.ts`:
```ts
  {
    path: ['account', 'auto-switch'],
    summary: 'Turn automatic Claude account switching before a usage limit on or off',
    usage: 'orca account auto-switch --agent claude (--on | --off) [--environment <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'agent', 'on', 'off'],
    notes: [
      'Writes the host setting behind Settings › Accounts › Claude › "Switch accounts before a usage limit" (accounts.setClaudeAutoSwitch).',
      'With --environment the setting is written on that paired Orca server, whose accounts the switch then rotates.',
      'Lines: 5-hour window 95 %, weekly and Fable-weekly windows 90 %; the switch applies to the next Claude started.'
    ],
    examples: ['orca account auto-switch --agent claude --on', 'orca account auto-switch --agent claude --on --environment macstudio']
  }
```

- [ ] **Step 4: Handler**

Add to `ACCOUNT_HANDLERS` in `src/cli/handlers/account.ts` (use the same flag-reading and output helpers the neighbouring handlers use; `ClaudeRateLimitAccountsState` already has `autoSwitchEnabled` from #29060):
```ts
  'account auto-switch': async (ctx) => {
    const agent = ctx.flags.agent ?? 'claude'
    if (agent !== 'claude') throw new Error('Only --agent claude supports auto-switch today.')
    const on = ctx.flags.on === true
    const off = ctx.flags.off === true
    if (on === off) throw new Error('Pass exactly one of --on or --off.')
    const state = await ctx.client.call<ClaudeRateLimitAccountsState>('accounts.setClaudeAutoSwitch', { enabled: on })
    if (ctx.flags.json) { ctx.write(JSON.stringify({ autoSwitchEnabled: state.autoSwitchEnabled ?? on }, null, 2)); return }
    ctx.write(`Claude auto-switch: ${state.autoSwitchEnabled ?? on ? 'on' : 'off'}`)
  }
```
Also make `orca account list` print `auto-switch: on|off` after the Claude block when `snapshot.claude.autoSwitchEnabled` is defined (one line in `formatAccountsBlock` or beside its call). Register any flag names (`on`, `off`) the args parser needs (see how `account` flags are declared in `src/cli/args.ts` / `handler-group-manifest.ts`).

- [ ] **Step 5: Run the CLI tests + typecheck the CLI**

Run: `cd ~/Documents/claude/orca-fork && export PATH=$HOME/.n-orca/bin:$PATH && corepack pnpm exec vitest run --config config/vitest.config.ts src/cli/handlers/account.test.ts src/cli/specs 2>&1 | tail -6 && corepack pnpm run typecheck:cli 2>&1 | tail -5`
Expected: tests pass, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "cli: orca account auto-switch --agent claude --on|--off (accounts.setClaudeAutoSwitch), list shows the state"
```

---

### Task 5: Build switch that drops the updater config

**Files:**
- Modify: `config/electron-builder.config.cjs` (the `publish:` block near line 802)

- [ ] **Step 1: Make publish conditional**

Change
```js
  publish: {
```
to
```js
  // BLOWZER: ORCA_NO_PUBLISH=1 builds no app-update.yml, so a self-built Orca never tries to replace itself with a stock release.
  publish: process.env.ORCA_NO_PUBLISH === '1' ? null : {
```
and close the ternary after the existing object (`}` → `},` stays as is; make sure the file still parses: `node -e "require('./config/electron-builder.config.cjs')"`).

- [ ] **Step 2: Commit**

```bash
git add config/electron-builder.config.cjs && git commit -m "build: ORCA_NO_PUBLISH=1 leaves the updater config out of a local build"
```

---

### Task 6: Build the macOS arm64 app (background, 30–60 min)

- [ ] **Step 1: Desktop assets + native helpers**

```bash
cd ~/Documents/claude/orca-fork && export N_PREFIX=$HOME/.n-orca PATH=$HOME/.n-orca/bin:$PATH
corepack pnpm run build:desktop 2>&1 | tail -15
```
Expected: ends with the web/mobile-web verify lines, no error. If `typecheck` fails on files we did not touch, run `corepack pnpm run build:desktop:assets` instead and record the typecheck failure in the report.

```bash
corepack pnpm run build:computer-macos 2>&1 | tail -3 && corepack pnpm run build:keyboard-layout-macos 2>&1 | tail -3 && corepack pnpm run build:notification-status-macos 2>&1 | tail -3 && corepack pnpm run ensure:electron-runtime 2>&1 | tail -3
```
Expected: each ends without `error`.

- [ ] **Step 2: Package (signed with the Development identity, no updater, our version)**

```bash
cd ~/Documents/claude/orca-fork && export PATH=$HOME/.n-orca/bin:$PATH
CSC_NAME="Apple Development: nachumi Eliyahu (BDK84XWD78)" ORCA_NO_PUBLISH=1 ORCA_BUILD_COMMIT=$(git rev-parse --short=12 HEAD) ORCA_LOCAL_BUILD_VERSION=1.4.230-blowzer.1 corepack pnpm exec electron-builder --config config/electron-builder.config.cjs --mac --arm64 2>&1 | tail -25
```
Expected: `dist/mac-arm64/Orca.app`, `dist/orca-macos-arm64.dmg`, `dist/Orca-1.4.230-blowzer.1-arm64-mac.zip`. If `CSC_NAME` is refused, retry with `CSC_IDENTITY_AUTO_DISCOVERY=false` (ad-hoc) and record that the identity will change on every rebuild.

- [ ] **Step 3: Verify the bundle**

```bash
APP=~/Documents/claude/orca-fork/dist/mac-arm64/Orca.app
codesign --verify --deep --strict "$APP" && echo "codesign ok"
codesign -dv "$APP" 2>&1 | grep -E '^Authority=' | head -1
"$APP/Contents/Resources/bin/orca" --version
ls "$APP/Contents/Resources/app-update.yml" 2>&1
/usr/bin/grep -ac "Switch accounts before a usage limit" "$APP/Contents/Resources/app.asar"
/usr/bin/grep -ac "account auto-switch" "$APP/Contents/Resources/app.asar"
```
Expected: `codesign ok`; Authority = Apple Development…; version `1.4.230-blowzer.1`; `No such file` for app-update.yml; both grep counts ≥ 1.

- [ ] **Step 4: Smoke-run the built app headless as a second profile, then stop it**

```bash
"$APP/Contents/Resources/bin/orca" --help 2>&1 | grep -n "auto-switch"
```
Expected: the new command listed under Accounts.

---

### Task 7: Install on the Studio (headless runtime)

- [x] **Step 1: Ship the zip**

```bash
cd ~/Documents/claude/orca-fork/dist && Z=$(ls Orca-1.4.230-blowzer.1-arm64-mac.zip) && shasum -a 256 "$Z" && ssh macstudio 'mkdir -p ~/work/orca-fork-install && cat > ~/work/orca-fork-install/orca.zip' < "$Z" && ssh macstudio 'shasum -a 256 ~/work/orca-fork-install/orca.zip'
```
Expected: identical hashes.

- [x] **Step 2: Swap the app under the stopped service, reinstall the service (one script, run by path)**

```bash
cat > /tmp/studio-fork-install.sh <<'EOF'
#!/bin/bash
set -u; U=$(id -u)
launchctl bootout gui/$U/com.stablyai.orca.serve 2>/dev/null || true
for i in $(seq 1 20); do pgrep -f "/Applications/Orca.app/" >/dev/null || break; sleep 1; done
pgrep -f "/Applications/Orca.app/" >/dev/null && pkill -f "/Applications/Orca.app/" && sleep 3
cd ~/work/orca-fork-install && rm -rf unz && mkdir unz && ditto -x -k orca.zip unz && test -d unz/Orca.app || { echo "unzip failed"; exit 3; }
rm -rf /Applications/Orca.app.bak-1.4.229; mv /Applications/Orca.app /Applications/Orca.app.bak-1.4.229
ditto unz/Orca.app /Applications/Orca.app || { mv /Applications/Orca.app.bak-1.4.229 /Applications/Orca.app; echo "ditto failed, restored"; exit 4; }
echo "version: $(/Applications/Orca.app/Contents/Resources/bin/orca --version)"
orca serve service install --port 6768 --pairing-address ws://blowzers-mac-studio.local:6768 2>&1 | tail -3
sleep 15; orca serve service status 2>&1 | head -2
EOF
ssh macstudio 'cat > ~/work/orca-fork-install/install.sh && chmod +x ~/work/orca-fork-install/install.sh' < /tmp/studio-fork-install.sh && ssh macstudio '~/work/orca-fork-install/install.sh'
```
Expected: `version: 1.4.230-blowzer.1`, service `live`.

- [x] **Step 3: Verify from the MacBook and flip the switch on the Studio**

```bash
orca --environment macstudio status | grep -E "runtimeState|runtimeReachable"
ssh macstudio 'orca account list --json' | python3 -c "import json,sys; d=json.load(sys.stdin)['result']['claude']; print('autoSwitchEnabled =', d.get('autoSwitchEnabled'))"
ssh macstudio 'orca account auto-switch --agent claude --on'
ssh macstudio 'orca account list --json' | python3 -c "import json,sys; d=json.load(sys.stdin)['result']['claude']; print('autoSwitchEnabled =', d.get('autoSwitchEnabled'))"
```
Expected: `ready`/`true`; `False` then `True`.

---

### Task 8: Install on the MacBook

- [x] **Step 1: Announce, then swap the app bundle (Orca keeps running on old inodes)**

```bash
rm -rf /Applications/Orca.app.bak-1.4.229 && mv /Applications/Orca.app /Applications/Orca.app.bak-1.4.229 && ditto ~/Documents/claude/orca-fork/dist/mac-arm64/Orca.app /Applications/Orca.app && /Applications/Orca.app/Contents/Resources/bin/orca --version
```
Expected: `1.4.230-blowzer.1`.

- [x] **Step 2: Relaunch Orca (terminals survive on the daemon and reattach)**

```bash
osascript -e 'quit app "Orca"'; sleep 8; open -a Orca; sleep 20; orca status | grep -E "appRunning|runtimeState"
```
Expected: `appRunning: true`, `runtimeState: ready`. macOS may ask the owner to re-grant Accessibility / Screen Recording for the new signing identity — that is expected, once.

- [x] **Step 3: Flip the switch and verify**

```bash
orca account auto-switch --agent claude --on && orca account list --json | python3 -c "import json,sys; d=json.load(sys.stdin)['result']['claude']; print('autoSwitchEnabled =', d.get('autoSwitchEnabled'))"
```
Expected: `True`. Settings › Accounts › Claude should show the toggle on and "When you switch accounts while Claude is running" at its default (Ask).

---

### Task 9: Rebuild script + docs + push the branch

**Files:**
- Create: `~/Documents/claude/BLOWzer/scripts/orca-fork/rebuild.sh`
- Create: `~/Documents/claude/BLOWzer/docs/team/orca-fork/README.md`
- Modify: `~/Documents/claude/BLOWzer/CLAUDE.md` (one row)

- [ ] **Step 1: rebuild.sh**

```bash
#!/bin/bash
# rebuild.sh <upstream-tag|ref> [install-studio] [install-macbook]
# Merges a newer upstream Orca into blowzer/auto-switch, rebuilds the arm64 app, optionally installs it.
set -euo pipefail
REF=${1:?upstream tag, e.g. v1.4.230}; FORK=~/Documents/claude/orca-fork
export N_PREFIX=$HOME/.n-orca PATH=$HOME/.n-orca/bin:$PATH
cd "$FORK" && git checkout blowzer/auto-switch && git fetch upstream --tags && git fetch adifsgaid
git merge --no-edit "$REF" || { echo "merge conflict — resolve, commit, rerun"; exit 2; }
VER="${REF#v}"; NEXT="$(python3 -c "import sys;a=sys.argv[1].split('.');a[-1]=str(int(a[-1])+1);print('.'.join(a))" "$VER")-blowzer.1"
corepack pnpm install --frozen-lockfile
corepack pnpm exec vitest run --config config/vitest.config.ts src/main/claude-accounts src/cli/handlers/account.test.ts
corepack pnpm run build:desktop && corepack pnpm run build:computer-macos && corepack pnpm run build:keyboard-layout-macos && corepack pnpm run build:notification-status-macos && corepack pnpm run ensure:electron-runtime
CSC_NAME="Apple Development: nachumi Eliyahu (BDK84XWD78)" ORCA_NO_PUBLISH=1 ORCA_BUILD_COMMIT=$(git rev-parse --short=12 HEAD) ORCA_LOCAL_BUILD_VERSION="$NEXT" corepack pnpm exec electron-builder --config config/electron-builder.config.cjs --mac --arm64
codesign --verify --deep --strict dist/mac-arm64/Orca.app && dist/mac-arm64/Orca.app/Contents/Resources/bin/orca --version
echo "built $NEXT at $FORK/dist — install with the Task 7 / Task 8 steps of docs/superpowers/plans/2026-10-19-orca-fork-auto-switch.md"
```

- [ ] **Step 2: README with the recipe, the version rule, the TCC note, the no-upstream-post rule; CLAUDE.md row "ORCA FORK (2026-10-19)" naming the fork, branch, version scheme, where the build lives, how to toggle, how to rebuild, and that stock Orca updates are OFF in this build.**

- [ ] **Step 3: Push the fork branch (no PR)**

```bash
cd ~/Documents/claude/orca-fork && git push -u origin blowzer/auto-switch
```

- [ ] **Step 4: Commit the BLOWzer records**

```bash
cd ~/Documents/claude/BLOWzer && git add scripts/orca-fork docs/team/orca-fork CLAUDE.md && git commit -m "Orca fork: auto account switching build (1.4.230-blowzer.1), rebuild script, records"
```
