import type {
  DispatchStatus,
  WorkerDispatchState
} from '../../../../orchestration/db/orchestration-records'

const RELEASED_OR_STOPPED_WORKER_STATES = new Set<WorkerDispatchState>([
  'failed',
  'succeeded',
  'stopping',
  'stop_unknown',
  'stopped',
  'abandoned'
])

/** A dispatch Orca has released or stopped. `retained` / `user_kept` stays deliverable. */
export function isReleasedOrStoppedDispatch(args: {
  dispatchStatus: DispatchStatus | undefined
  workerState: WorkerDispatchState | undefined
  releaseState: string | undefined
  ownershipState: string | undefined
}): boolean {
  if (
    args.dispatchStatus !== undefined &&
    args.dispatchStatus !== 'pending' &&
    args.dispatchStatus !== 'dispatched'
  ) {
    return true
  }
  if (args.workerState !== undefined && RELEASED_OR_STOPPED_WORKER_STATES.has(args.workerState)) {
    return true
  }
  return args.releaseState === 'released' || args.ownershipState === 'released'
}

/** One line. The pid is a label only; it never authorizes the sender. */
export function logUndeliveredReleasedDispatchRejection(args: {
  type: string
  from: string
  senderPid: number | undefined
  dispatchId: string
}): void {
  const pid =
    typeof args.senderPid === 'number' && Number.isInteger(args.senderPid) && args.senderPid > 0
      ? String(args.senderPid)
      : 'unknown'
  console.warn(
    `rejected ${args.type} from ${args.from} pid ${pid} for released dispatch ${args.dispatchId} not delivered`
  )
}
