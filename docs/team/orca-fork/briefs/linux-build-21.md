# Linux x64 build of the fork for the headless Dell hosts (#21)

Build and verify only. Nothing here is run on a Dell. Base: `origin/blowzer/fork-only` at
`afb37089e20` (PRs #16, #18, #20, #23, #27). Target version: `1.4.256-blowzer.7-linux`.

## 1. Where upstream builds Linux, and what it needs

### Entry points in the tree

| What                  | Where                                                                                                                                                                                                                                                                                            |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Local Linux package   | `pnpm build:linux` = `build:desktop` + `ensure:electron-runtime` + `config/scripts/desktop-distribution/linux/build-linux-local.mjs` (`electron-builder --config config/electron-builder.config.cjs --linux AppImage deb rpm --x64`, arch from `ORCA_LINUX_BUILD_ARCH`, default `x64` off-Linux) |
| Release Linux package | `.github/workflows/release-cut.yml` job `build`, matrix `linux-x64` on `ubuntu-latest`                                                                                                                                                                                                           |
| orcad template        | `.github/workflows/qualified-orcad-template.yml` → `node-server-tests.yml` with `build_template: true` (one lane per OS/arch/libc, merged), then `pnpm build:orcad-template` (`config/scripts/orcad-distribution/template/build-orcad-template.mjs`) → `out/orcad-template/`                     |
| Linux config          | `config/electron-builder.config.cjs` `linux` / `deb` / `rpm` / `appImage`; `executableName: 'orca-ide'`; deb `packageName: 'orca-ide'`; `resources/linux/packaging/after-install.sh` links `/usr/bin/orca-ide` → `/opt/Orca/resources/bin/orca-ide`                                              |
| Update manifest       | `publish: null` when `ORCA_NO_PUBLISH=1`, so no `resources/app-update.yml`; `src/main/updater/updater-disabled.ts` then switches the updater off ("self-built app without app-update.yml")                                                                                                       |

The `.deb` is the format that matches the Dells: it installs into `/opt/Orca` and links
`/usr/bin/orca-ide`, which is the layout and launcher they already run. The AppImage and rpm are by-products.

### Release recipe for linux-x64 (from `release-cut.yml`, minus signing/publishing)

```sh
npm install -g node-gyp@11.5.0                       # pnpm's bundled node-gyp is not executable on Linux
export npm_config_node_gyp="$(npm root -g)/node-gyp/bin/node-gyp.js"
pnpm install --frozen-lockfile
pnpm --dir mobile install --frozen-lockfile          # build:mobile-web needs expo-router / react-native-web
sudo apt-get install -y python3-gi gir1.2-atspi-2.0 at-spi2-core xclip xdotool rpm
NODE_OPTIONS=--max-old-space-size=4096 pnpm run build:release
#   = build:wsl-guest, build:native (Linux: Wayland clipboard helper, via Docker),
#     verify:computer-native, build:cli, build:electron-vite, verify:built-skills-cli,
#     build:web-from-renderer, build:mobile-web
# out/orcad-template/  <- the merged template artifact (see below)
export ORCA_REQUIRE_ORCAD_TEMPLATE=1
node config/scripts/native-build/node-addons/ensure-native-runtime.mjs --runtime=electron
pnpm exec electron-builder --config config/electron-builder.config.cjs --linux AppImage deb rpm --x64
```

Fork recipe on top (from BLOWzer `scripts/orca-fork/rebuild.sh`, Mac flavour):

```sh
ORCA_NO_PUBLISH=1 \
ORCA_BUILD_COMMIT=$(git rev-parse --short=12 HEAD) \
ORCA_LOCAL_BUILD_VERSION=1.4.256-blowzer.7-linux \
ORCA_REQUIRE_ORCAD_TEMPLATE=1 \
pnpm exec electron-builder --config config/electron-builder.config.cjs --linux deb --x64
```

`ORCA_LOCAL_BUILD_VERSION` sets the app version, and `afterPack` stamps it into
`resources/app.asar.unpacked/out/package.json` (`stampPackagedCliVersion`). The deb file is named
`orca-ide_${version}_${arch}.deb`.

### What the build verifies on its own (`beforePack` / `afterPack`)

- `assertPackagedNativeVariantsInstalled('linux', x64)`: the linux-x64 variants of the platform npm packages must be installed.
- `ensureBundledWaylandClipboard`: `native/wayland-clipboard/.build/x64/orca-wayland-clipboard`, built by `build-wayland-clipboard.mjs` **through `docker build` + `docker run`** (ubuntu:20.04 with cross gcc), or reused when its `.sha256` stamp matches the sources.
- `assertOrcadTemplateBuilt`: when `ORCA_REQUIRE_ORCAD_TEMPLATE=1`, `out/orcad-template/<manifest>` must exist.
- `placeAppImageNodeRuntime`: downloads the pinned Node into `resources/` (it is fetched, not compiled).
- `verifyLinuxGlibcFloor`: every ELF must load on glibc 2.31 / GLIBCXX_3.4.28 (Ubuntu 20.04). Upstream's `config/patches/node-pty@1.1.0.patch` pins `openpty/forkpty/pthread_sigmask` with `.symver`, so a node-pty built on a newer glibc still passes.
- `finalizePackagedOrcadTemplate` → `verifyPackagedOrcadTemplate(resourcesDir)`: whenever a template is present, it checks **all 8 `SERVER_TARGETS`** (`darwin-arm64`, `darwin-x64`, `linux-arm64-glibc`, `linux-x64-glibc`, `linux-arm64-musl`, `linux-x64-musl`, `win32-arm64`, `win32-x64`). The compat slot `linux-x64-glibc217` is optional. Only CI builds a partial `--targets` template, and packaging refuses one.
- The daemon boot / AppImage-Node-serves-PTY smokes run only when the host can execute the target arch (`canExecuteTargetArch`). Otherwise they are skipped with a log line.

At runtime a Linux host reads only its own `manifest.targets[<target>]`
(`src/main/orcad/orcad-artifact-materializer.ts`). The all-targets rule is enforced at packaging time, not at runtime.

### Native modules: which need linux-x64 binaries, and whether they can be fetched

| Item                                                                                                                                                       | linux-x64 source                                                                                                                                                                                                                                     | Fetch, don't compile?                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node-pty@1.1.0` (Electron app, N-API)                                                                                                                     | compiled by `beforeBuild` → `rebuild-native-deps.mjs` → `@electron/rebuild`/node-gyp, with the fork-identical upstream patch                                                                                                                         | **No npm prebuild for Linux** (the package ships `prebuilds/` for darwin and win32 only). It must be compiled on Linux x64. The only fetch path is lifting `pty.node` from the upstream v1.4.255 deb, whose lockfile, `package.json` and `config/patches` are byte-identical to the fork's (`git diff v1.4.255 origin/blowzer/fork-only -- pnpm-lock.yaml package.json config/patches` is empty).                                                                                                                                                                                                                     |
| `orca-wayland-clipboard` (C)                                                                                                                               | `build-wayland-clipboard.mjs` via Docker (ubuntu:20.04 + `x86_64-linux-gnu-gcc`)                                                                                                                                                                     | Built by Docker from any host, including the Mac (it cross-compiles). The cached `.build/x64` output plus its stamp is reused.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `sherpa-onnx-linux-x64`, `agent-browser-linux-x64` binary, `@vscode/ripgrep-universal` linux binary, `@parcel/watcher` linux-x64-glibc                     | npm platform packages                                                                                                                                                                                                                                | Yes, fetched. On a non-Linux host this needs `pnpm install` with `supportedArchitectures` widened to `os: linux, cpu: x64` (the workspace pins `current`).                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Pinned Node for the AppImage/deb runtime                                                                                                                   | `appimage-node-runtime.cjs` download                                                                                                                                                                                                                 | Yes, fetched.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| orcad template node-pty slots (8 targets + optional glibc217 compat) and the Windows template addons (windows-process-tree, CLI launcher, security addons) | `pnpm build:orcad-prebuilds` on each target's own runner (glibc 2.28 lane, ubuntu-22.04 glibc217 lane, Alpine musl lanes, macOS lanes, windows-2022 lane), merged by `merge-orcad-prebuilds.mjs` into `out/orcad-prebuilds/manifest.json` (schema 2) | **No single host can build them all.** A Linux host builds the linux slots, a Mac the darwin slots, and only Windows builds the win32 slots and addons. Fetch paths: (i) the fork's own GitHub Actions `Headless Node server` workflow (`workflow_dispatch`, `build_template: true`), which emits the merged `orcad-template` artifact; or (ii) harvest the slot binaries from the upstream v1.4.255 release template (`resources/orcad-template/targets/*`, from the same lockfile and patches). The fork JS (`orcad-server.js`, `plugin-host-entry.js`) is then rebuilt by `pnpm build:orcad-template` on any host. |
| `deb`/`rpm` packaging (fpm)                                                                                                                                | electron-builder downloads fpm on Linux                                                                                                                                                                                                              | On macOS fpm must already be installed (`gem install fpm`), and it is not installed here.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

## 2. Where to build: decision

- **(a) Cross-build on this Mac (arm64): not possible as-is.** node-pty has no Linux prebuild, and `@electron/rebuild` on darwin cannot produce a linux-x64 ELF. fpm is missing for the deb. The template's linux and win32 slots cannot be built here. Getting through would take a harvested `pty.node` slipped past `beforeBuild` plus an fpm install, and both are out of scope.
- **(b) Docker on this Mac: not used.** Docker Desktop 28.3.3 is installed, but its daemon is not running (`docker info` → `Cannot connect to the Docker daemon`). The coordinator decided (2026-11-12) not to start it: an emulated multi-hour amd64 build would compete with the leader session on this MacBook. The repo's own image (`config/docker/headless-pairing/Dockerfile.build`, node:24.22.1-bookworm + build-essential, rpm, libsecret, pkg-config, python3, corepack pnpm 12.14.0) is the build environment. It runs natively on an x86 host: section 3.
- **(c) A Dell: not yet.** The Orca fork's Dell CI tenant is not granted (owner request pending; `orca-ci` toolchain exit 127), and this task does not touch the Dells.
- **Template, the same problem on every route:** with `ORCA_REQUIRE_ORCAD_TEMPLATE=1`, the build needs a complete 8-target template. No single host makes one. **Decision: harvest** (coordinator, 2026-11-12), via `config/scripts/orca-fork/harvest-orcad-prebuilds.mjs`, and not the Actions route (no macOS/Windows runner minutes). Done on this Mac; see section 4.
- **Outcome for #21: recipe only for the Linux package.** The package build is the single Fleet hand step in section 3, run once the Orca CI tenant exists.

### The harvest script

`node config/scripts/orca-fork/harvest-orcad-prebuilds.mjs [--tag v1.4.255] [--work <dir under .build/>]`:

The trust root is `TAG_PINS` in the script, not anything read at run time. Only pinned tags are accepted (`--tag` must also match `^v\d+\.\d+\.\d+$`). For v1.4.255 the pin is commit `084ce0eebbdda3f665251984804f2238be666296` and asset `orca-ide_1.4.255_amd64.deb`, 191 836 440 bytes, sha256 `6df53f4f6c919fd1f10dfe3511940934acc940a7754eb1b0e896d2c62e4add5a`.

1. Refuses unless `refs/tags/<tag>^{commit}` is the pinned commit, and every native input is byte-identical to that commit. `NATIVE_INPUTS` = `pnpm-lock.yaml`, `package.json`, `pnpm-workspace.yaml`, `config/patches`, `native`, `config/scripts/native-build`, `config/scripts/orcad-distribution/prebuilds`, `src/shared/node-runtime-pin.ts`, `resources/build/icon.ico` (compiled into the Windows `orca.exe`). They are compared against `git diff <pinned commit> HEAD` and the working tree. The script lives in `config/scripts/orca-fork/` so that it is not one of those inputs itself.
2. Downloads the pinned `.deb` from the public `stablyai/orca` release (download only), into `.build/orcad-release-harvest/<tag>/` by default. GitHub's release record must agree with the pin (name, `browser_download_url` exactly `https://github.com/stablyai/orca/releases/download/<tag>/<asset>`, size, digest). Redirects are followed by hand, only to https `release-assets.githubusercontent.com` or `objects.githubusercontent.com`, and the body is capped at the pinned size. The bytes on disk must have the pinned size and sha256 before anything parses them; a cached copy that already matches is reused without the network. `--work` must resolve strictly inside the repo's `.build/`, through plain directories only.
3. Extracts `./opt/Orca/resources/orcad-template` into a fresh `mkdtemp` directory (removed afterwards) with a small ar reader plus `tar --no-same-owner`. The ar reader accepts only the members `debian-binary`, `control.tar[.xz|.gz|.zst]` and `data.tar[.xz|.gz|.zst|.bz2]`, and fails on a short read or a size past the end. Every file it takes must be a regular file (no symlink) whose real path stays inside the extracted template, and must match the sha256 in the release's own `orcad-template.json`.
4. Writes `out/orcad-prebuilds/<slot>/` for the 8 targets plus `linux-x64-glibc217` (node-pty slot files, and the compat watcher addon), along with `manifest.json` (schema 2; `glibc: null`; `harvestedFrom`). It also writes `.build/windows-process-tree|windows-security|windows-cli-launcher/<arch>/`. All three, and the download cache, are gitignored.

Unit tests: `config/scripts/orca-fork/harvest-orcad-prebuilds.test.mjs` (offline: path containment, the ar reader, the pin checks, the tag-commit guard against a scratch git repo).

Then `pnpm build:orcad-template` rebuilds every target's package from fork source with those slots.

## 3. Fleet hand step: build the Linux package on a native x86 host

This is a single step, run once the Orca fork's CI tenant exists. It needs `git`, Docker, Node 24 and `objdump` (binutils)
on an x86_64 Linux host (no emulation). No package is installed on the host and nothing is deployed, but Docker pulls and
builds images on the host, and the step-1 container runs as root, so it leaves root-owned files in the checkout (`out/`,
`dist/`, `node_modules/`). Output: `dist/orca-ide_1.4.256-blowzer.7-linux_amd64.deb`.

```sh
git clone https://github.com/A2Z-Operations/orca.git orca-fork && cd orca-fork
git checkout <PR head of this brief, or blowzer/fork-only once merged>
git fetch https://github.com/stablyai/orca.git tag v1.4.255 --no-tags    # read-only; the harvest compares against it

# 0. Wayland helper, with host Node: the script imports only node builtins and a local .cjs, and drives the host's
#    Docker itself, so no container needs the Docker socket.
node config/scripts/native-build/linux/build-wayland-clipboard.mjs --arch x64

# 1. Everything else, in the repo's own build image.
docker build --platform linux/amd64 -t orca-fork-linux-build \
  -f config/docker/headless-pairing/Dockerfile.build config/docker/headless-pairing
docker run --rm --platform linux/amd64 -v "$PWD:/workspace" -w /workspace \
  -e ORCA_NO_PUBLISH=1 -e ORCA_REQUIRE_ORCAD_TEMPLATE=1 \
  -e ORCA_LOCAL_BUILD_VERSION=1.4.256-blowzer.7-linux -e ORCA_BUILD_COMMIT="$(git rev-parse --short=12 HEAD)" \
  -e NODE_OPTIONS=--max-old-space-size=4096 \
  orca-fork-linux-build bash -euxc '
    git config --global --add safe.directory /workspace
    apt-get update && apt-get install -y --no-install-recommends python3-gi gir1.2-atspi-2.0 at-spi2-core xclip xdotool
    npm install -g node-gyp@11.5.0 && export npm_config_node_gyp="$(npm root -g)/node-gyp/bin/node-gyp.js"
    pnpm install --frozen-lockfile
    pnpm --dir mobile install --frozen-lockfile
    pnpm run build:packages
    node config/scripts/orca-fork/harvest-orcad-prebuilds.mjs --tag v1.4.255
    pnpm run build:orcad-template
    pnpm run build:release          # build:native reuses the stamped Wayland helper from step 0
    node config/scripts/native-build/node-addons/ensure-native-runtime.mjs --runtime=electron
    pnpm exec electron-builder --config config/electron-builder.config.cjs --linux deb --x64
  '

# 2. Verify (no install, no run on a Dell).
D=dist/orca-ide_1.4.256-blowzer.7-linux_amd64.deb
sha256sum "$D"; stat -c %s "$D"
dpkg-deb -f "$D" Package Version Architecture             # orca-ide / 1.4.256-blowzer.7-linux / amd64
dpkg-deb -c "$D" | grep -E 'resources/orcad-template/(orcad-server|plugin-host-entry)\.js$'   # both present
dpkg-deb -c "$D" | grep -c 'app-update.yml'                # 0
dpkg-deb --fsys-tarfile "$D" | tar -xO ./opt/Orca/resources/app.asar.unpacked/out/package.json | grep '"version"'   # 1.4.256-blowzer.7-linux
ls dist/linux-unpacked/resources/orcad-template/targets   # 9 targets
```

The build's own gates still run inside the container: the glibc 2.31 floor, the daemon-entry boot and the AppImage-Node PTY smoke (same arch, so not skipped), the packaged template verify (all 8 targets) and `assertOrcadTemplateBuilt`. Record the sha256 and size in section 4 before handing the deb to the install runbook.

Toolchain the `orca-ci` tenant needs if it builds without the container (its current exit 127 is a missing binary):

- Node 24 (`engines.node: "24"`; the image uses 24.22.1), `corepack` with pnpm 12.14.0, git
- `build-essential` (gcc, g++, make), `python3`, `pkg-config`, `libsecret-1-dev`
- `npm i -g node-gyp@11.5.0` and `npm_config_node_gyp` exported
- `rpm` (or build `--linux deb` only), plus `python3-gi gir1.2-atspi-2.0 at-spi2-core xclip xdotool` for the computer-use verify
- Docker, or a pre-built `native/wayland-clipboard/.build/x64/` from another host, for the Wayland helper
- outbound HTTPS to registry.npmjs.org, github.com (electron, electron-builder binaries, fpm, pinned Node), nodejs.org
- about 20 GB free disk, 8 GB RAM or more (`NODE_OPTIONS=--max-old-space-size=4096`)
- the harvest above for `out/orcad-template/`. The tenant can build only the linux-x64 slots itself.

## 4. What ran in #21 (this MacBook, 2026-11-12)

The orcad template was harvested and rebuilt from fork source at `afb37089e202` (Node 24.22.0, pnpm 12.14.0, deps from
`install --frozen-lockfile --ignore-scripts`, plus `pnpm --dir mobile run postinstall` for the mobile-web generated files):

- `harvest-orcad-prebuilds.mjs`: deb digest matched the published one; 9 slots + the Windows addons, each matching the release manifest.
- `pnpm build:mobile-web` → `[verify-packaged-mobile-web-bundle] OK`, 140 assets.
- `pnpm build:orcad-template` → `[build-orcad] ok — 0.1.0+1b08d3ad6e8a … Node 24.22.1 referenced`, `[verify-packaged-orcad-template] OK — verified 9 Node targets`, `[build-orcad-template] ok — 9 targets`.
- The packaging check run directly (`verifyPackagedOrcadTemplate('out')` with every target, plus `assertNotDarkBuild`): OK, 9 targets.
- `out/orcad-template/` (132 MB) has `orcad-server.js` (sha256 `3d49c0b3…d753`; stock v1.4.255 is `d91333f6…a51f`, so this is the fork bundle) and `plugin-host-entry.js` (`7a013ab4…0334`; absent from stock). Each target's `pty.node` is byte-equal to the harvested slot.
- `vitest run config/scripts/orcad-distribution/template config/scripts/orcad-distribution/prebuilds`: 7 files, 19 tests passed. `oxlint` is clean on the script.

**Not built: the Linux `.deb`.** It needs a native x86 host (section 3), so no artifact sha256 or size exists yet, and no `dist/` output was produced.

## 5. Dell install runbook (owner line; not run in #21)

Owner: Nachumi. Quiet window: no agent turns in flight on that Dell, and the Dell's sessions are parked.
Installing the deb restarts `orca serve`, which ends every PTY the serve owns.

1. **Pre-read (read-only):** `dpkg -s orca-ide | grep -E '^(Status|Version)'` → `1.4.256`;
   `readlink -f /usr/bin/orca-ide`; `systemctl status orca-serve.service --no-pager`;
   `cat /opt/Orca/resources/app.asar.unpacked/out/package.json | grep version`;
   `ls /opt/Orca/resources/app-update.yml` (stock has it).
2. **Back up the stock install for rollback:** keep the stock deb (`orca-ide_1.4.256_amd64.deb`
   from the stablyai/orca v1.4.256 release, sha256 recorded beside it) in `~/orca-rollback/`, and
   `test ! -e /opt/Orca-1.4.256 && sudo cp -a /opt/Orca /opt/Orca-1.4.256` (same disk, so the copy is fast;
   the `test` stops a second run from nesting the copy inside an existing backup).
3. **Copy the artifact:** `scp` the fork deb to the Dell; `sha256sum` must match section 4.
4. **Install:** `sudo systemctl stop orca-serve.service` → `sudo apt-get install -y ./orca-ide_1.4.256-blowzer.7-linux_amd64.deb`
   (dependencies as in stock) → `sudo systemctl start orca-serve.service`.
5. **Read back:** `dpkg -s orca-ide` shows `1.4.256-blowzer.7-linux`;
   `test ! -e /opt/Orca/resources/app-update.yml`;
   `ls /opt/Orca/resources/orcad-template/` lists `orcad-server.js` and `plugin-host-entry.js`;
   `systemctl is-active orca-serve.service` → `active`; `orca status` / `orca plugin list` answer (the headless plugin service, #19);
   `journalctl -u orca-serve.service --since -5min` shows no crash loop.
6. **Rollback** if any read-back fails: `sudo systemctl stop orca-serve.service` →
   `sudo apt-get install -y --allow-downgrades ~/orca-rollback/orca-ide_1.4.256_amd64.deb`
   (or `test -d /opt/Orca-1.4.256 && sudo rm -rf /opt/Orca && sudo mv /opt/Orca-1.4.256 /opt/Orca`, which
   removes nothing unless the backup exists) → start the service → repeat
   the step-1 reads, expecting `1.4.256` and `app-update.yml` present.

Refs #21. The issue closes when the Dells run the build.
