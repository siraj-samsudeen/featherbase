import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
// Use the host suite's Vitest instance, not Tasker's independent npm version.
import { afterAll } from '../../../apps/server/node_modules/vitest/dist/index.js'

afterAll(() => {
  const coverage = (globalThis as { __coverage__?: Record<string, unknown> }).__coverage__
  if (!coverage || !Object.keys(coverage).some((file) => file.endsWith('/tasker/src/server.ts')))
    throw new Error('Build Tasker with VITE_COVERAGE=true before collecting its integration coverage')
  const directory = fileURLToPath(new URL('../../../coverage/tasker/integration/', import.meta.url))
  mkdirSync(directory, { recursive: true })
  writeFileSync(`${directory}${randomUUID()}.json`, JSON.stringify(coverage))
})
