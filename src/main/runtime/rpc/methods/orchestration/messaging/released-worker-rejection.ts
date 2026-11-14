import type { OrchestrationDb } from '../../../../orchestration/db/orchestration-db'
import type { WorkerDispatchState } from '../../../../orchestration/db/orchestration-records'
import {
  DISPATCH_RELEASED_HEARTBEAT_CODE,
  DISPATCH_RELEASED_HEARTBEAT_STOP_LINE
} from '../../../../../../shared/orchestration/dispatch-released-heartbeat'

const RELEASED_OR_STOPPED_WORKER_STATES = new Set<WorkerDispatchState>(['stopped', 'abandoned'])

/** A dispatch whose terminal was released, or whose worker has stopped or been abandoned. */
export function isReleasedOrStoppedDispatch(args: {
  workerState: WorkerDispatchState | undefined
  releaseState: string | undefined
  ownershipState: string | undefined
}): boolean {
  if (args.workerState !== undefined && RELEASED_OR_STOPPED_WORKER_STATES.has(args.workerState)) {
    return true
  }
  return args.releaseState === 'released' || args.ownershipState === 'released'
}

export function releasedHeartbeatLifecycle(): {
  action: 'rejected'
  code: string
  reason: string
} {
  return {
    action: 'rejected',
    code: DISPATCH_RELEASED_HEARTBEAT_CODE,
    reason: DISPATCH_RELEASED_HEARTBEAT_STOP_LINE
  }
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

/** A later worker_done, escalation, or decision_gate rejection for the same dispatch and sender. */
export function hasPriorRejectedReport(
  db: OrchestrationDb,
  args: { dispatchId: string; from: string; messageId: string }
): boolean {
  const row: unknown = db.db
    .prepare(
      `SELECT id FROM messages
       WHERE from_handle = ?
         AND id != ?
         AND instr(ifnull(payload, ''), ?) > 0
         AND (
           subject LIKE 'Rejected worker_done:%'
           OR subject LIKE 'Rejected escalation:%'
           OR subject LIKE 'Rejected decision_gate:%'
         )
       LIMIT 1`
    )
    .get(args.from, args.messageId, args.dispatchId)
  return isMessageId(row)
}

function isMessageId(value: unknown): boolean {
  return (
    typeof value === 'object' && value !== null && 'id' in value && typeof value.id === 'string'
  )
}
