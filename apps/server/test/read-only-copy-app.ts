// #1418: a made-up warehouse and an app that declares read-only copies of it.
// The "warehouse" is a schema of made-up rows in the sibling test database
// (external-database.ts), committed outside the sandbox, one schema per test
// file. The app `copyproof` is written per test into a folder of its own, so
// each test shows the declaration it proves; a version step upgrades it.
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import postgres from 'postgres'
import type { TestClient } from 'feather-testing-postgres'
import { EXTERNAL_DATABASE_URL } from './external-database'
import { availableRuntimeVersions, discoverPackages } from '../src/runtime-packages'
import { invalidateSources } from '../src/sources/registry'
import { sql } from '../src/db'
import { checkCopy, type LoadOptions } from '../src/read-only-copy'
import { runOneJob } from '../src/jobs'

export const APP = 'copyproof'
export const LINES = `${APP}.forecast_line_day`
export const SALES = `${APP}.sales_day`
export const SOURCE = 'copyproof-warehouse'
const SOURCE_ENV = 'COPYPROOF_WAREHOUSE_URL'
process.env[SOURCE_ENV] = EXTERNAL_DATABASE_URL
const provider = resolve('../..', 'test-apps/fixtures/place-roster')

export type Line = [run: string, store: string, subcategory: string, day: string, value: string]

/** The warehouse: its official run, the run's lines, and daily sales. */
export class Warehouse {
  readonly db = postgres(EXTERNAL_DATABASE_URL, { max: 2, onnotice: () => {} })
  constructor(readonly schema: string) {}

  async create(): Promise<void> {
    await this.db.unsafe(`drop schema if exists ${this.schema} cascade; create schema ${this.schema};
      create table ${this.schema}.forecast_run (run_id text, status text);
      create table ${this.schema}.forecast_line_day (run_id text, store_code text, subcategory_code text, sale_date date, value numeric(20,2), qty integer);
      create table ${this.schema}.sales_day (store_code text, sale_date date, value numeric(20,2))`)
  }

  async drop(): Promise<void> {
    invalidateSources()
    await this.db.unsafe(`drop schema if exists ${this.schema} cascade`)
    await this.db.end({ timeout: 2 })
  }

  /** Names `run` the official run and holds `lines` (with a quantity of 7 each). */
  async publish(run: string, lines: Line[]): Promise<void> {
    await this.db.unsafe(`truncate ${this.schema}.forecast_run; truncate ${this.schema}.forecast_line_day`)
    await this.db.unsafe(`insert into ${this.schema}.forecast_run values ($1, 'official')`, [run])
    for (const line of lines) await this.db.unsafe(`insert into ${this.schema}.forecast_line_day values ($1, $2, $3, $4, $5, 7)`, line)
  }

  async sales(rows: [store: string, day: string, value: string][]): Promise<void> {
    await this.db.unsafe(`truncate ${this.schema}.sales_day`)
    for (const row of rows) await this.db.unsafe(`insert into ${this.schema}.sales_day values ($1, $2, $3)`, row)
  }

  /** A change to the feed itself: a column added, renamed or retyped. */
  async alter(statement: string): Promise<void> {
    await this.db.unsafe(statement.replaceAll('{schema}', this.schema))
  }
}

type Dataset = Record<string, unknown>

/** The forecast lines: run × store × subcategory × day, loaded per official run. */
export const forecastLines = (schema: string, more: Dataset = {}): Dataset => ({
  name: 'forecast_line_day', source: SOURCE,
  query: `select run_id, store_code, subcategory_code, sale_date, value from ${schema}.forecast_line_day where run_id = {run_id}`,
  columns: [
    { name: 'run_id', type: 'text' }, { name: 'store_code', type: 'text' }, { name: 'subcategory_code', type: 'text' },
    { name: 'sale_date', type: 'date' }, { name: 'value', type: 'money' },
  ],
  keys: ['store_code', 'subcategory_code', 'sale_date'], rowKey: ['store_code', 'subcategory_code', 'sale_date'],
  filters: { store: 'store_code' },
  runKey: `select run_id from ${schema}.forecast_run where status = 'official'`,
  loadRoles: ['Forecast Loader'],
  ...more,
})

/** Daily sales: no run check, so every load reads it again. */
export const dailySales = (schema: string, more: Dataset = {}): Dataset => ({
  name: 'sales_day', source: SOURCE, query: `select store_code, sale_date, value from ${schema}.sales_day`,
  columns: [{ name: 'store_code', type: 'text' }, { name: 'sale_date', type: 'date' }, { name: 'value', type: 'money' }],
  keys: ['store_code', 'sale_date'], rowKey: ['store_code', 'sale_date'], filters: { store: 'store_code' },
  ...more,
})

const SERVER = `export const platformVersion = '2026-10'
const calls = (globalThis.__copyproofCalls ??= [])
export const jobs = {
  async carry_changes(ctx) {
    const load = ctx.newLoad
    const moves = load ? await load.moves({ by: ['store_code', 'subcategory_code'], measure: 'value' }) : null
    calls.push({ load: load && { dataset: load.dataset, previous: load.previous, current: load.current }, moves })
    // The team leader a test names hears of each move.
    for (const move of moves ?? []) if (globalThis.__copyproofLead)
      await ctx.people.notify(globalThis.__copyproofLead, { subject: move.group.subcategory_code + ' moved: ' + move.before + ' to ' + move.after, body: 'Your line is waiting again.' })
    ctx.setResult(JSON.stringify(moves))
  },
}
export const reads = {
  lines: (ctx) => ctx.datasets.active('forecast_line_day'),
  // The app's code reads its copy as a Table: the current load.
  lines_as_rows: (ctx) => ctx.documents.list('copyproof.forecast_line_day', { filters: [['store_code', '=', 'LKS']], fields: ['row_id', 'run_id', 'value'] }),
}
export const actions = {
  // A copy is never written, even by its own app.
  async rewrite({ documents }) {
    const [line] = await documents.list('copyproof.forecast_line_day', { fields: ['row_id', 'updated_at'] })
    return documents.update('copyproof.forecast_line_day', { row_id: line.row_id, updated_at: line.updated_at, value: '1.00' })
  },
}
export const validators = {
  // A note names a forecast line, which must be in the current load.
  async 'copyproof.note'({ row, documents, reject }) {
    if (!row.body) return
    const lines = await documents.list('copyproof.forecast_line_day', { filters: [['row_id', '=', row.body]] })
    if (!lines.length) reject('No forecast line ' + row.body + ' in the current run')
  },
}
`

export const jobCalls = () => ((globalThis as { __copyproofCalls?: unknown[] }).__copyproofCalls ??= []) as
  { load: { dataset: string; previous: string | null; current: string } | null; moves: unknown }[]

const folders: string[] = []
export async function removeFolders(): Promise<void> {
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true })
  ;(globalThis as { __copyproofCalls?: unknown[] }).__copyproofCalls = []
  ;(globalThis as { __copyproofLead?: string }).__copyproofLead = undefined
}

/** Writes `copyproof` at `version` declaring `datasets`; a later version
 *  carries one version step per earlier one, changing no Table. */
export async function writeApp(datasets: Dataset[], version = '1.0.0'): Promise<string> {
  const dir = await mkdtemp(resolve('test/.copy-proof-'))
  folders.push(dir)
  const [, minor] = version.split('.').map(Number)
  const migrations = Array.from({ length: minor }, (_, i) => ({ id: `step_${i + 1}`, fromVersion: `1.${i}.0`, toVersion: `1.${i + 1}.0`, operations: [] }))
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name: `featherbase-${APP}`, version, type: 'module' }))
  await writeFile(join(dir, 'server.mjs'), SERVER)
  await writeFile(join(dir, 'featherbase.json'), JSON.stringify({
    manifestVersion: 1, platformVersion: '2026-10', name: APP, title: 'Copy proof', entryTable: `${APP}.note`, server: 'server.mjs',
    tables: [{ name: `${APP}.note`, label: 'note', id_pattern: 'prompt', columns: [{ column_name: 'body', column_type: 'Data' }] }],
    roles: ['Copy Reader', 'Forecast Loader'],
    permissions: [{ table: `${APP}.note`, role: 'Copy Reader', can_read: true }],
    datasets,
    jobs: [{ name: 'carry_changes', cadence: 'daily', description: 'Carry changes to a new run and say what moved.', grants: ['notify_people'] }],
    reads: { version: 1, tables: [`${APP}.note`], operations: {
      lines: { policy: { kind: 'person_scope', readRoles: ['Copy Reader'], actionRoles: [] }, authorization: { kind: 'generic' } },
      lines_as_rows: { policy: { kind: 'table' }, authorization: { kind: 'generic' } },
    } },
    actions: { version: 2, tables: [`${APP}.note`], operations: {
      rewrite: { policy: { kind: 'table' }, authorization: { kind: 'generic' } },
    } },
    migrations,
  }))
  return dir
}

/** Installs the app (and the place provider) and connects its warehouse. */
export async function install(admin: TestClient, dir: string): Promise<void> {
  const problems = await discoverPackages([dir, provider])
  if (problems.length) throw new Error(JSON.stringify(problems))
  await admin.post('/api/install_app', { name: APP })
  await admin.post('/api/install_app', { name: 'placeroster' })
  invalidateSources()
  await admin.post('/api/table/Data%20Source', { row_id: SOURCE, engine: 'postgres', url_env: SOURCE_ENV, access: 'read_only' })
}

/** Upgrades the installed app to the version in `dir` and activates it. */
export async function upgrade(admin: TestClient, installed: string, dir: string, version: string): Promise<void> {
  const problems = await discoverPackages([installed, dir, provider])
  if (problems.length) throw new Error(JSON.stringify(problems))
  const plan = await admin.post<{ planId: string }>('/api/preview_app_upgrade', { name: APP, version })
  await admin.post('/api/upgrade_app', { name: APP, version, planId: plan.planId })
  await admin.post('/api/activate_app_upgrade', { name: APP, version })
}

/** The place provider's module: a test sets the places it answers. */
async function roster(): Promise<{ faults: { result?: unknown } }> {
  const digest = availableRuntimeVersions().find((p) => p.name === 'placeroster')!.digest
  return import(`${pathToFileURL(resolve(provider, 'server.mjs')).href}?artifact=${digest}`)
}

/** The app's read of the forecast lines, as `client`, covering `stores`. */
export async function readLines(client: TestClient, stores: string[]): Promise<{ status: number; body: unknown }> {
  const places = await roster()
  places.faults.result = [{ label: 'Their stores', filters: { store: stores } }]
  try {
    const res = await client.fetch(`/api/app_reads/${APP}/lines`, { method: 'POST', body: JSON.stringify({ payload: {} }),
      headers: { 'content-type': 'application/json', 'X-Featherbase-App-Version': `${APP}@1.0.0` } })
    return { status: res.status, body: await res.json() }
  } finally {
    delete places.faults.result
  }
}

/** Checks a copy as its load job does, and answers what it did. */
export const load = (target: string, opts: LoadOptions = {}) => checkCopy(target, { trigger: 'test', ...opts })

/** Asks for a load as `client` (the Admin's buttons, a script), then runs the
 *  queued load as the worker does, and answers the request and the run. */
export async function requestAndRun(client: TestClient, table: string, force = false) {
  const asked = await client.post<{ queued: boolean; message: string }>('/api/copy_load', { table, ...(force ? { force } : {}) })
  await sql`update background_job set run_at = now() where method = 'read_only_copy_load' and job_status = 'queued'`
  const ran = await runOneJob()
  const [execution] = await sql`select outcome, result, error from job_execution where method = 'read_only_copy_load' order by started_at desc limit 1`
  return { asked, ran, execution }
}

/** The copy as its bar in the Admin reads it. */
export const loadState = (client: TestClient, table: string) =>
  client.get<Record<string, unknown> | null>(`/api/table/${encodeURIComponent(table)}:copy_load_state`)

/** The copy's rows, as its Table answers them, by key. */
export async function rows(target: string): Promise<Record<string, unknown>[]> {
  const [schema, relation] = target.split('.')
  return sql`select * from ${sql(schema)}.${sql(relation)} order by row_id`
}
