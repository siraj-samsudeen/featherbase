// Minimal ordered-SQL migration runner. Files in ./migrations run once, in
// name order, recorded in the `migration` table. One-off recorded patches are
// a separate system (PLAT-003, src/patches.ts).
import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { sql } from './db'
import { invalidateMeta } from './meta'

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

// migrations/ is numbered by hand — nothing stops two files from claiming the
// same number. Both apply silently (whichever sorts first "wins" the slot,
// the other becomes a duplicate under a number nobody actually chose).
// Pre-existing collisions found in the repo on 2026-08-11 (issue #149) — both
// pairs are additive on disjoint tables, already applied in real checkouts,
// and must NOT be renumbered. Do not add to this list without the same
// scrutiny; any new collision is a bug and must fail the guard below.
const GRANDFATHERED_DUPLICATE_PREFIXES: readonly (readonly string[])[] = [
  ['0064_data_sources.ts', '0064_user_event.ts'],
  ['0069_access_tokens.sql', '0069_import_upsert_log.ts'],
]

// The "number" is everything before the first underscore, so `0010` and
// `0010a` (a deliberate same-batch sub-ordering — see
// 0010a_rename_rls_role.sql) are distinct; only an exact repeat collides.
function migrationPrefix(file: string): string {
  const prefix = file.split('_', 1)[0]
  if (!/^\d/.test(prefix)) throw new Error(`migration file "${file}" has no numeric prefix`)
  return prefix
}

// Pure and DB-free so it's unit-testable: takes a directory listing, returns
// one message per colliding number (empty when every number is unique).
export function findDuplicateMigrationPrefixes(files: string[]): string[] {
  const byPrefix = new Map<string, string[]>()
  for (const file of files) {
    const prefix = migrationPrefix(file)
    byPrefix.set(prefix, [...(byPrefix.get(prefix) ?? []), file])
  }
  const errors: string[] = []
  for (const [prefix, group] of byPrefix) {
    if (group.length < 2) continue
    const sorted = [...group].sort()
    const isGrandfathered = GRANDFATHERED_DUPLICATE_PREFIXES.some(
      (pair) => pair.length === sorted.length && pair.every((f, i) => f === sorted[i]),
    )
    if (isGrandfathered) continue
    errors.push(`migration number "${prefix}" is claimed by more than one file: ${group.join(', ')}`)
  }
  return errors
}

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
  const duplicatePrefixErrors = findDuplicateMigrationPrefixes(files)
  if (duplicatePrefixErrors.length > 0) {
    throw new Error(`duplicate migration numbers:\n${duplicatePrefixErrors.join('\n')}`)
  }
  for (const file of files) {
    if (applied.has(file)) continue
    if (file.endsWith('.sql')) {
      const body = readFileSync(join(dir, file), 'utf8')
      await sql.begin(async (tx) => {
        await tx.unsafe(body)
        await tx`insert into migration (name) values (${file})`
      })
    } else {
      // .ts migrations export up(); they use the engine itself (createTable,
      // saveDoc) so seed Tables get real DDL instead of duplicated SQL.
      const mod = await import(new URL(`../migrations/${file}`, import.meta.url).href)
      await mod.up()
      await sql`insert into migration (name) values (${file})`
    }
    // Migrations may alter Table metadata with raw SQL (e.g. 0046 adds
    // Workflow Transition.condition); drop the per-process meta cache so the
    // NEXT migration validates against what is actually in the database. A
    // fresh-database run otherwise crashes at the first save that uses a
    // column added this way — caught by CI's first-ever run.
    invalidateMeta()
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
