// Fork (#48 slice 13): stop a local test run on a Node major other than the repo's pin (engines.node).
//
// Why: Vitest's Node lane runs on whatever node started run-vitest.mjs. On a host whose node is 26.7, node:sqlite's
// backup() settles only on the event loop's next wake-up (probed outside Orca; 26.0 and the pinned 24.22.1, which is
// also Electron's runtime, settle at once), so the SQLite backup tests time out with no hint of the cause. One clear
// line at the start says which node ran and what the pin is.
//
// CI is left alone: its matrix picks the Node version on purpose (node-next-compat runs 24 and 26). A deliberate local
// run on another major sets ORCA_ALLOW_NODE_MISMATCH=1 and gets a warning instead.

const OVERRIDE = 'ORCA_ALLOW_NODE_MISMATCH'

/** The major of a plain engines.node value ("24", "24.22.1", "24.x"); null for a range or anything else. */
export function enginesNodeMajor(engines) {
  const match = /^(\d+)(?:\.(?:\d+|x)){0,2}$/.exec(String(engines ?? '').trim())
  return match ? Number(match[1]) : null
}

/** { ok, message? } for running the tests on Node `version` (process.versions.node) from `execPath`. */
export function checkNodeMajor({ version, execPath, enginesNode, env }) {
  const pinned = enginesNodeMajor(enginesNode)
  const major = Number(String(version).split('.')[0])
  if (pinned === null || major === pinned || env.CI) {
    return { ok: true }
  }
  const what = `${execPath} is Node ${version}, but this repo pins engines.node ${pinned}`
  if (env[OVERRIDE] === '1') {
    return { ok: true, message: `Warning: ${what} (${OVERRIDE}=1: running anyway).` }
  }
  return {
    ok: false,
    message:
      `${what}: put Node ${pinned} first on PATH (or set ${OVERRIDE}=1 for a deliberate run; ` +
      `Node 26.7's node:sqlite backup() hangs under Vitest, #48).`
  }
}
