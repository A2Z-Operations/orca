import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runProcess } from '@orca/process-host'

// getsid(2) is the POSIX session id. macOS `ps -o sess` prints 0 for a live session leader.
const HELPER_SOURCE = `#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>

int main(void) {
  char line[64];
  while (fgets(line, sizeof line, stdin)) {
    char *end = NULL;
    long pid = strtol(line, &end, 10);
    if (end == line || pid <= 0) {
      continue;
    }
    pid_t sid = getsid((pid_t)pid);
    if (sid <= 0) {
      printf("%ld -\\n", pid);
    } else {
      printf("%ld %ld\\n", pid, (long)sid);
    }
  }
  return 0;
}
`

const HELPER_DIGEST = createHash('sha256').update(HELPER_SOURCE).digest('hex').slice(0, 16)
let helperBinary: Promise<string | null> | undefined

async function commandLineToolsPresent(): Promise<boolean> {
  // `xcode-select -p` exits non-zero when the tools are absent. Do not run `cc` then:
  // a missing toolchain can raise a system dialog.
  try {
    const result = await runProcess({
      program: '/usr/bin/xcode-select',
      args: ['-p'],
      timeoutMs: 5_000
    })
    return result.code === 0 && !result.timedOut
  } catch {
    return false
  }
}

async function compileHelper(binary: string): Promise<boolean> {
  if (!(await commandLineToolsPresent())) {
    return false
  }
  const source = `${binary}.c`
  const staging = `${binary}.${process.pid}`
  try {
    mkdirSync(tmpdir(), { recursive: true })
    writeFileSync(source, HELPER_SOURCE)
    const compiled = await runProcess({
      program: '/usr/bin/cc',
      args: ['-O2', '-o', staging, source],
      timeoutMs: 30_000
    })
    if (compiled.code !== 0 || compiled.timedOut) {
      return false
    }
    chmodSync(staging, 0o755)
    try {
      renameSync(staging, binary)
    } catch {
      rmSync(staging, { force: true })
      return existsSync(binary)
    }
    return true
  } catch {
    return false
  } finally {
    rmSync(source, { force: true })
    rmSync(staging, { force: true })
  }
}

function helperPath(): Promise<string | null> {
  helperBinary ??= resolveHelper()
  return helperBinary
}

async function resolveHelper(): Promise<string | null> {
  const binary = join(tmpdir(), `orca-getsid-${process.arch}-${HELPER_DIGEST}`)
  if (!existsSync(binary) && !(await compileHelper(binary))) {
    return null
  }
  return binary
}

/** Map each pid to its session id. Null when the helper cannot prove every pid. */
export async function readDarwinSessionIds(
  pids: number[]
): Promise<Map<number, number | null> | null> {
  if (pids.length === 0) {
    return new Map()
  }
  const binary = await helperPath()
  if (!binary) {
    return null
  }
  let stdout: string
  try {
    const result = await runProcess({
      program: binary,
      input: `${pids.join('\n')}\n`,
      timeoutMs: 5_000,
      maxOutputBytes: 8 * 1024 * 1024
    })
    if (result.code !== 0 || result.timedOut) {
      return null
    }
    stdout = result.stdout
  } catch {
    return null
  }
  const sessions = new Map<number, number | null>()
  for (const line of stdout.split(/\r?\n/)) {
    const match = /^(\d+)\s+(\d+|-)$/.exec(line.trim())
    if (!match) {
      continue
    }
    const pid = Number(match[1])
    sessions.set(pid, match[2] === '-' ? null : Number(match[2]))
  }
  return pids.every((pid) => sessions.has(pid)) ? sessions : null
}
