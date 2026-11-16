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
    'config/scripts/orca-fork/install-relay-test-dependencies.mjs',
    'config/scripts/native-build/node-addons/ensure-native-runtime.mjs'
  ])
})

// Fork (#48 slice 12): the relay integration tests import the cloud/ workspace, which only CI's relay job installs.
it('the unit step installs the relay test dependencies when they are missing', () => {
  expect(unitTestPrelude('node')[1]).toEqual({
    program: 'node',
    args: ['config/scripts/orca-fork/install-relay-test-dependencies.mjs', '--if-missing']
  })
})
