// PLAT-003 CLI: apply all recorded patches once, in order. Runs after
// `migrate` in init.sh. A failing patch aborts with a non-zero exit and is not
// recorded, so the next run retries it.
import { sql } from './db'
import { runPatches } from './patches'
import { patches } from '../patches/index'

runPatches(patches)
  .then(async (newly) => {
    if (newly.length) for (const n of newly) console.log(`applied patch ${n}`)
    console.log(`patches up to date (${patches.length} total)`)
    await sql.end()
  })
  .catch(async (err) => {
    console.error('patch failed — aborting:', err instanceof Error ? err.message : err)
    await sql.end()
    process.exit(1)
  })
