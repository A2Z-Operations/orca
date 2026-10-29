import { createHash } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { dirname, join } from 'node:path'
import { sweepDurableJobs } from './durable-background-job.mjs'

const PLUGIN_NAME = 'orca-durable-jobs'
const WAITER_NAME = 'orca-durable-job'
const HASH_DIR = /^[a-f0-9]{20}$/
const ready = new Map<string, string>()

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

function scriptsIn(dir: string): { runner: string; hook: string } | undefined {
  const runner = join(dir, 'durable-background-job.mjs')
  const hook = join(dir, 'durable-background-job-hook.mjs')
  if (existsSync(runner) && existsSync(hook)) {
    return { runner, hook }
  }
  return undefined
}

export function durableJobScriptPaths(
  resourcesPath: string | undefined = process.resourcesPath
): { runner: string; hook: string } | undefined {
  const here = import.meta.dirname
  const candidates = [
    resourcesPath ? join(resourcesPath, 'durable-jobs') : undefined,
    join(here, 'durable-jobs'),
    here,
    join(here, '../../../src/main/claude'),
    join(here, '../../src/main/claude'),
    join(process.cwd(), 'src/main/claude')
  ]
  for (const dir of candidates) {
    if (!dir) {
      continue
    }
    const found = scriptsIn(dir)
    if (found) {
      return found
    }
  }
  return undefined
}

function contentVersion(runner: string, hook: string): string {
  return createHash('sha256').update(runner).update(hook).digest('hex').slice(0, 20)
}

export function durableJobBinDir(userDataPath: string): string {
  return join(userDataPath, 'claude-durable-jobs', 'bin')
}

function linkStableWaiter(runnerPath: string, userDataPath: string): void {
  const binDir = durableJobBinDir(userDataPath)
  mkdirSync(binDir, { recursive: true })
  const linkPath = join(binDir, WAITER_NAME)
  rmSync(linkPath, { force: true })
  symlinkSync(runnerPath, linkPath)
}

function writeIfChanged(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  if (existsSync(path) && readFileSync(path, 'utf8') === content) {
    return
  }
  writeFileSync(path, content)
}

export function ensureDurableBackgroundJobPlugin(userDataPath: string): string | undefined {
  const cached = ready.get(userDataPath)
  if (cached && existsSync(cached)) {
    return cached
  }
  const scripts = durableJobScriptPaths()
  if (!scripts) {
    return undefined
  }
  try {
    const runner = readFileSync(scripts.runner, 'utf8')
    const hook = readFileSync(scripts.hook, 'utf8')
    const version = contentVersion(runner, hook)
    const root = join(userDataPath, 'claude-durable-jobs', version, PLUGIN_NAME)
    const hookPath = join(root, 'hooks', 'durable-background-job-hook.mjs')
    const runnerPath = join(root, 'hooks', 'durable-background-job.mjs')
    writeIfChanged(runnerPath, runner)
    writeIfChanged(hookPath, hook)
    chmodSync(hookPath, 0o755)
    chmodSync(runnerPath, 0o755)
    linkStableWaiter(runnerPath, userDataPath)
    writeIfChanged(
      join(root, 'hooks', 'hooks.json'),
      `${JSON.stringify({
        hooks: {
          PreToolUse: [
            {
              matcher: 'Bash',
              hooks: [{ type: 'command', command: shellQuote(hookPath), timeout: 15 }]
            }
          ]
        }
      })}\n`
    )
    writeIfChanged(
      join(root, '.claude-plugin', 'plugin.json'),
      `${JSON.stringify({
        name: PLUGIN_NAME,
        version: '0.1.0',
        description: 'Keep Claude background bash jobs alive across an Orca session restart'
      })}\n`
    )
    ready.set(userDataPath, root)
    return root
  } catch {
    return undefined
  }
}

/** Delete content-hash plugin dirs that are not the scripts currently on disk. */
export function sweepOldDurableJobPlugins(userDataPath: string, resourcesPath?: string): string[] {
  const scripts = durableJobScriptPaths(resourcesPath)
  if (!scripts) {
    return []
  }
  let current: string
  try {
    current = contentVersion(
      readFileSync(scripts.runner, 'utf8'),
      readFileSync(scripts.hook, 'utf8')
    )
  } catch {
    return []
  }
  const root = join(userDataPath, 'claude-durable-jobs')
  if (!existsSync(root)) {
    return []
  }
  const removed: string[] = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !HASH_DIR.test(entry.name) || entry.name === current) {
      continue
    }
    rmSync(join(root, entry.name), { recursive: true, force: true })
    removed.push(entry.name)
  }
  return removed
}

export function sweepDurableJobResidue(userDataPath: string): void {
  sweepDurableJobs()
  sweepOldDurableJobPlugins(userDataPath)
}

/** App and orcad startup. Tests skip it so a vitest boot cannot delete the host job root. */
export function sweepDurableJobResidueAtStartup(userDataPath: string): void {
  if (process.env.VITEST === 'true') {
    return
  }
  try {
    sweepDurableJobResidue(userDataPath)
  } catch (error) {
    console.warn('[durable-jobs] sweep failed:', error)
  }
}
