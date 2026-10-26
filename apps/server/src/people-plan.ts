// `cli people:plan` (person-rename R6, person-resolution D5): rehearse the
// person migrations — every pending migration, 0100/0101/0102 included —
// inside ONE transaction that is always rolled back, and print what they did:
// the id map, every text column with its classification, the post-check
// scan, and 0102's identifier backfill with its test-mode parity. Nothing is
// committed.
//
//   people:plan [--map] [--columns] [--check-sign-in <code>...]
//   people:plan --rehearse <dsn> [...]      the same against another database
//
// Run as its own process so DATABASE_URL can point at the rehearsal target
// before the connection pool is created.
import { sql, withTransaction } from './db'
import { assertDatabaseEnvironment } from './db-environment'
import { applyMigrationFile, pendingMigrations } from './migrate'
import { invalidateMeta } from './meta'
import { formatPersonRenameReport, migratePersonRename } from './person-rename-migration'
import { formatResolutionPlan, migratePersonResolution } from './person-resolution-migration'
import { classifyColumns, formatClassification, scanForOldIds, stageRewriteMap, type IdMapEntry } from './person-registry'

export interface PlanOptions {
  map: boolean
  columns: boolean
  checkSignIn: string[]
}

/** Where the rehearsal's report goes: the terminal, or a test's buffer. */
export type PlanOutput = (line: string) => void

const ROLLBACK = new Error('people:plan rollback')

async function runFile(file: string, opts: PlanOptions, out: PlanOutput) {
  if (file === '0101_person_rename.ts') {
    await sql.begin(async () => {
      await sql.unsafe('set local search_path = featherbase, pg_temp')
      const report = await migratePersonRename()
      out(formatPersonRenameReport(report, { map: opts.map, columns: opts.columns }))
      await sql`insert into featherbase.migration (name) values (${file})`
    })
    invalidateMeta()
    return
  }
  if (file === '0102_person_resolution.ts') {
    await sql.begin(async () => {
      await sql.unsafe('set local search_path = featherbase, pg_temp')
      out(formatResolutionPlan(await migratePersonResolution()))
      await sql`insert into featherbase.migration (name) values (${file})`
    })
    invalidateMeta()
    return
  }
  await sql.begin(() => applyMigrationFile(file))
  out(`applied ${file}`)
}

/** On a database the re-id has already run on: classify again and scan the
 *  recorded map, so a regression (an old id written back) is visible. */
async function rescan(opts: PlanOptions, out: PlanOutput) {
  const classification = await classifyColumns()
  // 0101 created person_id_map, and this runs only once 0101 is applied.
  const map = (await sql`select old_id, new_id, kind from person_id_map`) as unknown as IdMapEntry[]
  await stageRewriteMap(sql, map)
  const hits = await scanForOldIds(sql, classification.classified)
  out(`person_id_map: ${map.length} entries`)
  out(`scan: ${hits.length ? hits.map((h) => `${h.column} ${h.rows}`).join('; ') : 'no old id in any registered column'}`)
  out(`text columns: ${classification.classified.length} classified, ${classification.unclassified.length} unclassified`)
  if (classification.unclassified.length || opts.columns) out(formatClassification(classification))
}

async function checkSignIns(codes: string[], out: PlanOutput) {
  if (!codes.length) return
  const { TEST_MODE_PHRASE, delegatedMethods, linkedUser } = await import('./delegated-login')
  const { assertEligible } = await import('./sign-in')
  const { withVariable } = await import('./env')
  await withVariable('DELEGATED_LOGIN_TEST_MODE', TEST_MODE_PHRASE, async () => {
    const methods = await delegatedMethods()
    for (const code of codes) {
      for (const cfg of methods) {
        const m = cfg
        try {
          const found = await linkedUser(cfg, code)
          await assertEligible(cfg.method, found.user)
          out(`test-mode sign-in by code ${code} via ${m.key}: OK → ${found.user}`)
        } catch (err) {
          out(`test-mode sign-in by code ${code} via ${m.key}: REFUSED (${(err as Error).message})`)
        }
      }
    }
  })
}

/** The rehearsal: one transaction, always rolled back. Every query in it,
 *  the migrations' own included, runs on that transaction (`withTransaction`
 *  scopes the platform's `sql` to it). */
export async function rehearse(opts: PlanOptions, out: PlanOutput = console.log): Promise<void> {
  await assertDatabaseEnvironment()
  const pending = await pendingMigrations()
  out(`people:plan — rehearsal in a rolled-back transaction; pending: ${pending.length ? pending.join(', ') : 'none'}`)
  try {
    await withTransaction(async () => {
      try {
        for (const file of pending) await runFile(file, opts, out)
        if (!pending.includes('0101_person_rename.ts')) await rescan(opts, out)
        await checkSignIns(opts.checkSignIn, out)
      } finally {
        invalidateMeta()
      }
      throw ROLLBACK
    })
  } catch (err) {
    if (err !== ROLLBACK) throw err
  }
  out('people:plan — rolled back; nothing was changed')
}

export function parsePlanOptions(argv: string[]): PlanOptions & { rehearse: string | null } {
  const opts: PlanOptions & { rehearse: string | null } = { map: false, columns: false, checkSignIn: [], rehearse: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--map') opts.map = true
    else if (a === '--columns') opts.columns = true
    else if (a === '--resolve') throw new Error('people:plan: --resolve is gone — 0102 reads no file; run `cli people:resolve <csv>` after the deploy')
    else if (a === '--rehearse') opts.rehearse = argv[++i] ?? null
    else if (a === '--check-sign-in') opts.checkSignIn.push(argv[++i] ?? '')
    else throw new Error(`people:plan: unknown argument ${a}`)
  }
  if (opts.rehearse === '') throw new Error('--rehearse needs a database URL')
  return opts
}

// Entry point when spawned by `cli people:plan`.
/* v8 ignore next 11 -- entry-point guard; it runs only as its own process (cli people:plan spawns it), which in-process coverage cannot see */
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop() ?? '')
if (isMain && process.argv[1]?.endsWith('people-plan.ts')) {
  const opts = parsePlanOptions(process.argv.slice(2))
  rehearse(opts)
    .then(() => sql.end())
    .catch(async (err) => {
      console.error('error:', err instanceof Error ? err.message : err)
      await sql.end().catch(() => {})
      process.exit(1)
    })
}
