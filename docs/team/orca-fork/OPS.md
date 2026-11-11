# Orca fork — operating notes

Rules that hold on a running install. Each names the build that retires it.

## Relaunching an agent pane

**Never relaunch an agent by typing `claude --resume …` into a pane; use Orca's account launch**
(the pane's launch menu, the structured launch, or the session mover). Holds until a build at or
after `1.4.256-blowzer.3` is installed.

Why: a typed `claude --resume` runs on the slot the pane's shell minted at spawn, but Orca never
wrote a pane row for it; the session mover learns the pane from its transcript (`source:
"transcript"`) with no `proxySlot`. On builds before `1.4.256-blowzer.3`, `orca account auth-proxy
--status` (and the Accounts settings page) pruned every slot no row named, so one status read cut
the pane off mid-turn ("Not logged in · Please run /login", 2026-11-10). From `1.4.256-blowzer.3`
the status read is pure, the prune keeps any slot a live shell still carries, and the inferred row
records the slot.

On a build before `1.4.256-blowzer.3`, also: do not run `orca account auth-proxy --status` and do
not open Settings › Accounts › Claude while a transcript-inferred pane is live.
