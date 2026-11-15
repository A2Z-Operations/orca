import { expect, it } from 'vitest'
import { unitTestPrelude } from './check-changed.mjs'

// Fork (#48): the cross-version wire tests need upstream's release tags, and the fork repo carries none. The unit
// step fetches them first on a clone that has none (a no-op otherwise), so the gate needs no hand step.
it('the unit step fetches missing upstream release tags before anything else', () => {
  const steps = unitTestPrelude('node')
  expect(steps[0]).toEqual({
    program: 'node',
    args: ['config/scripts/orca-fork/fetch-upstream-release-tags.mjs', '--if-missing']
  })
  expect(steps.map((step) => step.args[0])).toEqual([
    'config/scripts/orca-fork/fetch-upstream-release-tags.mjs',
    'config/scripts/native-build/node-addons/ensure-native-runtime.mjs'
  ])
})
