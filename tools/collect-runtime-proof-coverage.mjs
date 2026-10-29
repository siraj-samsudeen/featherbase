// Proof-only preload: never included in an app artifact or production startup.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const directory = process.env.RUNTIME_PROOF_COVERAGE_DIRECTORY
if (!directory) throw new Error('Runtime proof coverage preload needs an output directory')
let flushed = false
function flush() {
  if (flushed) return
  const map = Object.fromEntries(Object.entries(globalThis.__coverage__ ?? {})
    .filter(([file]) => file.includes('/runtime-apps/tasker/')))
  if (Object.keys(map).length) {
    mkdirSync(directory, { recursive: true })
    writeFileSync(join(directory, `server-${randomUUID()}.json`), JSON.stringify(map))
  }
  flushed = true
}
process.once('exit', flush)
process.once('SIGTERM', () => {
  flush()
  // Preserve the child's normal signal exit after synchronous output finishes.
  process.kill(process.pid, 'SIGTERM')
})
