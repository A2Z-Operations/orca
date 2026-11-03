import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

export const REPO_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['repo', 'list'],
    summary: 'List repos registered in Orca',
    usage: 'orca repo list [--json]',
    allowedFlags: [...GLOBAL_FLAGS]
  },
  {
    path: ['repo', 'add'],
    summary: 'Add a project to Orca by filesystem path',
    usage: 'orca repo add --path <path> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'path']
  },
  {
    path: ['repo', 'show'],
    summary: 'Show one registered repo',
    usage: 'orca repo show --repo <selector> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'repo']
  },
  {
    path: ['repo', 'set'],
    summary: 'Set whether non-Orca worktrees are shown for a repo',
    usage:
      'orca repo set --repo <selector> --external-worktree-visibility show|hide|inherit [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'repo', 'external-worktree-visibility'],
    notes: [
      'show and hide override the global non-Orca worktree visibility default for this repo; inherit clears the override.',
      'Per-worktree visibility rules still apply.'
    ],
    examples: ['orca repo set --repo path:/path/to/repo --external-worktree-visibility show --json']
  },
  {
    path: ['repo', 'set-hooks'],
    summary: 'Bind the setup and archive hook scripts for a repo without the app',
    usage:
      'orca repo set-hooks --repo <selector> [--setup "<cmd>"] [--archive "<cmd>"] [--setup-policy ask|run-by-default|skip-by-default] [--clear-setup] [--clear-archive] [--json]',
    allowedFlags: [
      ...GLOBAL_FLAGS,
      'repo',
      'setup',
      'archive',
      'setup-policy',
      'clear-setup',
      'clear-archive'
    ],
    notes: [
      'Requires at least one of --setup, --archive, --setup-policy, --clear-setup, or --clear-archive.',
      'Merges into the stored hookSettings: a script or policy you leave out keeps its current value.',
      'The setup script runs after a worktree is created; the archive script runs before a worktree is archived or removed.',
      '--json prints the stored hookSettings after the write; orca repo show --json carries the same object.'
    ],
    examples: [
      'orca repo set-hooks --repo path:/path/to/repo --setup "bash scripts/orca-setup.sh" --archive "bash scripts/orca-archive.sh" --setup-policy run-by-default --json',
      'orca repo set-hooks --repo id:<repoId> --clear-archive --json'
    ]
  },
  {
    path: ['repo', 'set-base-ref'],
    summary: "Set the repo's default base ref for future worktrees",
    usage: 'orca repo set-base-ref --repo <selector> --ref <ref> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'repo', 'ref']
  },
  {
    path: ['repo', 'search-refs'],
    summary: 'Search branch/tag refs within a repo',
    usage: 'orca repo search-refs --repo <selector> --query <text> [--limit <n>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'repo', 'query', 'limit']
  }
]
