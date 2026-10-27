// #307: the deploy's one pre-deploy command (`pnpm --filter server
// pre-deploy`, railway.json): the release, then the preview seed. A host may
// run each pre-deploy entry as argv rather than through a shell, so the two
// steps are chained here, not with `&&` in the deploy config — where the
// second was observed never to run while the deploy still went green.
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { format } from 'node:util'
import { sql } from './db'
import { processIO, type CommandIO } from './command-io'
import { main as release } from './release'
import { seedPreview } from './preview-seed'

/** The release, then the preview seed; resolves to the process's exit code,
 *  1 when either stopped. The caller owns the database connection. */
export async function main(argv: string[] = [], io: CommandIO = processIO): Promise<number> {
  const code = await release(argv, io)
  if (code !== 0) return code
  try {
    // The same per-Table controllers the server registers at start, so the
    // preview person is saved through the full Person save chain (#534).
    const { loadControllers } = await import('./controllers')
    await loadControllers()
    await seedPreview(io)
    return 0
  } catch (err) {
    io.err(format('preview seed failed:', err instanceof Error ? err.message : err))
    return 1
  }
}

// Run as a process (`tsx src/pre-deploy.ts`), not when imported by a test.
/* v8 ignore next 6 -- entry-point guard; proven by the subprocess test in test/pre-deploy.test.ts */
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const code = await main(process.argv.slice(2))
  await sql.end().catch(() => {})
  process.exitCode = code
  if (code !== 0) process.exit(code)
}
