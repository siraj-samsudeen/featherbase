// Ordered migration runner. Files in ./migrations run once, in name order,
// each in its own transaction, recorded in `featherbase.migration`.
//
// The first file is a baseline (#692): 0140_baseline.sql builds what the
// migrations listed in migrations/baseline-replaces.txt built. So a database
// is one of three kinds, told apart before anything is written:
//   empty                      the baseline and every later file run;
//   has every replaced one     (installed before the baseline) the baseline,
//                              and the steps after it that redo what the
//                              replaced migrations did, are recorded without
//                              running; the rest run;
//   anything else              refused: it is upgraded first with the last
//                              release before the baseline.
import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { format } from 'node:util'
import { _getUnqualifiedSql, sql, withTransaction } from './db'
import { processIO, type CommandIO } from './command-io'
import { invalidateMeta } from './meta'
import { assertDatabaseEnvironment, stampEnvironment } from './db-environment'

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

export const BASELINE = '0140_baseline.sql'

/** The baseline and the steps after it that a database installed before the
 *  baseline has already had: 0141 sets the first Administrator's password
 *  (0006 did), 0142 enables Google sign-in for the mock provider (0100 did). */
export const ADOPTED_WITH_BASELINE: readonly string[] = [BASELINE, '0141_administrator_password.ts', '0142_mock_google_sign_in.ts']

/** The last platform release that can upgrade a database the baseline cannot
 *  adopt: main just before #692. */
export const LAST_RELEASE_BEFORE_BASELINE = 'e562331d'

/** Relations only a pre-0094 platform database has in public: 0094's move
 *  set, the registry it left behind, and the pre-0055 names. */
const LEGACY_PUBLIC_RELATIONS = [
  'site', 'table_def', 'column_def', 'tab_doctype', 'tab_docfield', 'access_token', 'installed_app',
  'internal_metadata', 'password_reset', 'patch_log', 'pre_auth_bucket', 'single_value', 'tag_link', 'user_settings',
]

// The migration files on disk, in the order they apply.
function migrationFiles(): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql') || f.endsWith('.ts'))
    .sort()
}

/** The migrations the baseline replaces (migrations/baseline-replaces.txt). */
export function replacedByBaseline(): string[] {
  return readFileSync(join(dir, 'baseline-replaces.txt'), 'utf8')
    .split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
}

// The "number" is everything before the first underscore, so `0142` and
// `0142a` would be distinct; only an exact repeat collides.
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

function upgradeFirst(reason: string): Error {
  return new Error(
    `Refusing to migrate: ${reason} This release starts from a baseline and can only adopt a database that has every ` +
      `migration the baseline replaces. Upgrade this database first with the last platform release before the baseline ` +
      `(commit ${LAST_RELEASE_BEFORE_BASELINE}), then run this release again. Nothing was changed.`,
  )
}

/** The migrations this database records. Refuses the legacy ledger. */
async function appliedMigrations(): Promise<Set<string>> {
  const [present] = await sql`
    select to_regclass('public.migration') as legacy, to_regclass('featherbase.migration') as current`
  if (present?.legacy)
    throw upgradeFirst('this database records its migrations in public.migration, from before 0094 moved the platform into its own schema.')
  if (!present?.current) return new Set()
  return new Set((await sql`select name from migration`).map((r) => r.name as string))
}

/** What a run would do here, decided before anything changes: the files to
 *  record without running (adopting the baseline) and the files to apply. */
export async function planMigrations(): Promise<{ adopt: string[]; pending: string[] }> {
  const files = migrationFiles()
  assertUniqueMigrationNumbers(files)
  const applied = await appliedMigrations()
  const notApplied = (f: string) => !applied.has(f)
  if (applied.has(BASELINE)) return { adopt: [], pending: files.filter(notApplied) }
  const replaced = replacedByBaseline()
  if (applied.size === 0) {
    // No record at all: only a database with nothing of the platform's in it
    // is new (the runner's own ledger and environment stamp aside). Anything
    // else lost its ledger, and the baseline would collide with it.
    const [found] = await sql`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'featherbase' and c.relname not in ('migration', 'internal_metadata')
        and c.relkind in ('r', 'p', 'v', 'm', 'S')
      union all
      -- Before 0094 the platform lived in public: these names are its.
      select 'public.' || c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname in ${sql(LEGACY_PUBLIC_RELATIONS)}
      limit 1`
    if (found) throw upgradeFirst(`this database holds platform tables (${String(found.relname)}) but records no migration.`)
    return { adopt: [], pending: files }
  }
  const missing = replaced.filter(notApplied)
  if (missing.length)
    throw upgradeFirst(
      `this database has ${replaced.length - missing.length} of the ${replaced.length} migrations the baseline replaces; ` +
        `it lacks ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ` and ${missing.length - 5} more` : ''}.`,
    )
  const adopt = ADOPTED_WITH_BASELINE.filter(notApplied)
  return { adopt, pending: files.filter((f) => notApplied(f) && !adopt.includes(f)) }
}

/** Migrations on disk that this database has not had, adopted ones aside.
 *  Asks without acting, and refuses a database this release cannot migrate. */
export async function pendingMigrations(): Promise<string[]> {
  return (await planMigrations()).pending
}

/** The platform schema and its ledger. */
export async function ensureLedger(): Promise<void> {
  await sql.unsafe('create schema if not exists featherbase')
  await sql.unsafe(`create table if not exists featherbase.migration (
    name text primary key,
    applied_at timestamptz not null default now()
  )`)
}

/** Record the baseline (and the steps it stands for) without running it, on a
 *  database that has every migration it replaces. */
export async function adoptBaseline(files: readonly string[]): Promise<void> {
  for (const file of files) await sql`insert into migration (name) values (${file})`
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
  const { adopt, pending } = await planMigrations()
  await ensureLedger()
  if (adopt.length) {
    await withTransaction(() => adoptBaseline(adopt))
    out(`adopted the baseline: recorded ${adopt.join(', ')} without running them (this database has every migration the baseline replaces)`)
  }
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
