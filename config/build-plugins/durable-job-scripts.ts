import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Plugin } from 'vite'

const DURABLE_JOB_SCRIPT_NAMES = [
  'durable-background-job.mjs',
  'durable-background-job-hook.mjs',
  'durable-background-job-plan.mjs'
] as const

/** Claude executes the hook and waiter as real node files, so they cannot live only inside the bundle. */
export function createDurableJobScriptPlugin(): Plugin {
  return {
    name: 'orca-durable-job-scripts',
    generateBundle() {
      for (const name of DURABLE_JOB_SCRIPT_NAMES) {
        this.emitFile({
          type: 'asset',
          fileName: `durable-jobs/${name}`,
          source: readFileSync(resolve('src/main/claude', name))
        })
      }
    }
  }
}
