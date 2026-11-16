import { posix } from 'node:path'
import { expect, it } from 'vitest'
import { getNodeRuntimeInclude } from './vitest-node-runtime-files.mjs'

// orca #48 slice 9: writing into a child's stdin after the child closed it makes Node's stream emit 'error' with
// EPIPE; Bun returns false from write() and emits no error at all (probed outside Orca, bun 1.4.4). The source
// control generation test proves its pipe-close path by observing that EPIPE, and the code runs only in Electron
// main (Node), so the test runs on Node.
it('runs the source control generation test that observes a real EPIPE on the Node runtime', () => {
  const file = 'src/main/text-generation/source-control-wsl-prompt.test.ts'
  const include = getNodeRuntimeInclude({ filters: [file] })
  expect(include.some((pattern) => posix.matchesGlob(file, pattern))).toBe(true)
})
