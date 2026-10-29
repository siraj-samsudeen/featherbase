// Ordered migration runner. Files in ./migrations run once, in name order,
// each in its own transaction, recorded in `featherbase.migration`.
//
// The first file is the baseline: the whole platform schema and its seed rows
// (scripts/generate-baseline.ts). A fresh install is the only way in, so a
// database is either one this runner has migrated (it has the ledger and gets
// its pending files) or a new, empty one. A database with no ledger that
// already holds tables is refused before anything is written.
import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { format } from 'node:util'
import { _getUnqualifiedSql, sql, withTransaction } from './db'
import { processIO, type CommandIO } from './command-io'
import { invalidateMeta } from './meta'
import { assertDatabaseEnvironment, stampEnvironment } from './db-environment'

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

export const BASELINE = '0001_baseline.sql'

// The migration files on disk, in the order they apply.
function migrationFiles(): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql') || f.endsWith('.ts'))
    .sort()
}

// The "number" is everything before the first underscore, so `0004` and
// `0004a` would be distinct; only an exact repeat collides.
function migrationPrefix(file: string): string {
  const prefix = file.split('_', 1)[0]
  if (!/^\d/.test(prefix)) throw new Error(`migration file "${file}" has no numeric prefix`)
  return prefix
}

// migrations/ is numbered by hand, so nothing stops two files from claiming
// the same number (#149). Pure and DB-free so it's unit-testable: takes a
// directory listing, returns one message per colliding number.
export function findDuplicateMigrationPrefixes(files: string[]): string[] {
  const byPrefix = new Map<string, string[]>()
  for (const file of files) {
    const prefix = migrationPrefix(file)
    byPrefix.set(prefix, [...(byPrefix.get(prefix) ?? []), file])
  }
  return [...byPrefix].filter(([, group]) => group.length > 1)
    .map(([prefix, group]) => `migration number "${prefix}" is claimed by more than one file: ${group.join(', ')}`)
}

/** The migrator's guard: refuses a listing where two files claim one number. */
export function assertUniqueMigrationNumbers(files: string[]): void {
  const errors = findDuplicateMigrationPrefixes(files)
  if (errors.length > 0) throw new Error(`duplicate migration numbers:\n${errors.join('\n')}`)
}

/** The migrations this database records; none when it has no ledger. */
async function appliedMigrations(): Promise<Set<string>> {
  const [present] = await sql`select to_regclass('featherbase.migration') is not null as present`
  if (!present?.present) return new Set()
  return new Set((await sql`select name from migration`).map((r) => r.name as string))
}

/** Migrations on disk that this database has not had. Asks without acting,
 *  and refuses a database with no record of a migration that is not empty. */
export async function pendingMigrations(): Promise<string[]> {
  const files = migrationFiles()
  assertUniqueMigrationNumbers(files)
  const applied = await appliedMigrations()
  if (applied.size === 0) {
    // No record at all: only an empty database is new. The runner's own
    // ledger and environment stamp aside, and objects an extension owns.
    const [found] = await sql`
      select n.nspname || '.' || c.relname as relation from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname in ('featherbase', 'public') and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f')
        and (n.nspname, c.relname) not in (('featherbase', 'migration'), ('featherbase', 'internal_metadata'))
        and not exists (select 1 from pg_depend d where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype = 'e')
      limit 1`
    if (found)
      throw new Error(
        `Refusing to migrate: this database is not empty and has no Featherbase ledger (it holds ${String(found.relation)}); ` +
          'use a new database. Nothing was changed.',
      )
  }
  return files.filter((f) => !applied.has(f))
}

/** The platform schema and its ledger. */
export async function ensureLedger(): Promise<void> {
  await sql.unsafe('create schema if not exists featherbase')
  await sql.unsafe(`create table if not exists featherbase.migration (
    name text primary key,
    applied_at timestamptz not null default now()
  )`)
}

/** Apply one migration file and record it, inside the caller's transaction
 *  (the migrator's per-file one, or the rolled-back rehearsal of
 *  `cli migrate:rehearse`). A .sql file runs as written, its names resolved
 *  in the platform schema; a .ts file exports up() and uses the engine. */
export async function applyMigrationFile(file: string): Promise<void> {
  if (file.endsWith('.sql')) {
    const tx = _getUnqualifiedSql()
    await tx.unsafe('set local search_path = featherbase, pg_temp')
    await tx.unsafe(readFileSync(join(dir, file), 'utf8'))
  } else {
    const mod = await import(new URL(`../migrations/${file}`, import.meta.url).href)
    await mod.up()
  }
  await sql`insert into migration (name) values (${file})`
  // The next file validates against what this one left.
  invalidateMeta()
}

// Runs pending migrations, saying what it did on `out`. Does NOT close the DB
// connection — the caller owns its lifecycle (the CLI keeps it open for the
// rest of the command).
export async function runMigrations(out: (line: string) => void) {
  // Before writing anything: is this database ours to migrate? An unstamped
  // (brand-new) database passes and is claimed below; one belonging to
  // another environment stops the run here, before any DDL.
  await assertDatabaseEnvironment()
  const pending = await pendingMigrations()
  await ensureLedger()
  for (const file of pending) {
    await withTransaction(() => applyMigrationFile(file))
    out(`applied ${file}`)
  }
  // Claim (or re-affirm) the database for this environment.
  await stampEnvironment()
  out(`migrations up to date (${migrationFiles().length} total)`)
}

/** `tsx src/migrate.ts`: resolves to the process's exit code. The caller owns
 *  the database connection: the entry point below ends it. */
export async function main(_argv: string[] = [], io: CommandIO = processIO): Promise<number> {
  try {
    await runMigrations((line) => io.out(line))
    return 0
  } catch (err) {
    io.err(format(err))
    return 1
  }
}

// Run standalone (`tsx src/migrate.ts`) — but not when imported (e.g. by the
// CLI), so importing this module never triggers a migration as a side effect.
/* v8 ignore next 6 -- entry-point guard; proven by the subprocess tests in test/admin-bootstrap.test.ts and test/release-preflight.test.ts */
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const code = await main(process.argv.slice(2))
  await sql.end().catch(() => {})
  process.exitCode = code
  if (code !== 0) process.exit(code)
}
