import type { HandlerGroup } from './handler-group-manifest'

export const JOB_HANDLER_GROUP: HandlerGroup = {
  name: 'job',
  keys: ['job list', 'job status', 'job logs', 'job stop', 'job start'],
  load: async () => (await import('./handlers/job.js')).JOB_HANDLERS
}
