// Minimal ordered-SQL migration runner. Files in ./migrations run once, in
// name order, recorded in the `migration` table. Full patch-runner semantics
// are feature PLAT-003 and will extend this.
import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sql } from './db'

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

async function migrate() {
  await sql`create table if not exists migration (
    name text primary key,
    applied_at timestamptz not null default now()
  )`
  const applied = new Set(
    (await sql`select name from migration`).map((r) => r.name as string),
  )
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
  for (const file of files) {
    if (applied.has(file)) continue
    const body = readFileSync(join(dir, file), 'utf8')
    await sql.begin(async (tx) => {
      await tx.unsafe(body)
      await tx`insert into migration (name) values (${file})`
    })
    console.log(`applied ${file}`)
  }
  console.log(`migrations up to date (${files.length} total)`)
  await sql.end()
}

migrate().catch((err) => {
  console.error(err)
  process.exit(1)
})
