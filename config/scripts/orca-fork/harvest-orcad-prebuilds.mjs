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
// Trust root: TAG_PINS, not anything read at run time. The tag must peel to the pinned commit, and the .deb
// must have the pinned name, size and sha256 on disk before it is parsed. GitHub's API answer and every
// download hop are only accepted when they agree with the pin. Every harvested file must also match the
// sha256 the release's own template manifest records.
//
// Usage: node config/scripts/orca-fork/harvest-orcad-prebuilds.mjs [--tag v1.4.255] [--work <dir under .build/>]
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  closeSync,
  copyFileSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
  writeSync
} from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { parseArgs } from 'node:util'
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
const LOG = '[harvest-orcad-prebuilds]'
const USER_AGENT = 'orca-fork-harvest'
export const TAG_PATTERN = /^v\d+\.\d+\.\d+$/
// The only tags this script harvests from. A new tag needs its peeled commit and the asset's size and sha256
// recorded here by hand, from a source other than the run that uses them.
export const TAG_PINS = Object.freeze({
  'v1.4.255': Object.freeze({
    commit: '084ce0eebbdda3f665251984804f2238be666296',
    asset: 'orca-ide_1.4.255_amd64.deb',
    size: 191_836_440,
    sha256: '6df53f4f6c919fd1f10dfe3511940934acc940a7754eb1b0e896d2c62e4add5a'
  })
})
// GitHub serves a release download from github.com as a redirect to one of these storage hosts.
export const DOWNLOAD_REDIRECT_HOSTS = Object.freeze([
  'release-assets.githubusercontent.com',
  'objects.githubusercontent.com'
])
const MAX_DOWNLOAD_REDIRECTS = 3
const API_TIMEOUT_MS = 60_000
const DOWNLOAD_TIMEOUT_MS = 30 * 60_000
// The only ar members a .deb may hold; only the data member is written out.
export const DEB_DATA_MEMBER = /^data\.tar(\.(xz|gz|zst|bz2))?$/
const DEB_OTHER_MEMBERS = [/^debian-binary$/, /^control\.tar(\.(xz|gz|zst))?$/]
const COPY_CHUNK_BYTES = 1 << 20
// Everything a template slot binary is built from. Fork changes elsewhere are JS, rebuilt by build:orcad-template.
export const NATIVE_INPUTS = [
  'pnpm-lock.yaml',
  'package.json',
  'pnpm-workspace.yaml',
  'config/patches',
  'native',
  'config/scripts/native-build',
  'config/scripts/orcad-distribution/prebuilds',
  'src/shared/node-runtime-pin.ts',
  // Compiled into the harvested Windows orca.exe (build-windows-cli-launcher.mjs).
  'resources/build/icon.ico'
]

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

/** Resolves `child` and refuses unless it lies strictly inside `parent`. */
export function assertPathInside(parent, child) {
  const resolvedChild = resolve(child)
  const rel = relative(resolve(parent), resolvedChild)
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`${LOG} ${resolvedChild} is not inside ${resolve(parent)}`)
  }
  return resolvedChild
}

/** Refuses unless `path` is a regular file (not a symlink) whose real location stays inside `root`. */
export function assertRegularFileInside(root, path) {
  const inside = assertPathInside(root, path)
  const stat = lstatSync(inside, { throwIfNoEntry: false })
  if (!stat?.isFile()) {
    throw new Error(`${LOG} ${inside} is not a regular file`)
  }
  assertPathInside(realpathSync(root), realpathSync(inside))
  return inside
}

/** The pin for `tag`; refuses a malformed or unpinned tag. */
export function tagPin(tag, pins = TAG_PINS) {
  if (typeof tag !== 'string' || !TAG_PATTERN.test(tag)) {
    throw new Error(`${LOG} --tag must look like v1.2.3, got ${JSON.stringify(tag)}`)
  }
  const pin = Object.hasOwn(pins, tag) ? pins[tag] : undefined
  if (!pin) {
    throw new Error(
      `${LOG} ${tag} is not pinned in TAG_PINS; pin its commit, asset, size and sha256 first`
    )
  }
  return pin
}

/**
 * Refuses unless the local tag peels to the pinned commit and every native input is byte-identical to that
 * commit, in HEAD and in the working tree.
 */
export function assertNativeInputsMatchTag(tag, { root = ROOT, pins = TAG_PINS } = {}) {
  const pin = tagPin(tag, pins)
  const peeled = spawnSync(
    'git',
    ['rev-parse', '--verify', '--quiet', `refs/tags/${tag}^{commit}`],
    {
      cwd: root,
      encoding: 'utf8'
    }
  )
  if (peeled.error || peeled.status !== 0) {
    throw new Error(
      `${LOG} tag ${tag} not found; git fetch https://github.com/${REPO}.git tag ${tag} --no-tags`
    )
  }
  const commit = peeled.stdout.trim()
  if (commit !== pin.commit) {
    throw new Error(
      `${LOG} ${tag} peels to ${commit}, but the pinned commit is ${pin.commit}; refusing`
    )
  }
  const options = { cwd: root }
  const changed = run(
    'git',
    ['diff', '--name-only', pin.commit, 'HEAD', '--', ...NATIVE_INPUTS],
    options
  ).trim()
  const dirty = run('git', ['status', '--porcelain', '--', ...NATIVE_INPUTS], options).trim()
  if (changed || dirty) {
    throw new Error(
      `${LOG} native inputs differ from ${tag} (${pin.commit}); build the slots instead:\n${changed}\n${dirty}`
    )
  }
}

/** The one URL the pinned asset may be downloaded from. */
export function releaseDownloadUrl(tag, pin) {
  return `https://github.com/${REPO}/releases/download/${tag}/${pin.asset}`
}

/** Refuses unless GitHub's release-asset record agrees with the pin on name, URL, size and digest. */
export function assertReleaseAssetMatchesPin(asset, tag, pin) {
  const prefix = `https://github.com/${REPO}/releases/download/${tag}/`
  const problems = []
  if (asset?.name !== pin.asset) {
    problems.push(`name ${JSON.stringify(asset?.name)}`)
  }
  const url = asset?.browser_download_url
  if (typeof url !== 'string' || !url.startsWith(prefix) || url !== releaseDownloadUrl(tag, pin)) {
    problems.push(`browser_download_url ${JSON.stringify(url)}`)
  }
  if (asset?.size !== pin.size) {
    problems.push(`size ${JSON.stringify(asset?.size)}`)
  }
  if (asset?.digest !== `sha256:${pin.sha256}`) {
    problems.push(`digest ${JSON.stringify(asset?.digest)}`)
  }
  if (problems.length > 0) {
    throw new Error(`${LOG} ${tag}/${pin.asset} disagrees with TAG_PINS: ${problems.join(', ')}`)
  }
}

/** Accepts a download redirect only to an https GitHub storage host. */
export function assertRedirectTarget(location, base) {
  let url
  try {
    url = new URL(location, base)
  } catch {
    throw new Error(`${LOG} unparseable redirect ${JSON.stringify(location)}`)
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    !DOWNLOAD_REDIRECT_HOSTS.includes(url.hostname)
  ) {
    throw new Error(`${LOG} refusing redirect to ${url.origin}`)
  }
  return url.href
}

/** Refuses unless the bytes at `path` are a regular file of exactly the pinned size and sha256. */
export function assertFileMatchesPin(path, pin) {
  const stat = lstatSync(path, { throwIfNoEntry: false })
  if (!stat?.isFile()) {
    throw new Error(`${LOG} ${path} is not a regular file`)
  }
  if (stat.size !== pin.size) {
    throw new Error(`${LOG} ${path} is ${stat.size} bytes, pinned ${pin.size}`)
  }
  const actual = sha256(path)
  if (actual !== pin.sha256) {
    throw new Error(`${LOG} ${path} sha256 ${actual} != pinned ${pin.sha256}`)
  }
}

function fileMatchesPin(path, pin) {
  try {
    assertFileMatchesPin(path, pin)
    return true
  } catch {
    return false
  }
}

async function assertPublishedAssetMatchesPin(tag, pin) {
  const response = await fetch(`https://api.github.com/repos/${REPO}/releases/tags/${tag}`, {
    headers: { accept: 'application/vnd.github+json', 'user-agent': USER_AGENT },
    redirect: 'error',
    signal: AbortSignal.timeout(API_TIMEOUT_MS)
  })
  if (!response.ok) {
    throw new Error(`${LOG} release ${tag}: HTTP ${response.status}`)
  }
  const asset = (await response.json()).assets?.find((candidate) => candidate.name === pin.asset)
  assertReleaseAssetMatchesPin(asset, tag, pin)
}

function writeAll(fd, chunk) {
  let written = 0
  while (written < chunk.length) {
    written += writeSync(fd, chunk, written, chunk.length - written)
  }
}

/** Streams the pinned asset to `destination` (capped at the pinned size), then verifies it on disk. */
async function download(tag, pin, destination) {
  const partial = `${destination}.partial`
  rmSync(partial, { force: true })
  let url = releaseDownloadUrl(tag, pin)
  const signal = AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS)
  for (let hop = 0; ; hop += 1) {
    const response = await fetch(url, {
      headers: { 'user-agent': USER_AGENT },
      redirect: 'manual',
      signal
    })
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel()
      if (hop >= MAX_DOWNLOAD_REDIRECTS) {
        throw new Error(`${LOG} too many redirects downloading ${pin.asset}`)
      }
      url = assertRedirectTarget(response.headers.get('location') ?? '', url)
      continue
    }
    if (!response.ok || !response.body) {
      throw new Error(`${LOG} download ${new URL(url).origin}: HTTP ${response.status}`)
    }
    const fd = openSync(partial, 'wx')
    try {
      let received = 0
      for await (const chunk of response.body) {
        received += chunk.length
        if (received > pin.size) {
          throw new Error(`${LOG} ${pin.asset} exceeds the pinned ${pin.size} bytes`)
        }
        writeAll(fd, chunk)
      }
    } catch (error) {
      closeSync(fd)
      rmSync(partial, { force: true })
      throw error
    }
    closeSync(fd)
    break
  }
  try {
    assertFileMatchesPin(partial, pin)
  } catch (error) {
    rmSync(partial, { force: true })
    throw error
  }
  renameSync(partial, destination)
}

/**
 * Writes the deb's data.tar.* member into `outputDir` and returns its path; macOS ar cannot read GNU ar member
 * names. Refuses unknown member names, a truncated archive and any output path outside `outputDir`.
 */
export function extractDebData(debPath, outputDir) {
  const fd = openSync(debPath, 'r')
  try {
    const fileSize = fstatSync(fd).size
    const readExactly = (buffer, length, position) => {
      let done = 0
      while (done < length) {
        const count = readSync(fd, buffer, done, length - done, position + done)
        if (count === 0) {
          break
        }
        done += count
      }
      if (done !== length) {
        throw new Error(`${debPath}: short read at ${position}, ${done} of ${length} bytes`)
      }
      return buffer
    }
    if (fileSize < 8 || readExactly(Buffer.alloc(8), 8, 0).toString('latin1') !== '!<arch>\n') {
      throw new Error(`${debPath} is not an ar archive`)
    }
    let offset = 8
    while (offset < fileSize) {
      const header = readExactly(Buffer.alloc(60), 60, offset)
      if (header.subarray(58, 60).toString('latin1') !== '`\n') {
        throw new Error(`${debPath}: malformed ar header at ${offset}`)
      }
      const name = header.subarray(0, 16).toString('latin1').trimEnd().replace(/\/$/, '')
      const sizeField = header.subarray(48, 58).toString('latin1').trim()
      const size = /^\d+$/.test(sizeField) ? Number(sizeField) : Number.NaN
      if (!Number.isSafeInteger(size) || size < 0) {
        throw new Error(`${debPath}: bad ar member size ${JSON.stringify(sizeField)} at ${offset}`)
      }
      const start = offset + 60
      if (start + size > fileSize) {
        throw new Error(
          `${debPath}: member ${JSON.stringify(name)} declares ${size} bytes past the end`
        )
      }
      if (DEB_DATA_MEMBER.test(name)) {
        const path = assertPathInside(outputDir, join(outputDir, name))
        const out = openSync(path, 'w')
        try {
          const chunk = Buffer.alloc(Math.min(COPY_CHUNK_BYTES, Math.max(size, 1)))
          for (let copied = 0; copied < size;) {
            const length = Math.min(chunk.length, size - copied)
            readExactly(chunk, length, start + copied)
            writeAll(out, chunk.subarray(0, length))
            copied += length
          }
        } finally {
          closeSync(out)
        }
        return path
      }
      if (!DEB_OTHER_MEMBERS.some((pattern) => pattern.test(name))) {
        throw new Error(`${debPath}: unexpected ar member ${JSON.stringify(name)}`)
      }
      offset = start + size + (size % 2)
    }
  } finally {
    closeSync(fd)
  }
  throw new Error(`${debPath} has no data.tar member`)
}

/**
 * The harvest work dir: a strict descendant of the repo's .build/. Each component below .build/ is created one
 * at a time and must be a plain directory, so a symlink cannot carry the work dir (or its creation) elsewhere.
 */
export function prepareWorkDir(work, root = ROOT) {
  const buildDir = join(root, '.build')
  const resolved = assertPathInside(buildDir, work)
  mkdirSync(buildDir, { recursive: true })
  let current = buildDir
  for (const segment of relative(buildDir, resolved).split(sep)) {
    current = join(current, segment)
    if (!lstatSync(current, { throwIfNoEntry: false })) {
      mkdirSync(current)
    }
    if (!lstatSync(current).isDirectory()) {
      throw new Error(`${LOG} ${current} is not a plain directory`)
    }
  }
  assertPathInside(realpathSync(buildDir), realpathSync(resolved))
  return resolved
}

function slotDescriptor(slot) {
  if (COMPAT_SLOTS[slot]) {
    return { ...COMPAT_SLOTS[slot] }
  }
  const [platform, arch, libc] = slot.split('-')
  return { platform, arch, libc: platform === 'linux' ? libc : 'none' }
}

function harvestFromTemplate(templateDir, releaseManifest) {
  return (target, file) => {
    const path = assertRegularFileInside(
      templateDir,
      join(templateDir, ORCAD_TEMPLATE_TARGETS_DIR, target, ...file.split('/'))
    )
    const expected = releaseManifest.targets?.[target]?.files?.[file]
    if (typeof expected !== 'string' || sha256(path) !== expected) {
      throw new Error(`${LOG} ${target}/${file} does not match the release manifest`)
    }
    return path
  }
}

function place(source, destination) {
  mkdirSync(dirname(destination), { recursive: true })
  copyFileSync(source, destination)
  return sha256(destination)
}

function harvestSlots({ harvest, tag, assetName, nodePtyVersion }) {
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
    throw new Error(`${LOG} ${problems.join('; ')}`)
  }
  return Object.keys(slots)
}

function harvestWindowsAddons(harvest) {
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
}

async function main() {
  const { values } = parseArgs({
    options: { tag: { type: 'string', default: 'v1.4.255' }, work: { type: 'string' } },
    strict: true,
    allowPositionals: false
  })
  const tag = values.tag
  const pin = tagPin(tag)
  assertNativeInputsMatchTag(tag)
  const work = prepareWorkDir(values.work ?? join(ROOT, '.build', 'orcad-release-harvest', tag))
  const nodePtyVersion = require(join(ROOT, 'node_modules', 'node-pty', 'package.json')).version

  const debPath = join(work, pin.asset)
  if (fileMatchesPin(debPath, pin)) {
    console.log(`${LOG} reusing ${pin.asset}; it matches the pin`)
  } else {
    await assertPublishedAssetMatchesPin(tag, pin)
    await download(tag, pin, debPath)
  }
  // The bytes about to be parsed, checked again right before parsing.
  assertFileMatchesPin(debPath, pin)
  console.log(`${LOG} ${pin.asset} sha256 ${pin.sha256}, ${pin.size} bytes (matches TAG_PINS)`)

  // A fresh directory per run, so nothing that existed before is ever removed recursively.
  const scratch = mkdtempSync(join(work, 'extract-'))
  try {
    const extracted = join(scratch, 'root')
    mkdirSync(extracted)
    const dataTar = extractDebData(debPath, scratch)
    run('tar', [
      '--no-same-owner',
      '-xf',
      dataTar,
      '-C',
      extracted,
      './opt/Orca/resources/orcad-template'
    ])
    const templateDir = join(extracted, 'opt', 'Orca', 'resources', 'orcad-template')
    assertPathInside(realpathSync(extracted), realpathSync(templateDir))
    const manifestPath = assertRegularFileInside(
      templateDir,
      join(templateDir, ORCAD_TEMPLATE_MANIFEST_FILENAME)
    )
    const harvest = harvestFromTemplate(templateDir, JSON.parse(readFileSync(manifestPath, 'utf8')))
    const slots = harvestSlots({ harvest, tag, assetName: pin.asset, nodePtyVersion })
    harvestWindowsAddons(harvest)
    console.log(
      `${LOG} node-pty ${nodePtyVersion}: ${slots.join(', ')} + Windows addons from ${tag}; next: pnpm build:orcad-template`
    )
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  await main()
}
