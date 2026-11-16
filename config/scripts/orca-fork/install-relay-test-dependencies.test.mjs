import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import {
  RELAY_TEST_DEPENDENCY_COMMANDS,
  installRelayTestDependencies,
  relayTestDependencyGaps
} from './install-relay-test-dependencies.mjs'

// A temp cloud/ workspace stands in for the real one, and `run` is a fake: the test never runs pnpm or the network.
const roots = []

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

function writeJson(file, value) {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(value))
}

function cloudWorkspace() {
  const cloud = mkdtempSync(join(tmpdir(), 'orca-fork-relay-deps-'))
  roots.push(cloud)
  writeJson(join(cloud, 'apps', 'relay', 'package.json'), {
    name: '@orca-cloud/relay',
    dependencies: { '@orca-cloud/relay-contract': 'workspace:*', pg: '^8.0.0' },
    devDependencies: { vitest: '^5.0.0' }
  })
  writeJson(join(cloud, 'packages', 'relay-contract', 'package.json'), {
    name: '@orca-cloud/relay-contract',
    main: 'dist/index.js'
  })
  return cloud
}

function installed(cloud, { built = true } = {}) {
  const modules = join(cloud, 'apps', 'relay', 'node_modules')
  for (const name of ['pg', 'vitest']) {
    writeJson(join(modules, name, 'package.json'), { name })
  }
  mkdirSync(join(modules, '@orca-cloud'), { recursive: true })
  symlinkSync(
    join(cloud, 'packages', 'relay-contract'),
    join(modules, '@orca-cloud', 'relay-contract'),
    'dir'
  )
  if (built) {
    mkdirSync(join(cloud, 'packages', 'relay-contract', 'dist'), { recursive: true })
    writeFileSync(join(cloud, 'packages', 'relay-contract', 'dist', 'index.js'), '')
  }
}

function recorder(status = 0) {
  const calls = []
  return {
    calls,
    run: (args, cwd) => {
      calls.push({ args, cwd })
      return { status }
    }
  }
}

it('names every relay dependency that is not installed', () => {
  const cloud = cloudWorkspace()
  expect(relayTestDependencyGaps(cloud)).toEqual([
    '@orca-cloud/relay-contract not installed',
    'pg not installed',
    'vitest not installed'
  ])
})

it('names a workspace package that is installed but not built', () => {
  const cloud = cloudWorkspace()
  installed(cloud, { built: false })
  expect(relayTestDependencyGaps(cloud)).toEqual(['@orca-cloud/relay-contract not built'])
})

it('finds no gap once everything is installed and built', () => {
  const cloud = cloudWorkspace()
  installed(cloud)
  expect(relayTestDependencyGaps(cloud)).toEqual([])
})

it('runs CI relay job commands in cloud/, in order, when something is missing', () => {
  const cloud = cloudWorkspace()
  const { calls, run } = recorder()
  const result = installRelayTestDependencies({ cloud, ifMissing: true, run })
  expect(result.installed).toBe(true)
  expect(result.gaps).toContain('pg not installed')
  expect(calls).toEqual(RELAY_TEST_DEPENDENCY_COMMANDS.map((args) => ({ args, cwd: cloud })))
})

it('with --if-missing, runs nothing when everything is present', () => {
  const cloud = cloudWorkspace()
  installed(cloud)
  const { calls, run } = recorder()
  expect(installRelayTestDependencies({ cloud, ifMissing: true, run })).toEqual({
    installed: false,
    gaps: []
  })
  expect(calls).toEqual([])
})

it('without --if-missing, installs even when everything is present', () => {
  const cloud = cloudWorkspace()
  installed(cloud)
  const { calls, run } = recorder()
  installRelayTestDependencies({ cloud, ifMissing: false, run })
  expect(calls).toHaveLength(2)
})

it('stops at the first failing command and names it', () => {
  const cloud = cloudWorkspace()
  const { calls, run } = recorder(1)
  expect(() => installRelayTestDependencies({ cloud, ifMissing: true, run })).toThrow(
    /pnpm --filter @orca-cloud\/relay\.\.\. install --frozen-lockfile --ignore-scripts failed/
  )
  expect(calls).toHaveLength(1)
})

it('runs the same two commands as the relay integration job in unit-tests.yml', () => {
  const workflow = readFileSync(
    new URL('../../../.github/workflows/unit-tests.yml', import.meta.url),
    'utf8'
  )
  for (const args of RELAY_TEST_DEPENDENCY_COMMANDS) {
    const line = ['pnpm', ...args.map((arg) => (arg.startsWith('@') ? `'${arg}'` : arg))].join(' ')
    expect(workflow).toContain(line)
  }
})
