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
import { _getRootSql, _setSqlDelegate, sql, type TxSql } from './db'
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

const ROLLBACK = new Error('people:plan rollback')

/** A hook for later migrations (0102) to print their own plan. */
export type PlanStep = (file: string, opts: PlanOptions) => Promise<boolean>
const steps: PlanStep[] = []
export function registerPlanStep(step: PlanStep) {
  steps.push(step)
}

async function runFile(file: string, opts: PlanOptions) {
  if (file === '0101_person_rename.ts') {
    await sql.begin(async () => {
      await sql.unsafe('set local search_path = featherbase, pg_temp')
      const report = await migratePersonRename()
      console.log(formatPersonRenameReport(report, { map: opts.map, columns: opts.columns }))
      await sql`insert into featherbase.migration (name) values (${file})`
    })
    invalidateMeta()
    return
  }
  if (file === '0102_person_resolution.ts') {
    await sql.begin(async () => {
      await sql.unsafe('set local search_path = featherbase, pg_temp')
      console.log(formatResolutionPlan(await migratePersonResolution()))
      await sql`insert into featherbase.migration (name) values (${file})`
    })
    invalidateMeta()
    return
  }
  for (const step of steps) if (await step(file, opts)) return
  await sql.begin(() => applyMigrationFile(file))
  console.log(`applied ${file}`)
}

/** On a database the re-id has already run on: classify again and scan the
 *  recorded map, so a regression (an old id written back) is visible. */
async function rescan(opts: PlanOptions) {
  const classification = await classifyColumns()
  const [have] = await sql`select to_regclass('featherbase.person_id_map') as r`
  const map: IdMapEntry[] = have?.r
    ? ((await sql`select old_id, new_id, kind from person_id_map`) as unknown as IdMapEntry[])
    : []
  await stageRewriteMap(sql, map)
  const hits = await scanForOldIds(sql, classification.classified)
  console.log(`person_id_map: ${map.length} entries`)
  console.log(`scan: ${hits.length ? hits.map((h) => `${h.column} ${h.rows}`).join('; ') : 'no old id in any registered column'}`)
  console.log(`text columns: ${classification.classified.length} classified, ${classification.unclassified.length} unclassified`)
  if (classification.unclassified.length || opts.columns) console.log(formatClassification(classification))
}

async function checkSignIns(codes: string[]) {
  if (!codes.length) return
  const previous = process.env.DELEGATED_LOGIN_TEST_MODE
  const { TEST_MODE_PHRASE, delegatedMethods, linkedUser } = await import('./delegated-login')
  const { assertEligible } = await import('./sign-in')
  process.env.DELEGATED_LOGIN_TEST_MODE = TEST_MODE_PHRASE
  try {
    const methods = await delegatedMethods()
    for (const code of codes) {
      for (const cfg of methods) {
        const m = cfg
        try {
          const found = await linkedUser(cfg, code)
          await assertEligible(cfg.method, found.user)
          console.log(`test-mode sign-in by code ${code} via ${m.key}: OK → ${found.user}`)
        } catch (err) {
          console.log(`test-mode sign-in by code ${code} via ${m.key}: REFUSED (${(err as Error).message})`)
        }
      }
    }
  } finally {
    if (previous === undefined) delete process.env.DELEGATED_LOGIN_TEST_MODE
    else process.env.DELEGATED_LOGIN_TEST_MODE = previous
  }
}

export async function rehearse(opts: PlanOptions): Promise<void> {
  await assertDatabaseEnvironment()
  const pending = await pendingMigrations()
  console.log(`people:plan — rehearsal in a rolled-back transaction; pending: ${pending.length ? pending.join(', ') : 'none'}`)
  try {
    await _getRootSql().begin(async (tx) => {
      _setSqlDelegate(tx as unknown as TxSql)
      try {
        for (const file of pending) await runFile(file, opts)
        if (!pending.includes('0101_person_rename.ts')) await rescan(opts)
        await checkSignIns(opts.checkSignIn)
      } finally {
        _setSqlDelegate(null)
        invalidateMeta()
      }
      throw ROLLBACK
    })
  } catch (err) {
    if (err !== ROLLBACK) throw err
  }
  console.log('people:plan — rolled back; nothing was changed')
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
