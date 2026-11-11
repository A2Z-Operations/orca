import { readFile } from 'node:fs/promises'
import { runProcess } from '@orca/process-host'

const BASE_URL_IN_ENV = /(?:^|[\s\0])ANTHROPIC_BASE_URL=(\S+?)(?=[\s\0]|$)/

/** Environment block of a live process this user owns; '' where the platform offers none. */
async function readProcessEnvironment(pid: number, platform: NodeJS.Platform): Promise<string> {
  if (platform === 'linux') {
    return readFile(`/proc/${pid}/environ`, 'utf8')
  }
  if (platform !== 'darwin') {
    return ''
  }
  const result = await runProcess({
    program: '/bin/ps',
    args: ['-wwE', '-o', 'command=', '-p', String(pid)],
    timeoutMs: 1_000,
    maxOutputBytes: 256 * 1024
  })
  return result.code === 0 ? result.stdout : ''
}

/**
 * `ANTHROPIC_BASE_URL` of a live process this user owns, read without a shell: `/proc/<pid>/environ`
 * on Linux, `ps -E` on macOS. Null on Windows, on a denied read, or when the variable is absent.
 * Asynchronous so a reattach never blocks the main thread on `ps`.
 */
export async function readProcessAnthropicBaseUrl(
  pid: number | null | undefined,
  platform: NodeJS.Platform = process.platform
): Promise<string | null> {
  if (!pid || !Number.isInteger(pid) || pid <= 1) {
    return null
  }
  try {
    return BASE_URL_IN_ENV.exec(await readProcessEnvironment(pid, platform))?.[1] ?? null
  } catch {
    return null
  }
}

const PROCESS_ENV_READ_CONCURRENCY = 4

/**
 * `ANTHROPIC_BASE_URL` of several live processes, keyed by pid; a process without one is absent.
 * The slot prune reads every registered PTY this way before it drops a slot, so a pane whose shell
 * still carries the slot URL is never cut off. Reads run a few at a time so a long pane list does
 * not fan out into one `ps` per pane at once.
 */
export async function readProcessAnthropicBaseUrls(
  pids: readonly number[],
  readOne: (pid: number) => Promise<string | null> = readProcessAnthropicBaseUrl
): Promise<Map<number, string>> {
  const found = new Map<number, string>()
  const queue = [...new Set(pids)]
  const worker = async (): Promise<void> => {
    for (let pid = queue.shift(); pid !== undefined; pid = queue.shift()) {
      const url = await readOne(pid)
      if (url) {
        found.set(pid, url)
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(PROCESS_ENV_READ_CONCURRENCY, queue.length) }, worker)
  )
  return found
}
