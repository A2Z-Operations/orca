import type { CommandSpec } from '../args'
import { LOCAL_COMMAND_FLAGS } from '../args'

export const JOB_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['job', 'list'],
    summary: 'List detached background jobs that survive a Claude restart',
    usage: 'orca job list [--json]',
    allowedFlags: [...LOCAL_COMMAND_FLAGS],
    notes: [
      'Reads the local job directory. It does not contact the Orca runtime.',
      'Jobs stay on this machine. Windows and WSL launches do not create them.'
    ],
    examples: ['orca job list', 'orca job list --json']
  },
  {
    path: ['job', 'status'],
    summary: 'Show one detached background job',
    usage: 'orca job status <id> [--json]',
    allowedFlags: [...LOCAL_COMMAND_FLAGS, 'id'],
    positionalArgs: ['id'],
    examples: ['orca job status dj_0123456789abcdef']
  },
  {
    path: ['job', 'logs'],
    summary: 'Print a detached background job log',
    usage: 'orca job logs <id>',
    allowedFlags: [...LOCAL_COMMAND_FLAGS, 'id'],
    positionalArgs: ['id'],
    examples: ['orca job logs dj_0123456789abcdef']
  },
  {
    path: ['job', 'stop'],
    summary: 'Stop a detached background job',
    usage: 'orca job stop <id>',
    allowedFlags: [...LOCAL_COMMAND_FLAGS, 'id'],
    positionalArgs: ['id'],
    notes: ['Signals the detached process group. Closing Claude does not stop the job.'],
    examples: ['orca job stop dj_0123456789abcdef']
  },
  {
    path: ['job', 'start'],
    summary: 'Start a detached background job on this machine',
    usage: 'orca job start --command <text> [--cwd <path>]',
    allowedFlags: [...LOCAL_COMMAND_FLAGS, 'command', 'cwd'],
    notes: [
      'The command runs in a new session and keeps going if this process exits.',
      'Claude background bash is detached automatically; use this command to start one directly.'
    ],
    examples: ['orca job start --command "sleep 30 && echo done"']
  }
]
