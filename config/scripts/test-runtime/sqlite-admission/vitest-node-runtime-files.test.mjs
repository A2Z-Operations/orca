import { readdirSync } from 'node:fs'
import { join, posix, relative, resolve } from 'node:path'
import { expect, it } from 'vitest'
import { getNodeRuntimeInclude } from './vitest-node-runtime-files.mjs'

const root = resolve(import.meta.dirname, '../../../..')
const AGENT_HOOK_SERVER = 'src/main/agent-hooks/server'

function testFilesUnder(directory) {
  return readdirSync(resolve(root, directory), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.test.ts'))
    .map((entry) => relative(root, join(entry.parentPath, entry.name)).split('\\').join('/'))
    .sort()
}

// orca #48: the agent-hook server saves last status through node:sqlite (WAL) and reads it back read-only when it
// starts. Bun's macOS SQLite refuses a read-only open of a closed WAL file ("unable to open database file"), so on a
// MacBook every server test that restarts or reads the saved rows failed under Bun, while all of them pass on Node.
// The tests reach SQLite only through the server, which the import scan does not follow.
it('runs every agent-hook server test on the Node runtime', () => {
  const files = testFilesUnder(AGENT_HOOK_SERVER)
  expect(files.length).toBeGreaterThan(0)
  const include = getNodeRuntimeInclude({ filters: [AGENT_HOOK_SERVER] })
  const onBun = files.filter((file) => !include.some((pattern) => posix.matchesGlob(file, pattern)))
  expect(onBun).toEqual([])
})

// orca #48 slice 3: the same read-only open of a closed WAL file, reached through product modules the scan did not name
// (the mobile notification dismissal store and its controller, through KeyedJsonRowCache; the profile state database).
it('runs tests that import a module opening SQLite read-only on the Node runtime', () => {
  const files = [
    'src/main/ipc/notifications-subject-retirement.test.ts',
    'src/main/ipc/notifications-external-acknowledgement.test.ts',
    'src/main/runtime/push/notifications/mobile-notification-dismissal-store.test.ts',
    'src/main/runtime/push/notifications/mobile-notification-dismissal-read-failure.test.ts',
    'tests/e2e/helpers/persisted-profile-state.unit.test.ts'
  ]
  const include = getNodeRuntimeInclude({ filters: files })
  const onBun = files.filter((file) => !include.some((pattern) => posix.matchesGlob(file, pattern)))
  expect(onBun).toEqual([])
})

// orca #48 slice 8: Node-only build scripts whose tests hit Bun behavior (each proven by a probe outside Orca):
// Bun's fs.rm on a read-only directory throws ENOTEMPTY where Node throws EACCES, so the reclaim script's
// make-writable retry never ran; Bun's resolver keeps a directory's state after a first lookup and misses a
// node_modules created later, falling back to its global install cache.
it('runs the Node-only build script tests that Bun semantics break on the Node runtime', () => {
  const files = [
    'config/scripts/worktree-storage/reclaim-worktree-generated-files.test.mjs',
    'config/scripts/macos/terminal-host-bundle/macos-terminal-host-bundle.test.mjs'
  ]
  const include = getNodeRuntimeInclude({ filters: files })
  const onBun = files.filter((file) => !include.some((pattern) => posix.matchesGlob(file, pattern)))
  expect(onBun).toEqual([])
})
