import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const PLUGIN_NAME = 'orca-durable-jobs'
const ready = new Map<string, string>()

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

export function durableJobScriptPaths(): { runner: string; hook: string } | undefined {
  const here = import.meta.dirname
  const candidates = [
    here,
    join(here, '../../../src/main/claude'),
    join(here, '../../src/main/claude'),
    join(process.cwd(), 'src/main/claude')
  ]
  for (const dir of candidates) {
    const runner = join(dir, 'durable-background-job.mjs')
    const hook = join(dir, 'durable-background-job-hook.mjs')
    if (existsSync(runner) && existsSync(hook)) {
      return { runner, hook }
    }
  }
  return undefined
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
    const version = createHash('sha256').update(runner).update(hook).digest('hex').slice(0, 20)
    const root = join(userDataPath, 'claude-durable-jobs', version, PLUGIN_NAME)
    const hookPath = join(root, 'hooks', 'durable-background-job-hook.mjs')
    const runnerPath = join(root, 'hooks', 'durable-background-job.mjs')
    writeIfChanged(runnerPath, runner)
    writeIfChanged(hookPath, hook)
    chmodSync(hookPath, 0o755)
    chmodSync(runnerPath, 0o755)
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
