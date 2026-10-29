import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  durableJobScriptPaths,
  ensureDurableBackgroundJobPlugin,
  sweepOldDurableJobPlugins
} from './durable-background-job-plugin'

const temps: string[] = []

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  temps.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of temps) {
    chmodTree(dir)
    rmSync(dir, { recursive: true, force: true })
  }
  temps.length = 0
})

function chmodTree(dir: string): void {
  if (!existsSync(dir)) {
    return
  }
  chmodSync(dir, 0o755)
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      chmodTree(path)
    } else {
      chmodSync(path, 0o644)
    }
  }
}

describe('durableJobScriptPaths', () => {
  it('prefers scripts under process resources', () => {
    const resources = tempDir('orca-durable-resources-')
    const dir = join(resources, 'durable-jobs')
    mkdirSync(dir)
    const runner = join(dir, 'durable-background-job.mjs')
    const hook = join(dir, 'durable-background-job-hook.mjs')
    writeFileSync(runner, 'runner-from-resources\n')
    writeFileSync(hook, 'hook-from-resources\n')
    expect(durableJobScriptPaths(resources)).toEqual({ runner, hook })
  })

  it('uses the source scripts when the resources directory is empty', () => {
    const resources = tempDir('orca-durable-resources-')
    mkdirSync(join(resources, 'durable-jobs'))
    expect(durableJobScriptPaths(resources)).toEqual({
      runner: fileURLToPath(new URL('./durable-background-job.mjs', import.meta.url)),
      hook: fileURLToPath(new URL('./durable-background-job-hook.mjs', import.meta.url))
    })
  })
})

describe('sweepOldDurableJobPlugins', () => {
  it('deletes old content-hash dirs and keeps the current hash and the waiter bin', () => {
    const userData = tempDir('orca-durable-plugins-')
    const plugin = ensureDurableBackgroundJobPlugin(userData)
    expect(plugin).toBeTruthy()
    const jobsRoot = join(userData, 'claude-durable-jobs')
    const current = readdirSync(jobsRoot).find((name) => /^[a-f0-9]{20}$/.test(name))
    expect(current).toBeTruthy()
    const stale =
      current === '0123456789abcdef0123' ? 'abcdef0123456789abcd' : '0123456789abcdef0123'
    mkdirSync(join(jobsRoot, stale, 'stale'), { recursive: true })
    mkdirSync(join(jobsRoot, 'notes'))
    const waiter = join(jobsRoot, 'bin', 'orca-durable-job')
    expect(lstatSync(waiter).isSymbolicLink()).toBe(true)
    expect(readlinkSync(waiter)).toBe(join(plugin!, 'hooks', 'durable-background-job.mjs'))
    const wslWaiter = readFileSync(join(jobsRoot, 'bin-wsl', 'orca-durable-job'), 'utf8')
    expect(wslWaiter).toContain('exec node ')
    expect(wslWaiter).toContain('durable-background-job.mjs')
    const wslHooks = JSON.parse(
      readFileSync(join(plugin!, '..', 'orca-durable-jobs-wsl', 'hooks', 'hooks.json'), 'utf8')
    ) as { hooks: { PreToolUse: { matcher: string }[] } }
    expect(wslHooks.hooks.PreToolUse[0]?.matcher).toBe('Bash')

    expect(sweepOldDurableJobPlugins(userData)).toEqual([stale])
    expect(existsSync(plugin!)).toBe(true)
    expect(existsSync(waiter)).toBe(true)
    expect(existsSync(join(jobsRoot, 'notes'))).toBe(true)
    expect(existsSync(join(jobsRoot, stale))).toBe(false)
  })

  it('leaves plugin dirs alone when the packaged scripts cannot be read', () => {
    const resources = tempDir('orca-durable-resources-')
    const userData = tempDir('orca-durable-plugins-')
    const scripts = join(resources, 'durable-jobs')
    mkdirSync(scripts)
    const runner = join(scripts, 'durable-background-job.mjs')
    const hook = join(scripts, 'durable-background-job-hook.mjs')
    writeFileSync(runner, 'unreadable\n')
    writeFileSync(hook, 'unreadable\n')
    chmodSync(runner, 0o000)
    chmodSync(hook, 0o000)
    const jobsRoot = join(userData, 'claude-durable-jobs')
    const stale = join(jobsRoot, '0123456789abcdef0123')
    mkdirSync(stale, { recursive: true })

    expect(sweepOldDurableJobPlugins(userData, resources)).toEqual([])
    expect(existsSync(stale)).toBe(true)
  })
})
