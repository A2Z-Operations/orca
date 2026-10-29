#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createJobRequest, planBackgroundBashRewrite } from './durable-background-job.mjs'

let event
try {
  event = JSON.parse(readFileSync(0, 'utf8') || '{}')
} catch {
  process.exit(0)
}

const plan = planBackgroundBashRewrite({
  toolName: event.tool_name,
  toolInput: event.tool_input,
  runnerPath: join(import.meta.dirname, 'durable-background-job.mjs'),
  nodePath: process.execPath,
  sessionId: typeof event.session_id === 'string' ? event.session_id : undefined,
  cwd: typeof event.cwd === 'string' ? event.cwd : undefined
})

if (!plan) {
  process.exit(0)
}

try {
  createJobRequest(plan.request)
} catch (error) {
  process.stderr.write(
    `orca-durable-job: ${error instanceof Error ? error.message : String(error)}\n`
  )
  process.exit(0)
}

process.stdout.write(`${JSON.stringify(plan.response)}\n`)
