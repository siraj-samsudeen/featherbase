// Minimal ordered-SQL migration runner. Files in ./migrations run once, in
// name order, recorded in the `migration` table. One-off recorded patches are
// a separate system (PLAT-003, src/patches.ts).
import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { format } from 'node:util'
import { _getUnqualifiedSql, sql, withTransaction } from './db'
import { processIO, type CommandIO } from './command-io'
import { invalidateMeta } from './meta'
import { assertDatabaseEnvironment, stampEnvironment } from './db-environment'
import { bootstrapAdministrator } from './admin-bootstrap'

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

// The migration files on disk, in the order they apply.
function migrationFiles(): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql') || f.endsWith('.ts'))
    .sort()
}

/**
 * Migrations present on disk but not recorded in this database.
 *
 * Separated from running them so a caller can ASK without acting — the check
 * that turns "a wall of confusing failures" into one sentence naming the
 * files. Rails calls the equivalent `needs_migration?`; Prisma exposes it as
 * `migrate status` exiting non-zero.
 */
export async function pendingMigrations(): Promise<string[]> {
  const { applied } = await readLedger()
  return migrationFiles().filter((f) => !applied.has(f))
}

/** Where this database records its migrations, and what it has recorded. The
 *  ledger is `public.migration` on a legacy database (before 0094 moved the
 *  platform into its own schema), `featherbase.migration` after. */
async function readLedger(): Promise<{ legacy: boolean; applied: Set<string> }> {
  const [present] = await sql`
    select to_regclass('public.migration') as legacy,
      to_regclass('featherbase.migration') as current`
  if (present?.legacy && present?.current)
    throw new Error('Refusing to run: both public and featherbase migration ledgers exist')
  const relation = present?.current ? 'featherbase.migration' : present?.legacy ? 'public.migration' : null
  const applied = new Set(relation ? (await sql.unsafe(`select name from ${relation}`)).map((r) => r.name as string) : [])
  return { legacy: Boolean(present?.legacy), applied }
}

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

// The "number" is everything before the first underscore, so `0101` and
// `0101a` (a deliberate same-batch sub-ordering — see
// 0101a_service_account_name_unique.sql) are distinct; only an exact repeat
// collides.
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

/** The migrator's guard: refuses a listing where two files claim one number. */
export function assertUniqueMigrationNumbers(files: string[]): void {
  const errors = findDuplicateMigrationPrefixes(files)
  if (errors.length > 0) throw new Error(`duplicate migration numbers:\n${errors.join('\n')}`)
}

/** Migrations that apply as ONE transaction (person-resolution review A-M1):
 *  the person release is all-or-nothing, so a failure in 0102 cannot leave
 *  0100's identities or 0101's re-id committed without it (#399: prod is at
 *  0099, so 0100 is part of the release). Members must be adjacent in name order. */
export const ONE_TRANSACTION: readonly (readonly string[])[] = [
  ['0100_person_identities.ts', '0101_person_rename.ts', '0101a_service_account_name_unique.sql', '0102_person_resolution.ts'],
]

/** The pending files, batched: each alone, except the pending members of a
 *  ONE_TRANSACTION group, which share one batch. Pure, for the unit test. */
export function migrationBatches(pending: string[]): string[][] {
  const batches: string[][] = []
  let open: readonly string[] | null = null
  for (const file of pending) {
    const group = ONE_TRANSACTION.find((g) => g.includes(file)) ?? null
    if (group && group === open) batches[batches.length - 1].push(file)
    else batches.push([file])
    open = group
  }
  return batches
}

/** Apply one migration file and record it, inside the caller's transaction
 *  (the migrator's per-file transaction, or the rolled-back rehearsal of
 *  `cli migrate:rehearse`). */
export async function applyMigrationFile(file: string): Promise<void> {
  await sql.unsafe(`set local search_path = ${file === '0045_site_registry.ts' ? 'public' : 'featherbase'}, pg_temp`)
  if (file.endsWith('.sql')) {
    let body = readFileSync(join(dir, file), 'utf8')
    if (file === '0010_rls.sql' || file === '0055_terminology_rename.sql') {
      body = body
        .replaceAll('set search_path = public', 'set search_path = pg_catalog')
        .replaceAll('fc_session_user()', 'featherbase.fc_session_user()')
        .replaceAll('from permission p', 'from featherbase.permission p')
        .replaceAll('join has_role hr', 'join featherbase.has_role hr')
    }
    await sql.unsafe(body)
  } else {
    // .ts migrations export up(); they use the engine itself (createTable,
    // saveDoc) so seed Tables get real DDL instead of duplicated SQL.
    // #130 security supersession: retain the shipped migration as history,
    // but never execute its known-password production fallback on a fresh DB.
    if (file === '0006_admin_password.ts') await bootstrapAdministrator()
    else {
      const mod = await import(new URL(`../migrations/${file}`, import.meta.url).href)
      await mod.up()
    }
  }
  const [after] = await sql`
    select to_regclass('public.migration') as legacy,
      to_regclass('featherbase.migration') as current`
  if (Boolean(after.legacy) === Boolean(after.current))
    throw new Error('Migration must leave exactly one platform migration ledger')
  const target = after.current ? 'featherbase.migration' : 'public.migration'
  await sql.unsafe(`insert into ${target} (name) values ($1)`, [file])
  invalidateMeta()
}

/** What a release would apply here, checked before anything changes: the
 *  pending files in batches, and whether the ledger is still the legacy one. */
export async function planMigrations(): Promise<{ legacy: boolean; batches: string[][] }> {
  const { legacy, applied } = await readLedger()
  const files = migrationFiles()
  assertUniqueMigrationNumbers(files)
  // Earlier TS migrations invoke today's qualified engine, not the historical
  // one. Reject unsupported ledgers before creating any destination storage.
  if (legacy) {
    const missing = files.filter((file) => file < '0088_runtime_storage.sql' && !applied.has(file))
    if (missing.length) throw new Error(
      `Legacy database requires an intermediate historical upgrade through 0087; missing migrations:\n${missing.join('\n')}`,
    )
  }
  return { legacy, batches: migrationBatches(files.filter((f) => !applied.has(f))) }
}

/** The platform schema, and on a database that is not legacy its ledger. */
export async function ensureLedger(legacy: boolean): Promise<void> {
  await sql.unsafe('create schema if not exists featherbase')
  if (!legacy) await sql.unsafe(`create table if not exists featherbase.migration (
    name text primary key,
    applied_at timestamptz not null default now()
  )`)
}

/** Apply one batch from `planMigrations` and record it, inside the caller's
 *  transaction: the migrator's per-batch one, or the rolled-back rehearsal of
 *  `cli migrate:rehearse`, so both apply a file the same way. `applied` hears
 *  of each member as it is recorded. */
export async function applyBatch(batch: string[], legacy: boolean, applied: (file: string) => void = () => {}): Promise<void> {
  const [file] = batch
  // 0088–0093 require public storage; 0094 needs their columns and prototype
  // conversion before it can move that storage. Never rewrite shipped SQL.
  if (legacy && file < '0094_featherbase_schema.sql') {
    const tx = _getUnqualifiedSql()
    await tx.unsafe('set local search_path = public, pg_temp')
    await tx.unsafe(readFileSync(join(dir, file), 'utf8'))
    await tx`insert into public.migration (name) values (${file})`
    applied(file)
    return
  }
  for (const member of batch) {
    await applyMigrationFile(member)
    // Each member validates against the metadata the previous one left.
    invalidateMeta()
    applied(member)
  }
}

// Runs pending migrations. Does NOT close the DB connection — the caller owns
// its lifecycle (the CLI keeps it open for the rest of the command).
export async function runMigrations() {
  // Before writing anything: is this database ours to migrate? An unstamped
  // (brand-new) database passes and is claimed below; one belonging to
  // another environment stops the run here, before any DDL.
  await assertDatabaseEnvironment()
  const { legacy, batches } = await planMigrations()
  await ensureLedger(legacy)
  for (const batch of batches) {
    await withTransaction(() => applyBatch(batch, legacy))
    // Migrations may alter Table metadata with raw SQL (e.g. 0046 adds
    // Workflow Transition.condition); drop the per-process meta cache so the
    // NEXT migration validates against what is actually in the database. A
    // fresh-database run otherwise crashes at the first save that uses a
    // column added this way — caught by CI's first-ever run.
    invalidateMeta()
    for (const member of batch) console.log(`applied ${member}${batch.length > 1 ? ` (one transaction: ${batch.join(', ')})` : ''}`)
  }
  // Claim (or re-affirm) the database for this environment. Re-stamping every
  // run keeps databases created before 0081 correct too.
  await stampEnvironment()
  console.log(`migrations up to date (${migrationFiles().length} total)`)
}

/** `tsx src/migrate.ts`: resolves to the process's exit code. The caller owns
 *  the database connection: the entry point below ends it. */
export async function main(_argv: string[] = [], io: CommandIO = processIO): Promise<number> {
  try {
    await runMigrations()
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
