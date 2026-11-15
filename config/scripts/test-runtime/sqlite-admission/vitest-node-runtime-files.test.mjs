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
