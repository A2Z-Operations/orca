#!/usr/bin/env node
// Fork (#48 slice 12): install the cloud/ relay workspace that tests/e2e/relay-region-correction.unit.test.ts imports.
//
// Why: that test (and relay-region-compatibility) imports cloud/apps/relay, a separate pnpm workspace. CI keeps them
// out of the unit shards (UNIT_EXCLUDE) and runs them in their own "relay integration" job, which first installs and
// builds the relay workspace. The local preflight's `vitest related` run selects them like any other test, so on a
// clone where nobody installed cloud/, the correction test failed with "Cannot find package 'pg'".
//
// The preflight's unit step runs it with --if-missing: it runs the relay job's two commands (RELAY_TEST_DEPENDENCY_COMMANDS,
// pinned to unit-tests.yml by a test) only when a relay dependency is not installed or a workspace one is not built.
// The install uses the frozen lockfile and no lifecycle scripts, as CI does.
//
// Usage: node config/scripts/orca-fork/install-relay-test-dependencies.mjs [--if-missing] [--cloud <dir>]
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { resolvePnpmCliInvocation } from '../tool-invocation/pnpm-cli-invocation.mjs'

/** The relay integration job's commands in .github/workflows/unit-tests.yml, run in cloud/. */
export const RELAY_TEST_DEPENDENCY_COMMANDS = [
  ['--filter', '@orca-cloud/relay...', 'install', '--frozen-lockfile', '--ignore-scripts'],
  ['--filter', '@orca-cloud/relay^...', 'build']
]

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'))
}

/**
 * What the relay app is missing in `cloud`: each dependency with no package in apps/relay/node_modules is
 * "not installed"; each workspace dependency whose package `main` is absent is "not built". Empty when ready.
 */
export function relayTestDependencyGaps(cloud) {
  const relay = join(cloud, 'apps', 'relay')
  const manifest = readJson(join(relay, 'package.json'))
  const dependencies = { ...manifest.dependencies, ...manifest.devDependencies }
  const gaps = []
  for (const name of Object.keys(dependencies).sort()) {
    const installed = join(relay, 'node_modules', name)
    if (!existsSync(join(installed, 'package.json'))) {
      gaps.push(`${name} not installed`)
      continue
    }
    if (String(dependencies[name]).startsWith('workspace:')) {
      const { main } = readJson(join(installed, 'package.json'))
      if (main && !existsSync(join(installed, main))) {
        gaps.push(`${name} not built`)
      }
    }
  }
  return gaps
}

function runPnpm(args, cwd) {
  const pnpm = resolvePnpmCliInvocation()
  return spawnSync(pnpm.command, [...pnpm.prefixArgs, ...args], {
    cwd,
    stdio: 'inherit',
    shell: pnpm.shell,
    windowsHide: true
  })
}

/** Runs the relay job's commands in `cloud` (only when something is missing, with `ifMissing`). */
export function installRelayTestDependencies({ cloud, ifMissing = false, run = runPnpm }) {
  const gaps = relayTestDependencyGaps(cloud)
  if (ifMissing && gaps.length === 0) {
    return { installed: false, gaps }
  }
  for (const args of RELAY_TEST_DEPENDENCY_COMMANDS) {
    const result = run(args, cloud)
    if (result.status !== 0) {
      throw new Error(
        `pnpm ${args.join(' ')} failed in ${cloud} (${result.error?.message ?? `exit ${result.status}`})`
      )
    }
  }
  return { installed: true, gaps }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values } = parseArgs({
    options: {
      cloud: { type: 'string' },
      'if-missing': { type: 'boolean', default: false }
    }
  })
  const cloud = resolve(values.cloud ?? 'cloud')
  const { installed, gaps } = installRelayTestDependencies({
    cloud,
    ifMissing: values['if-missing']
  })
  console.log(
    installed
      ? `relay test dependencies in ${cloud}: installed and built${gaps.length > 0 ? ` (were: ${gaps.join(', ')})` : ''}`
      : `relay test dependencies in ${cloud}: present; nothing installed`
  )
}
