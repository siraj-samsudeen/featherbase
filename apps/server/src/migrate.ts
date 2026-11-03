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
    // No record at all: only an empty database is new. Runs before anything
    // is written, the ledger included (runMigrations, rehearse).
    const found = await firstForeignObject()
    if (found)
      throw new Error(
        `Refusing to migrate: this database is not empty and has no Featherbase ledger (it holds ${found}); ` +
          'use a new database. Nothing was changed.',
      )
  }
  return files.filter((f) => !applied.has(f))
}

/** The first object in a user schema, named, that makes this database not
 *  empty: a schema other than public, a table, view or sequence, a function
 *  or procedure, or a type (enum, domain, range, composite). System schemas,
 *  objects an extension owns, and the runner's own ledger and environment
 *  stamp (left by a run that failed before its first migration) do not
 *  count. Null when there is none. */
async function firstForeignObject(): Promise<string | null> {
  const [row] = await sql`
    with user_schema as (
      select oid, nspname from pg_namespace
      where nspname not in ('pg_catalog', 'information_schema')
        and left(nspname, 8) <> 'pg_toast' and left(nspname, 7) <> 'pg_temp'
    ),
    extension_owned as (select classid, objid from pg_depend where deptype = 'e')
    select 'schema ' || quote_ident(n.nspname) as object, 1 as rank from user_schema n
      where n.nspname not in ('public', 'featherbase')
        and not exists (select 1 from extension_owned e where e.classid = 'pg_namespace'::regclass and e.objid = n.oid)
    union all
    select case c.relkind when 'S' then 'sequence ' when 'v' then 'view ' when 'm' then 'view ' else 'table ' end
        || quote_ident(n.nspname) || '.' || quote_ident(c.relname), 2
      from pg_class c join user_schema n on n.oid = c.relnamespace
      where c.relkind in ('r', 'p', 'v', 'm', 'S', 'f')
        and (n.nspname, c.relname) not in (('featherbase', 'migration'), ('featherbase', 'internal_metadata'))
        and not exists (select 1 from extension_owned e where e.classid = 'pg_class'::regclass and e.objid = c.oid)
    union all
    select case p.prokind when 'p' then 'procedure ' else 'function ' end
        || quote_ident(n.nspname) || '.' || quote_ident(p.proname), 3
      from pg_proc p join user_schema n on n.oid = p.pronamespace
      where not exists (select 1 from extension_owned e where e.classid = 'pg_proc'::regclass and e.objid = p.oid)
    union all
    select 'type ' || quote_ident(n.nspname) || '.' || quote_ident(t.typname), 4
      from pg_type t join user_schema n on n.oid = t.typnamespace
      -- A table's own row type and every array type come with something
      -- already counted; a standalone composite type has a 'c' relation.
      where (t.typrelid = 0 or exists (select 1 from pg_class c where c.oid = t.typrelid and c.relkind = 'c'))
        and not exists (select 1 from pg_type a where a.typarray = t.oid)
        and not exists (select 1 from extension_owned e where e.classid = 'pg_type'::regclass and e.objid = t.oid)
    order by rank, object
    limit 1`
  return row ? String(row.object) : null
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
