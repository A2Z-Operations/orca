# Orca fork with Claude account auto-switch (2026-10-19)

Both Macs run **our own Orca build** instead of the stock release. It switches the selected Claude
account by itself before a usage limit, can be toggled from the CLI (so the Studio's headless runtime
gets it too) and is rebuilt on top of each upstream release with one script.

## What is in the build

| Piece | Where | What it does |
|---|---|---|
| Upstream PR #28044 "switch accounts before a usage limit" + PR #29060 (remote `setAutoSwitch`) | `adifsgaid/orca` heads `f1d676bed…` / `3db5f1b71…`, merged into our branch | The feature itself: a host setting `claudeAutoSwitchEnabled`, the policy, the Settings toggle, the RPC `accounts.setClaudeAutoSwitch`, the restart-running-sessions dialog. |
| Commit "per-window lines" | `src/main/claude-accounts/claude-account-auto-switch-policy.ts` | **Owner's lines: 5-hour window 95 %, weekly window 90 %, Fable weekly window 90 %.** Headroom = distance to the nearest line; a candidate needs ≥ 10 points of headroom (any positive headroom once the active account is at 100 %). A window past its reset counts as 0 % used. |
| Commit "cli: orca account auto-switch" | `src/cli/handlers/account-auto-switch.ts`, `src/cli/specs/account.ts` | `orca account auto-switch --agent claude --on|--off [--environment <selector>] [--json]`; `orca account list` shows `auto-switch: on|off`. It is the one `account` command that accepts `--environment` (carve-out in `src/cli/index.ts`), which is how the MacBook flips the Studio. |
| Commit "build: ORCA_NO_PUBLISH" + commit "updater: kill switch" | `config/electron-builder.config.cjs`, `src/main/updater/updater-disabled.ts`, `updater-setup.ts`, `runtime/remote-server-updater.ts` | `ORCA_NO_PUBLISH=1` leaves `Resources/app-update.yml` out of the bundle, and the kill switch makes that (or `ORCA_UPDATER_DISABLED=1`) mean **no feed, no checks, no remote install**: a self-built Orca never replaces itself with a stock release. FOUND 2026-10-19: without the kill switch the serve still pinned the GitHub release feed and logged `Found version 1.4.230` (auto-download off, so nothing was applied) — the missing-manifest fallback re-pins the feed by itself. |
| Commit "build: computer-use helper … scratch path" | `config/scripts/build-computer-macos.mjs` | Xcode 27.1 / Swift 6.4 writes every triple's products to `.build/out/Products/Release`, so upstream's two plain `swift build --triple` runs overwrote each other and `lipo` failed; a `--scratch-path` per triple fixes it on both SwiftPM layouts. Drop this commit once upstream builds on Swift 6.4. |

Repo: fork `A2Z-Operations/orca` (of `stablyai/orca`), branch **`blowzer/auto-switch`**, clone
`~/Documents/claude/orca-fork` (remotes `origin` = fork, `upstream` = stablyai, `adifsgaid` = the PR author).

## Version rule

Our build reports **`<next upstream patch>-blowzer.N`**, e.g. `1.4.230-blowzer.1` on top of installed
1.4.229. Semver reads a 1.4.230 prerelease as newer than 1.4.229, so Orca never treats our build as a
downgrade. `rebuild.sh` derives it from the upstream tag it merges (`v1.4.230` → `1.4.231-blowzer.1`).

## Signing + TCC

Signed with the owner's **`Apple Development: nachumi Eliyahu (BDK84XWD78)`** identity (`CSC_NAME`), not
notarized — macOS runs a locally built/copied app without quarantine. The identity stays the same across
our rebuilds, so TCC grants (Accessibility, Screen Recording, Automation) are re-asked **once** on the
MacBook when the first fork build replaces the stock app (the owner clicks Allow), then never again.
Never use the `Apple Distribution` identity and never print or export certificates.

## Toggle

```bash
orca account auto-switch --agent claude --on                           # this Mac
orca account auto-switch --agent claude --on --environment macstudio   # the Studio, from the MacBook
ssh macstudio 'orca account auto-switch --agent claude --on'           # the Studio, on the Studio
orca account list                                                      # shows "auto-switch: on"
```
Settings › Accounts › Claude › "Switch accounts before a usage limit" is the same setting. The switch applies
to the next Claude started; running sessions follow "When you switch accounts while Claude is running".

## Rebuild on a new upstream release

```bash
~/Documents/claude/BLOWzer/scripts/orca-fork/rebuild.sh v1.4.231 install-studio
```
= merge the tag into `blowzer/auto-switch` (stop on conflict, resolve, commit, rerun), `pnpm install` at the root
AND `pnpm --dir mobile install` (the mobile-web bundle step needs the mobile workspace's deps), the policy + CLI suites, `build:desktop` + the three native helpers, `electron-builder --mac --arm64` with
`CSC_NAME` + `ORCA_NO_PUBLISH=1` + the derived version, codesign verify, app-update.yml absence check; with
`install-studio` it ships the zip and runs `studio-install.sh` there. Node 24 lives in the private prefix
`~/.n-orca` (`N_PREFIX`), the global Node is never touched; pnpm comes from corepack (the repo's pin).
Build time on the MacBook: the first build took ~12 min of compute (install 31 s, build:desktop ~8 min, helpers ~1.5 min, electron-builder the rest). Then push: `cd ~/Documents/claude/orca-fork && git push origin blowzer/auto-switch`.

## Install on the Studio (headless runtime)

`scripts/orca-fork/studio-install.sh` runs ON the Studio: stops `com.stablyai.orca.serve`, swaps
`/Applications/Orca.app` (previous kept as `/Applications/Orca.app.bak-<version>`), reinstalls the service
(`orca serve service install --port 6768 --pairing-address ws://blowzers-mac-studio.local:6768`) and
prints its status. Rollback = `mv` the `.bak` back and reinstall the service. Ship files with
`ssh macstudio 'cat > path' < file` (scp has hung).

## Install on the MacBook

The leader session runs inside Orca: announce, `mv /Applications/Orca.app /Applications/Orca.app.bak-<ver>`,
`ditto dist/mac-arm64/Orca.app /Applications/Orca.app`, quit Orca, `open -a Orca` (terminals survive on the
terminal daemon and reattach), then flip the toggle. Plan: `docs/superpowers/plans/2026-10-19-orca-fork-auto-switch.md` Task 8.

## Rules

- **Never post to upstream** (`stablyai/orca`: no issue, PR, discussion or comment) without the owner's yes. Pushing to our fork is fine.
- Stock Orca updates are OFF in this build by design (kill switch: no `app-update.yml` or `ORCA_UPDATER_DISABLED=1` → the updater sets no feed, runs no checks and refuses remote installs; the serve log says `[updater] disabled for this build`); a new upstream release = `rebuild.sh <tag>` (`BLOWZER_N=2` for a second build on the same tag).
- Keep our three commits small and on top; resolve merge conflicts in favour of upstream's structure, re-apply our lines.
- After a merge the tree must differ from the tag ONLY by files a fork or PR commit touches: `rebuild.sh` compares `git diff --name-only <tag> HEAD` with the pre-merge set and now hands drift to `fix-merge-drift.sh <theirs> <ours-base> <ours-head>`, which rewrites the unpushed merge commit with upstream's blobs for those files by plumbing (no hooks run), so lint-staged cannot re-align them again. Drift seen 2026-10-20: release-branch reverts that auto-merged into 40 files, and a markdown table lint-staged re-aligned during the merge commit. The helper does that alignment; the hook-free reference is `git merge-tree --write-tree <theirs> <ours>`, which must differ from HEAD only by conflict resolutions.
