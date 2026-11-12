#!/usr/bin/env node
// Fork (#21): fill out/orcad-prebuilds and .build/windows-* from a stock upstream Linux release, so that
// `pnpm build:orcad-template` can rebuild the fork's orcad JS (orcad-server.js, plugin-host-entry.js) for
// every template target on one host.
//
// Why: packaging requires all 8 template targets (verifyPackagedOrcadTemplate), and upstream builds their
// native slots on one CI runner per OS/arch/libc, Windows included. No single fork host can build them.
// The native inputs are byte-identical to the release tag, and this script refuses to run unless they are
// (see NATIVE_INPUTS), so the release's slot binaries are the ones those runners would build from this tree.
//
// Download only: the public release asset's sha256 must match the digest GitHub publishes for it, and every
// harvested file must match the sha256 the release's own template manifest records.
//
// Usage: node config/scripts/orca-fork/harvest-orcad-prebuilds.mjs [--tag v1.4.255] [--work <dir>]
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { NODE_RUNTIME_PIN, SERVER_TARGETS } from '../../../src/shared/node-runtime-pin.ts'
import {
  ORCAD_NODE_PTY_DIR,
  ORCAD_TEMPLATE_MANIFEST_FILENAME,
  ORCAD_TEMPLATE_TARGETS_DIR,
  ORCAD_WINDOWS_CLI_LAUNCHER_FILENAME,
  ORCAD_WINDOWS_PROCESS_TREE_FILENAME,
  ORCAD_WINDOWS_SECURITY_FILENAME,
  orcadNodePtySlotFiles
} from '../../../src/shared/orcad-artifacts.ts'
import { ORCAD_PREBUILDS_DIR } from '../orcad-distribution/prebuilds/build-orcad-prebuilds.mjs'
import {
  COMPAT_SLOTS,
  COMPAT_SLOT_ADDONS,
  MANIFEST_SCHEMA_VERSION,
  SLOT_NAPI_VERSION,
  findSlotProblems
} from '../orcad-distribution/prebuilds/orcad-prebuild-slot-contents.mjs'
import { orcadWindowsCliLauncherSource } from '../orcad-distribution/server-bundle/orcad-windows-cli-launcher.mjs'
import { windowsSecurityAddonOutput } from '../native-build/windows/build-windows-security-addon.mjs'

const ROOT = resolve(import.meta.dirname, '../../..')
const require = createRequire(import.meta.url)
const REPO = 'stablyai/orca'
// Everything a template slot binary is built from. Fork changes elsewhere are JS, rebuilt by build:orcad-template.
export const NATIVE_INPUTS = [
  'pnpm-lock.yaml',
  'package.json',
  'pnpm-workspace.yaml',
  'config/patches',
  'native',
  'config/scripts/native-build',
  'config/scripts/orcad-distribution/prebuilds',
  'src/shared/node-runtime-pin.ts'
]

function argument(name, fallback) {
  const index = process.argv.indexOf(name)
  return index === -1 ? fallback : process.argv[index + 1]
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function run(program, args, options = {}) {
  const result = spawnSync(program, args, { cwd: ROOT, encoding: 'utf8', ...options })
  if (result.error || result.status !== 0) {
    throw new Error(
      `${program} ${args.join(' ')} failed: ${result.error?.message ?? result.stderr}`
    )
  }
  return result.stdout
}

/** Refuses unless every native input is byte-identical to the release tag. */
export function assertNativeInputsMatchTag(tag) {
  run('git', ['rev-parse', '--verify', '--quiet', `refs/tags/${tag}`])
  const changed = run('git', ['diff', '--name-only', tag, 'HEAD', '--', ...NATIVE_INPUTS]).trim()
  const dirty = run('git', ['status', '--porcelain', '--', ...NATIVE_INPUTS]).trim()
  if (changed || dirty) {
    throw new Error(
      `[harvest-orcad-prebuilds] native inputs differ from ${tag}; build the slots instead:\n${changed}\n${dirty}`
    )
  }
}

async function releaseAsset(tag, name) {
  const response = await fetch(`https://api.github.com/repos/${REPO}/releases/tags/${tag}`, {
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'orca-fork-harvest' }
  })
  if (!response.ok) {
    throw new Error(`[harvest-orcad-prebuilds] release ${tag}: HTTP ${response.status}`)
  }
  const asset = (await response.json()).assets?.find((candidate) => candidate.name === name)
  if (!asset || !/^sha256:[0-9a-f]{64}$/.test(asset.digest ?? '')) {
    throw new Error(
      `[harvest-orcad-prebuilds] ${tag} has no ${name} with a published sha256 digest`
    )
  }
  return {
    url: asset.browser_download_url,
    sha256: asset.digest.slice('sha256:'.length),
    size: asset.size
  }
}

async function download(asset, destination) {
  if (existsSync(destination) && sha256(destination) === asset.sha256) {
    return
  }
  const response = await fetch(asset.url, { headers: { 'user-agent': 'orca-fork-harvest' } })
  if (!response.ok) {
    throw new Error(`[harvest-orcad-prebuilds] download ${asset.url}: HTTP ${response.status}`)
  }
  writeFileSync(destination, Buffer.from(await response.arrayBuffer()))
  const actual = sha256(destination)
  if (actual !== asset.sha256) {
    rmSync(destination, { force: true })
    throw new Error(
      `[harvest-orcad-prebuilds] ${asset.url} sha256 ${actual} != published ${asset.sha256}`
    )
  }
}

/** Writes the deb's data.tar.* member to `outputDir`; macOS ar cannot read GNU ar member names. */
export function extractDebData(debPath, outputDir) {
  const fd = openSync(debPath, 'r')
  try {
    const read = (length, position) => {
      const buffer = Buffer.alloc(length)
      readSync(fd, buffer, 0, length, position)
      return buffer
    }
    if (read(8, 0).toString('latin1') !== '!<arch>\n') {
      throw new Error(`${debPath} is not an ar archive`)
    }
    let offset = 8
    while (true) {
      const header = read(60, offset)
      if (header.length < 60 || header.subarray(58, 60).toString('latin1') !== '`\n') {
        break
      }
      const name = header.subarray(0, 16).toString('latin1').trim().replace(/\/$/, '')
      const size = Number.parseInt(header.subarray(48, 58).toString('latin1').trim(), 10)
      if (name.startsWith('data.tar')) {
        const path = join(outputDir, name)
        writeFileSync(path, read(size, offset + 60))
        return path
      }
      offset += 60 + size + (size % 2)
    }
  } finally {
    closeSync(fd)
  }
  throw new Error(`${debPath} has no data.tar member`)
}

function slotDescriptor(slot) {
  if (COMPAT_SLOTS[slot]) {
    return { ...COMPAT_SLOTS[slot] }
  }
  const [platform, arch, libc] = slot.split('-')
  return { platform, arch, libc: platform === 'linux' ? libc : 'none' }
}

async function main() {
  const tag = argument('--tag', 'v1.4.255')
  const version = tag.replace(/^v/, '')
  const work = resolve(argument('--work', join(ROOT, 'out', '.orcad-release-harvest', tag)))
  assertNativeInputsMatchTag(tag)
  const nodePtyVersion = require(join(ROOT, 'node_modules', 'node-pty', 'package.json')).version

  const assetName = `orca-ide_${version}_amd64.deb`
  const asset = await releaseAsset(tag, assetName)
  mkdirSync(work, { recursive: true })
  const debPath = join(work, assetName)
  await download(asset, debPath)
  console.log(
    `[harvest-orcad-prebuilds] ${assetName} sha256 ${asset.sha256} (matches the published digest)`
  )

  const extracted = join(work, 'root')
  rmSync(extracted, { recursive: true, force: true })
  mkdirSync(extracted, { recursive: true })
  const dataTar = extractDebData(debPath, work)
  run('tar', ['-xf', dataTar, '-C', extracted, './opt/Orca/resources/orcad-template'])
  const templateDir = join(extracted, 'opt', 'Orca', 'resources', 'orcad-template')
  const releaseManifest = JSON.parse(
    readFileSync(join(templateDir, ORCAD_TEMPLATE_MANIFEST_FILENAME), 'utf8')
  )

  const harvest = (target, file) => {
    const path = join(templateDir, ORCAD_TEMPLATE_TARGETS_DIR, target, ...file.split('/'))
    const expected = releaseManifest.targets?.[target]?.files?.[file]
    if (!expected || !existsSync(path) || sha256(path) !== expected) {
      throw new Error(
        `[harvest-orcad-prebuilds] ${target}/${file} is absent or does not match the release manifest`
      )
    }
    return path
  }
  const place = (source, destination) => {
    mkdirSync(dirname(destination), { recursive: true })
    copyFileSync(source, destination)
    return sha256(destination)
  }

  rmSync(ORCAD_PREBUILDS_DIR, { recursive: true, force: true })
  const slots = {}
  for (const slot of [...SERVER_TARGETS, ...Object.keys(COMPAT_SLOTS)]) {
    const files = {}
    for (const file of orcadNodePtySlotFiles(slot)) {
      const source = harvest(slot, `${ORCAD_NODE_PTY_DIR}/build/Release/${file}`)
      files[file] = place(source, join(ORCAD_PREBUILDS_DIR, slot, ...file.split('/')))
    }
    if (COMPAT_SLOTS[slot]) {
      for (const [file, shipped] of Object.entries(COMPAT_SLOT_ADDONS)) {
        files[file] = place(
          harvest(slot, shipped),
          join(ORCAD_PREBUILDS_DIR, slot, ...file.split('/'))
        )
      }
    }
    // glibc stays null: it is the CI runner's symbol-need record, and a harvested slot has no runner.
    slots[slot] = {
      ...slotDescriptor(slot),
      glibc: null,
      napi: SLOT_NAPI_VERSION,
      files,
      harvestedFrom: `${REPO}@${tag}/${assetName}`
    }
  }
  const manifest = {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    module: 'node-pty',
    version: nodePtyVersion,
    napi: SLOT_NAPI_VERSION,
    nodeHeaders: NODE_RUNTIME_PIN.version,
    slots: Object.fromEntries(Object.entries(slots).sort(([a], [b]) => a.localeCompare(b)))
  }
  writeFileSync(
    join(ORCAD_PREBUILDS_DIR, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`
  )
  const problems = findSlotProblems(manifest, ORCAD_PREBUILDS_DIR, Object.keys(slots))
  if (problems.length > 0) {
    throw new Error(`[harvest-orcad-prebuilds] ${problems.join('; ')}`)
  }

  // Windows template addons; build-orcad stages them from these paths on a non-Windows host.
  for (const target of SERVER_TARGETS.filter((candidate) => candidate.startsWith('win32-'))) {
    const arch = target.slice('win32-'.length)
    place(
      harvest(target, ORCAD_WINDOWS_PROCESS_TREE_FILENAME),
      join(ROOT, '.build', 'windows-process-tree', arch, ORCAD_WINDOWS_PROCESS_TREE_FILENAME)
    )
    place(harvest(target, ORCAD_WINDOWS_SECURITY_FILENAME), windowsSecurityAddonOutput(ROOT, arch))
    place(
      harvest(target, ORCAD_WINDOWS_CLI_LAUNCHER_FILENAME),
      orcadWindowsCliLauncherSource(ROOT, arch)
    )
  }
  console.log(
    `[harvest-orcad-prebuilds] node-pty ${nodePtyVersion}: ${Object.keys(slots).join(', ')} + Windows addons from ${tag}; next: pnpm build:orcad-template`
  )
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  await main()
}
