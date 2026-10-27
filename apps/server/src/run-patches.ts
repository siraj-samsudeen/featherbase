// PLAT-003 CLI: apply all recorded patches once, in order. Runs after
// `migrate` in init.sh. A failing patch aborts with a non-zero exit and is not
// recorded, so the next run retries it.
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { format } from 'node:util'
import { sql } from './db'
import { processIO, type CommandIO } from './command-io'
import { runPatches } from './patches'
import { patches } from '../patches/index'

/** Resolves to the process's exit code. The caller owns the database
 *  connection: the entry point below ends it. */
export async function main(_argv: string[] = [], io: CommandIO = processIO): Promise<number> {
  try {
    const newly = await runPatches(patches)
    for (const n of newly) io.out(`applied patch ${n}`)
    io.out(`patches up to date (${patches.length} total)`)
    return 0
  } catch (err) {
    io.err(format('patch failed — aborting:', err instanceof Error ? err.message : err))
    return 1
  }
}

// Run as a process (`tsx src/run-patches.ts`), not when imported by a test.
/* v8 ignore next 6 -- entry-point guard; proven by the subprocess test in test/patches.test.ts */
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const code = await main(process.argv.slice(2))
  await sql.end().catch(() => {})
  process.exitCode = code
  if (code !== 0) process.exit(code)
}
