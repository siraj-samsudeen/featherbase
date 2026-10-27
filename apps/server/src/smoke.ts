// Asserts the RUNNING server is healthy. Does not boot anything itself.
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { processIO, type CommandIO } from './command-io'
import { readVariable } from './env'

/** Resolves to the process's exit code: 0 when the server at SERVER_URL
 *  answers its ping with a working database. */
export async function main(_argv: string[] = [], io: CommandIO = processIO): Promise<number> {
  const base = readVariable('SERVER_URL') ?? 'http://localhost:8000'
  const res = await fetch(`${base}/api/ping`)
  if (!res.ok) {
    io.err(`smoke: /api/ping returned ${res.status}`)
    return 1
  }
  const body = (await res.json()) as { message?: string; db?: boolean }
  if (body.message !== 'pong' || body.db !== true) {
    io.err(`smoke: unexpected ping body ${JSON.stringify(body)}`)
    return 1
  }
  io.out('server smoke OK')
  return 0
}

// Run as a process (`tsx src/smoke.ts`), not when imported by a test.
/* v8 ignore next 4 -- entry-point guard; proven by the subprocess test in test/smoke.test.ts */
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const code = await main(process.argv.slice(2))
  if (code !== 0) process.exit(code)
}
