// Fork (#44 stage 2, S2): how much CPU the observe-only pane ownership sampler costs, measured with the real modules
// against the real process table. Bundle with esbuild and run under /usr/bin/time, so the helper processes it starts
// (ps every tick; lsof on macOS when something new is recorded) are counted too:
//
//   node_modules/.bin/esbuild config/scripts/orca-fork/pane-ownership-cpu-harness.ts --bundle --platform=node \
//     --format=cjs --outfile=/tmp/po-harness.cjs
//   /usr/bin/time -p node /tmp/po-harness.cjs --panes 20 --seconds 60 --churn
//
// It starts N fake agent panes OUTSIDE its own process tree (a detached launcher), so their CPU is not in the number,
// samples them every second for the given time, and prints one JSON line with the counts it saw. The table is read
// with ps unless --in-process is given (macOS, see below); ps is the pessimistic case for macOS.
// Nothing here signals anything but the fake panes it started, and only at the end.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  readLinuxFds,
  readMacFds
} from '../../../src/main/pty/process-retirement/pane-ownership/pane-ownership-fds'
import { PaneOwnershipObserver } from '../../../src/main/pty/process-retirement/pane-ownership/pane-ownership-observer'
import {
  readLinuxStartTicks,
  readOwnershipTable
} from '../../../src/main/pty/process-retirement/pane-ownership/pane-ownership-table'
import {
  DurableJobIndex,
  durableJobRoot
} from '../../../src/main/pty/process-retirement/pane-ownership/pane-ownership-durable'

const args = process.argv.slice(2)
const panes = Number(args[args.indexOf('--panes') + 1] || 20)
const seconds = Number(args[args.indexOf('--seconds') + 1] || 60)
const churn = args.includes('--churn')
// --no-fds: skip every fd read, to separate the table read's cost from the fd reads'
const noFds = args.includes('--no-fds')
// --in-process: read the table through the libproc addon, as the app does on macOS (run with tsx from the repo root,
// after ensure-native-runtime --runtime=node); without it the table is read with ps, the pessimistic case
const inProcess = args.includes('--in-process')

// idle: each pane is a bash whose child loops `sleep 1`. churn adds what a busy agent pane has: a short-lived child every
// 0.3 s, every 3 s a subshell that starts `sleep 4` and exits 1.5 s later (the #5 orphan: seen under the pane, then
// re-parented to pid 1), and every 9 s a 30 s tool child. The last two live long enough to have their fds read.
const body = churn
  ? 'n=0; while :; do (sleep 0.2 &); sleep 0.3; n=$((n+1)); if [ $((n % 10)) = 0 ]; then (sleep 4 & sleep 1.5) & fi; if [ $((n % 30)) = 0 ]; then sleep 30 & fi; done'
  : 'while :; do sleep 1; done'

async function main(): Promise<void> {
  const jobs = mkdtempSync(join(tmpdir(), 'po-harness-jobs-'))
  // --real-jobs: index the real durable-job root (thousands of folders on a busy Mac) instead of an empty one
  const durableJobs = new DurableJobIndex(args.includes('--real-jobs') ? durableJobRoot() : jobs)
  // A launcher shell starts each pane in its own session (perl POSIX::setsid: macOS has no setsid command) and exits,
  // so the panes belong to pid 1, not to this process: /usr/bin/time then counts only the harness and its helpers.
  const launcher = `for i in $(seq ${panes}); do perl -MPOSIX -e 'POSIX::setsid(); exec @ARGV' bash -c "$BODY" >/dev/null 2>&1 & echo $!; done`
  const pids = execFileSync('bash', ['-c', launcher], {
    env: { ...process.env, BODY: body },
    encoding: 'utf8'
  })
    .split('\n')
    .filter(Boolean)
    .map(Number)
  const roots = pids.map((rootPid, i) => ({ sessionId: `pane-${i}`, rootPid }))
  await new Promise((resolve) => setTimeout(resolve, 1_500))
  let lines = 0
  let newEntries = 0
  const observer = new PaneOwnershipObserver({
    listAgentRoots: () => roots,
    readTable: () =>
      inProcess
        ? readOwnershipTable()
        : readOwnershipTable(1_000, { runInProcess: async () => null }),
    readFds: async (pids, fds) => {
      newEntries += pids.length
      if (noFds) {
        return new Map()
      }
      return process.platform === 'darwin' ? readMacFds(pids, fds) : readLinuxFds(pids, fds)
    },
    readStartTicks: process.platform === 'linux' ? (pid) => readLinuxStartTicks(pid) : null,
    listDurableJobs: () => durableJobs.refresh(),
    readMode: async () => ({ mode: 'observe', requested: null }),
    log: () => {
      lines += 1
    },
    hostUid: process.getuid?.() ?? 0,
    hostPid: process.pid
  })
  const startCpu = process.cpuUsage()
  const startMs = Date.now()
  let ticks = 0
  while (Date.now() - startMs < seconds * 1_000) {
    const tickStart = Date.now()
    await observer.tick()
    ticks += 1
    await new Promise((resolve) =>
      setTimeout(resolve, Math.max(0, 1_000 - (Date.now() - tickStart)))
    )
  }
  for (const root of roots) {
    await observer.observeClose(root.sessionId, 'close')
  }
  const cpu = process.cpuUsage(startCpu)
  const wallMs = Date.now() - startMs
  for (const root of roots) {
    try {
      process.kill(-root.rootPid, 'SIGKILL') // the harness's own fake panes, by their process group
    } catch {
      // already gone
    }
  }
  rmSync(jobs, { recursive: true, force: true })
  console.log(
    JSON.stringify({
      platform: process.platform,
      panes,
      churn,
      noFds,
      inProcess,
      seconds,
      ticks,
      wallMs,
      selfCpuMs: Math.round((cpu.user + cpu.system) / 1_000),
      selfCpuPercent: Number(((100 * (cpu.user + cpu.system)) / 1_000 / wallMs).toFixed(2)),
      pidsGivenToFdReads: newEntries,
      logLines: lines,
      status: observer.status()
    })
  )
}

void main()
