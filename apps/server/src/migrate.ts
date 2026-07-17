// Minimal ordered-SQL migration runner. Files in ./migrations run once, in
// name order, recorded in the `migration` table. One-off recorded patches are
// a separate system (PLAT-003, src/patches.ts).
import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { sql } from './db'

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

// Runs pending migrations. Does NOT close the DB connection — the caller owns
// its lifecycle (the CLI keeps it open for the rest of the command).
export async function runMigrations() {
  await sql`create table if not exists migration (
    name text primary key,
    applied_at timestamptz not null default now()
  )`
  const applied = new Set(
    (await sql`select name from migration`).map((r) => r.name as string),
  )
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql') || f.endsWith('.ts'))
    .sort()
  for (const file of files) {
    if (applied.has(file)) continue
    if (file.endsWith('.sql')) {
      const body = readFileSync(join(dir, file), 'utf8')
      await sql.begin(async (tx) => {
        await tx.unsafe(body)
        await tx`insert into migration (name) values (${file})`
      })
    } else {
      // .ts migrations export up(); they use the engine itself (createDocType,
      // saveDoc) so seed DocTypes get real DDL instead of duplicated SQL.
      const mod = await import(new URL(`../migrations/${file}`, import.meta.url).href)
      await mod.up()
      await sql`insert into migration (name) values (${file})`
    }
    console.log(`applied ${file}`)
  }
  console.log(`migrations up to date (${files.length} total)`)
}

// Run standalone (`tsx src/migrate.ts`) — but not when imported (e.g. by the
// CLI), so importing this module never triggers a migration as a side effect.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runMigrations()
    .then(() => sql.end())
    .catch(async (err) => {
      console.error(err)
      await sql.end().catch(() => {})
      process.exit(1)
    })
}
