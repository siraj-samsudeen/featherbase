// #1418: read-only copies. An app's `datasets[]` entry (store: table, the
// default) becomes a Table in the app's own schema that nobody edits. Each
// load streams the declared query from its Data Source into its own partition
// of a load table in `featherbase_copy`, checks it there with SQL, and is
// activated by one update of the registry (`dataset_snapshot`). The Table is
// a view of the active load, so a reader sees one load or the next, never
// half of one, and the warehouse capture (which offers only ordinary tables)
// never sees it (design D1, D10).
import { createHash, randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { sql } from './db'
import { AppError, errorMessage } from './errors'
import { createTable, quoteRelation } from './table-engine'
import { invalidateMeta } from './meta'
import { getDriver, getSource } from './sources/registry'
import { datasetSourceReadOnly } from './sources/read-only'
import { assertStillServing, servingIdentity } from './app-lifecycle'
import { COPY_GUARD_KINDS, datasetKey, guardRefusal, type DatasetDeclaration, type DatasetGuard, type GuardCounts } from './app-datasets'
import type { SourceRow, SourceTypeFamily } from './sources/types'

export const COPY_SCHEMA = 'featherbase_copy'
type ColumnType = DatasetDeclaration['columns'][number]['type']

/** How each declared type is stored: numbers unbounded, so no digit is lost (D3). */
const STORED: Record<ColumnType, string> = { text: 'text', integer: 'bigint', number: 'numeric', money: 'numeric', date: 'date', boolean: 'boolean' }
/** How the Admin shows each declared type. */
const SHOWN: Record<ColumnType, string> = { text: 'Data', integer: 'Int', number: 'Float', money: 'Currency', date: 'Date', boolean: 'Check' }
/** The source families each declared type accepts (D4). A day may come as a time of day. */
const ACCEPTS: Record<ColumnType, readonly SourceTypeFamily[]> = {
  text: ['text'], integer: ['integer'], number: ['integer', 'decimal', 'float'], money: ['integer', 'decimal', 'float'],
  date: ['date', 'timestamp'], boolean: ['boolean'],
}
/** A row's id is its key values joined (D3). */
const KEY_JOIN = '·'

const q = (name: string) => `"${name.replace(/"/g, '""')}"`
const literal = (text: string) => `'${text.replace(/'/g, "''")}'`
const words = (name: string) => name.split('_').filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ')

/** A copy's Table is its dataset's registry name: `<app>.<dataset>`. */
export const copyTarget = datasetKey
/** The load table: one partition per load. */
const loadsRelation = (target: string) => `${q(COPY_SCHEMA)}.${q(target.replace('.', '__'))}`
const partName = (snapshot: string) => `l_${snapshot.replaceAll('-', '')}`
const partRelation = (snapshot: string) => `${q(COPY_SCHEMA)}.${q(partName(snapshot))}`

// ------------------------------------------------------------- declarations

interface Declared { app: string; dataset: DatasetDeclaration }
const declared = new Map<string, Declared>()

/** The selected version of `app`'s read-only copies, replacing what it had. */
export function registerAppCopies(app: string, datasets: readonly DatasetDeclaration[] = []): void {
  for (const [target, entry] of declared) if (entry.app === app) declared.delete(target)
  for (const dataset of datasets) if (dataset.store === 'table') declared.set(copyTarget(app, dataset.name), { app, dataset })
}

export function forgetAppCopies(): void {
  declared.clear()
}

export function declaredCopy(target: string): Declared | undefined {
  return declared.get(target)
}

/** Checked when an app's files are loaded: a new-load job is one the app declares. */
export function validateAppCopies(app: string, manifest: { datasets?: readonly DatasetDeclaration[]; jobs?: readonly { name: string }[]; tables?: readonly { name: string }[]; roles?: readonly string[] }): void {
  const jobs = new Set((manifest.jobs ?? []).map((job) => job.name))
  const roles = new Set(manifest.roles ?? [])
  const tables = new Set((manifest.tables ?? []).map((table) => table.name))
  for (const dataset of manifest.datasets ?? []) {
    if (dataset.onNewLoad && !jobs.has(dataset.onNewLoad))
      throw new Error(`Dataset ${dataset.name} tells the job ${dataset.onNewLoad} about new loads, which the app does not declare in its jobs`)
    for (const role of dataset.loadRoles ?? [])
      if (!roles.has(role)) throw new Error(`Dataset ${dataset.name} lets ${role} load it, which is not one of the app's roles`)
    if (dataset.store === 'table' && tables.has(copyTarget(app, dataset.name)))
      throw new Error(`Dataset ${dataset.name} is a read-only copy, so the app cannot also declare a Table ${copyTarget(app, dataset.name)}`)
  }
}

// ------------------------------------------------------------- storage (D1, D2)

function storedColumns(dataset: DatasetDeclaration): string {
  return dataset.columns.map((c) => `${q(c.name)} ${STORED[c.type]}`).join(', ')
}

async function createLoads(target: string, dataset: DatasetDeclaration): Promise<void> {
  await sql.unsafe(`create table ${loadsRelation(target)} (snapshot_id varchar(140) not null, row_id text not null, ${storedColumns(dataset)})
    partition by list (snapshot_id)`)
}

/** The Table people read: the active load's rows, with the standard columns
 *  every Table has. The active load is one value per statement (an init
 *  plan), so only its partition is scanned. */
async function createView(target: string, dataset: DatasetDeclaration): Promise<void> {
  const active = (column: string) => `(select ${column} from featherbase.dataset_snapshot where dataset = ${literal(target)} and state = 'active')`
  await sql.unsafe(`drop view if exists ${quoteRelation(target)}`)
  await sql.unsafe(`create view ${quoteRelation(target)} as select l.row_id::varchar(140) as row_id,
    'Administrator'::varchar(140) as created_by, ${active('activated_at')} as created_at, ${active('activated_at')} as updated_at,
    'Administrator'::varchar(140) as updated_by, 'draft'::text as submission_status, 0 as position,
    null::timestamptz as retired_at, null::varchar(140) as retired_by, null::text as retired_reason,
    ${dataset.columns.map((c) => `l.${q(c.name)}`).join(', ')}
    from ${loadsRelation(target)} l where l.snapshot_id = ${active('row_id')}`)
}

async function writeColumns(target: string, dataset: DatasetDeclaration): Promise<void> {
  await sql`delete from column_def where parent = ${target}`
  for (const [i, c] of dataset.columns.entries())
    await sql`insert into column_def ${sql({
      parent: target, position: i + 1, column_name: c.name, label: words(c.name), column_type: SHOWN[c.type],
      source_column: c.name, read_only: true, in_list_view: i < 6, unique: false, reqd: false, hidden: false, tier: 'basic',
    } as unknown as Record<string, never>)}`
}

/** Drop every load and its registry rows: the copy starts empty. */
async function dropLoads(target: string): Promise<void> {
  await sql.unsafe(`drop view if exists ${quoteRelation(target)}`)
  const parts = await sql`select row_id from dataset_snapshot where dataset = ${target}`
  for (const p of parts) await sql.unsafe(`drop table if exists ${partRelation(String(p.row_id))}`)
  await sql.unsafe(`drop table if exists ${loadsRelation(target)}`)
  await sql`delete from dataset_snapshot where dataset = ${target}`
}

/** What a load holds, as the registry records it: its columns and key. */
const shapeVersion = (dataset: DatasetDeclaration) => createHash('sha256')
  .update(JSON.stringify({ columns: dataset.columns.map((c) => [c.name, c.type]), rowKey: dataset.rowKey })).digest('hex').slice(0, 16)

/**
 * Make the app's read-only copies match its declaration, inside the caller's
 * install or upgrade transaction (D2). A new dataset gets its Table and its
 * check; a dataset gone is removed; an added column is added, empty until
 * the next load; a dropped one goes; a changed type or key rebuilds the copy
 * empty, until someone loads it (design D5: loads are asked for, never scheduled).
 */
export async function syncAppCopies(app: string, datasets: readonly DatasetDeclaration[] = []): Promise<void> {
  const wanted = datasets.filter((d) => d.store === 'table')
  const names = new Set(wanted.map((d) => copyTarget(app, d.name)))
  for (const target of await appCopies(app)) if (!names.has(target)) await removeCopy(target)
  for (const dataset of wanted) await ensureCopy(app, dataset)
}

async function ensureCopy(app: string, dataset: DatasetDeclaration): Promise<void> {
  const target = copyTarget(app, dataset.name)
  const [copy] = await sql`select * from featherbase.table_copy where target_table = ${target}`
  const provenance = {
    query: dataset.query, run_key_query: dataset.runKey ?? null, key_column: dataset.rowKey!.join(','),
  }
  if (!copy) {
    // A dataset that was a JSON snapshot under this name leaves its snapshots behind.
    await sql`delete from dataset_snapshot where dataset = ${target}`
    await createTable({
      name: target, label: words(dataset.name), id_pattern: 'prompt',
      description: `Read-only copy from ${dataset.source}, loaded whole per run by its app`,
      columns: dataset.columns.map((c) => ({ column_name: c.name, column_type: SHOWN[c.type] })),
    }, app, { storage: false })
    await sql`update table_def set system_written = true where name = ${target}`
    await writeColumns(target, dataset)
    await createLoads(target, dataset)
    await createView(target, dataset)
    await sql`insert into featherbase.table_copy ${sql({ target_table: target, mode: 'read_only', ...provenance } as unknown as Record<string, never>)}`
    invalidateMeta(target)
    return
  }
  const before = await sql`select column_name, column_type from column_def where parent = ${target} order by position`
  const was = new Map(before.map((c) => [String(c.column_name), String(c.column_type)]))
  const retyped = dataset.columns.some((c) => was.has(c.name) && was.get(c.name) !== SHOWN[c.type])
  const rekeyed = copy.key_column !== provenance.key_column
  let rebuilt = false
  if (retyped || rekeyed) {
    await dropLoads(target)
    await createLoads(target, dataset)
    rebuilt = true
  } else {
    for (const c of dataset.columns)
      if (!was.has(c.name)) await sql.unsafe(`alter table ${loadsRelation(target)} add column ${q(c.name)} ${STORED[c.type]}`)
    await sql.unsafe(`drop view if exists ${quoteRelation(target)}`)
    for (const name of was.keys())
      if (!dataset.columns.some((c) => c.name === name)) await sql.unsafe(`alter table ${loadsRelation(target)} drop column ${q(name)}`)
  }
  await createView(target, dataset)
  await writeColumns(target, dataset)
  await sql`update featherbase.table_copy set ${sql(provenance as unknown as Record<string, never>)}
    ${rebuilt ? sql`, last_run_key = null, last_run_id = null, last_copied_at = null` : sql``} where target_table = ${target}`
  invalidateMeta(target)
}

/** The read-only copies an app owns now. */
export async function appCopies(app: string): Promise<string[]> {
  return (await sql`select c.target_table from featherbase.table_copy c join table_def t on t.name = c.target_table
    where c.mode = 'read_only' and t.owner_app = ${app}`).map((row) => String(row.target_table))
}

/** Remove a read-only copy outright: its loads, its Table, its check. */
export async function removeCopy(target: string): Promise<void> {
  await dropLoads(target)
  await sql`delete from featherbase.table_copy where target_table = ${target}`
  await sql`delete from column_def where parent = ${target}`
  await sql`delete from table_def where name = ${target}`
  invalidateMeta(target)
}


// ------------------------------------------------------------- loading

export interface LoadOutcome {
  status: 'loaded' | 'unchanged' | 'not_due' | 'refused'
  /** The load made (loaded) or refused. */
  snapshot?: string
  previous?: string | null
  rows?: number
  reason?: string
}

export interface LoadOptions {
  trigger?: string
  /** Load whatever the run check says ("Load now"). */
  force?: boolean
}

class Refusal extends Error {}
const refuse = (reason: string): never => { throw new Refusal(reason) }

/** `{name}` in the query takes the run check's value of that name, bound. */
function boundQuery(query: string, runKey: SourceRow | null): { text: string; values: unknown[] } {
  const values: unknown[] = []
  const text = query.replace(/\{([a-z][a-z0-9_]*)\}/g, (_, name: string) => {
    if (!runKey || !Object.hasOwn(runKey, name)) refuse(`the query names {${name}}, which the run check does not answer`)
    values.push(runKey![name])
    return `$${values.length}`
  })
  return { text, values }
}

/** A value as one field of Postgres COPY text. */
function copyField(value: unknown, type: ColumnType): string {
  if (value === null || value === undefined) return '\\N'
  // A day may come as a Date at midnight UTC (Postgres) or as its text (DuckDB).
  let text = value instanceof Date ? value.toISOString() : String(value)
  if (type === 'date') text = text.slice(0, 10)
  return text.replace(/\\/g, '\\\\').replace(/\t/g, '\\t').replace(/\n/g, '\\n').replace(/\r/g, '\\r')
}

/** Counts a guard reads, over one load's partition, with SQL. */
async function partCounts(snapshot: string, guards: readonly DatasetGuard[]): Promise<GuardCounts> {
  const columns = [...new Set(guards.flatMap((g) => (g.column ? [g.column] : [])))]
  const periods = [...new Set(guards.flatMap((g) => (g.within ? [g.within] : [])))]
  const parts = [
    ...columns.map((c, i) => `, count(*) filter (where coalesce(${q(c)}, 0) <> 0) as c${i}, coalesce(sum(${q(c)}), 0)::text as s${i}`),
    ...periods.map((c, i) => {
      const value = `nullif(btrim(${q(c)}::text), '')`
      return `, count(distinct ${value}) as pd${i}, count(*) filter (where ${value} is null) as pe${i}, min(${value}) as pv${i}`
    }),
  ]
  const [counted] = await sql.unsafe(`select count(*) as rows ${parts.join(' ')} from ${partRelation(snapshot)}`)
  return {
    rows: Number(counted.rows),
    nonZero: Object.fromEntries(columns.map((c, i) => [c, Number(counted[`c${i}`])])),
    sums: Object.fromEntries(columns.map((c, i) => [c, String(counted[`s${i}`])])),
    periods: Object.fromEntries(periods.map((c, i) => {
      const distinct = Number(counted[`pd${i}`])
      const empty = Number(counted[`pe${i}`])
      return [c, { distinct, empty, value: distinct === 1 && empty === 0 ? String(counted[`pv${i}`]) : null }]
    })),
  }
}

async function activeLoad(target: string): Promise<string | null> {
  const [row] = await sql`select row_id from dataset_snapshot where dataset = ${target} and state = 'active'`
  return row ? String(row.row_id) : null
}

/** Is the copy's app enabled and not mid-upgrade? */
async function appServing(app: string): Promise<boolean> {
  const [installed] = await sql`select enabled, activation_pending from installed_app where name = ${app}`
  return !!installed?.enabled && !installed.activation_pending
}

/**
 * Check a read-only copy and load it when someone asks (D5, as ruled
 * 28-Nov-2026: no schedule): when the run check answers a new run, or always
 * with `force` ("Load now") or when it declares no run check. Serialized per copy. A refused load (its shape, its key or a
 * guard) keeps the last good load and answers `refused`; a source that
 * cannot be reached throws, so the job retries.
 */
export async function checkCopy(target: string, opts: LoadOptions = {}): Promise<LoadOutcome> {
  const entry = declared.get(target)
  if (!entry) throw new AppError('NotFoundError', `${target} is not a read-only copy any installed app declares`)
  const { app, dataset } = entry
  if (!(await appServing(app))) return { status: 'not_due', reason: `the app ${app} is off or mid-upgrade` }
  return sql.begin(async (lock) => {
    await lock`select pg_advisory_xact_lock(hashtext('read-only-copy:' || ${target}))`
    // Recorded before anything is read: an upgrade after this is caught at the swap.
    const identity = await servingIdentity(app)
    const [copy] = await sql`select * from featherbase.table_copy where target_table = ${target} and mode = 'read_only'`
    if (!copy) throw new AppError('NotFoundError', `${target} is not a read-only copy`)
    await abandonInterrupted(target)
    const source = await getSource(dataset.source)
    const driver = getDriver(source)
    if (!driver.describe || !driver.stream || !datasetSourceReadOnly(source))
      throw new AppError('NotSetUpError', `Data source ${dataset.source} (${source.engine}) cannot load a read-only copy`)
    const previous = await activeLoad(target)

    let runKey: SourceRow | null = null
    if (dataset.runKey) {
      const rows: SourceRow[] = []
      for await (const chunk of driver.stream(source, dataset.runKey, [])) {
        rows.push(...chunk)
        if (rows.length > 1) break
      }
      if (rows.length !== 1) return refused(target, `the run check answered ${rows.length > 1 ? 'more than one row' : 'no row'}; it names one run`, opts)
      runKey = rows[0]
    }
    const runKeyText = runKey ? JSON.stringify(runKey) : null
    // Without a run check every request loads; with one, only a new run or "Load now".
    if (runKey && previous && runKeyText === copy.last_run_key && !opts.force)
      return { status: 'unchanged', reason: `the run is unchanged (${runKeyText})` }

    let snapshot: string | undefined
    let activated = false
    try {
      const { text, values } = boundQuery(dataset.query, runKey)
      await checkShape(dataset, await describeOrRefuse(() => driver.describe!(source, text, values)))
      snapshot = randomUUID()
      await sql`insert into dataset_snapshot (row_id, dataset, definition_version, state, built_at, triggered_by)
        values (${snapshot}, ${target}, ${shapeVersion(dataset)}, 'building', clock_timestamp(), ${opts.trigger ?? null})`
      const t0 = Date.now()
      const rows = await copyRows(target, dataset, snapshot, driver.stream(source, selectText(dataset, text), values))
      const loadMs = Date.now() - t0
      await checkLoad(target, dataset, snapshot, rows, previous, async (column) => {
        // One row, always: an aggregate. An empty source has no total, which is 0.
        let total: unknown = null
        for await (const [row] of driver.stream!(source, `select cast(sum(${q(column)}) as varchar) as total from (${text}) as source`, values)) total = row.total
        return String(total ?? 0)
      })
      await indexAndAttach(target, dataset, snapshot)
      await assertStillServing(app, identity, () => activate(target, snapshot!, rows, loadMs, runKeyText))
      activated = true
      if (dataset.onNewLoad) await queueNewLoad(app, dataset.onNewLoad, target, previous, snapshot)
      await prune(target)
      return { status: 'loaded', snapshot, previous, rows }
    } catch (error) {
      // A load that went live stays live, whatever fails after it.
      if (snapshot && !activated) await failLoad(target, snapshot, errorMessage(error))
      if (error instanceof Refusal) return refused(target, error.message, opts, snapshot)
      throw error
    }
  })
}

async function refused(target: string, reason: string, opts: LoadOptions, snapshot?: string): Promise<LoadOutcome> {
  // A refusal before a load began is recorded too: it is why the copy is old.
  if (!snapshot) {
    snapshot = randomUUID()
    await sql`insert into dataset_snapshot (row_id, dataset, state, built_at, triggered_by, error)
      values (${snapshot}, ${target}, 'failed', clock_timestamp(), ${opts.trigger ?? null}, ${reason})`
  }
  await trimFailures(target)
  return { status: 'refused', snapshot, reason: `${target.split('.')[1]}: ${reason}` }
}

/** The last ten failures are the record of why a copy is old; older ones go. */
async function trimFailures(target: string): Promise<void> {
  await sql`delete from dataset_snapshot where row_id in (select row_id from dataset_snapshot where dataset = ${target} and state = 'failed'
    order by built_at desc offset 10)`
}

/** A query that names a column the source no longer has fails to describe:
 *  that is the shape check's refusal too, naming the column (Postgres says
 *  `column "x" does not exist`, DuckDB `column "x" not found`). */
async function describeOrRefuse<T>(describe: () => Promise<T>): Promise<T> {
  try {
    return await describe()
  } catch (error) {
    const [, column] = /column "?([^"\s]+)"? (?:does not exist|not found)/i.exec(errorMessage(error)) ?? []
    if (column) refuse(`the source has no column ${column.split('.').pop()} (renamed or removed?). The last good load is kept`)
    throw error
  }
}

/** D4: every declared column is in the source, as a kind of value its type takes. */
async function checkShape(dataset: DatasetDeclaration, shape: { name: string; type: string; family: SourceTypeFamily }[]): Promise<void> {
  const source = new Map(shape.map((c) => [c.name, c]))
  const problems: string[] = []
  for (const column of dataset.columns) {
    const found = source.get(column.name)
    if (!found) problems.push(`the source has no column ${column.name} (renamed or removed?)`)
    else if (!ACCEPTS[column.type].includes(found.family)) problems.push(`${column.name} is ${found.type} in the source, not ${column.type}`)
  }
  // An exact total cannot be checked against a float sum.
  for (const guard of dataset.guard ?? [])
    if (guard.kind === 'source_total' && source.get(guard.column!)?.family === 'float')
      problems.push(`${guard.column} is ${source.get(guard.column!)!.type} in the source, so its total cannot be checked exactly; make it a decimal there or drop the source_total guard`)
  if (problems.length) refuse(`${problems.join('; ')}. The last good load is kept`)
}

/** The declared columns, in order; a day is cut to its date at the source. */
function selectText(dataset: DatasetDeclaration, text: string): string {
  return `select ${dataset.columns.map((c) => (c.type === 'date' ? `cast(${q(c.name)} as date) as ${q(c.name)}` : q(c.name))).join(', ')} from (${text}) as source`
}

/** Stream the source into a new partition, not yet attached, by COPY. */
async function copyRows(target: string, dataset: DatasetDeclaration, snapshot: string, rows: AsyncGenerator<SourceRow[]>): Promise<number> {
  await sql.unsafe(`create table ${partRelation(snapshot)} (like ${loadsRelation(target)})`)
  const keyTypes = dataset.rowKey!.map((k) => dataset.columns.find((c) => c.name === k)!.type)
  let count = 0
  async function* lines() {
    for await (const chunk of rows) {
      let text = ''
      for (const row of chunk) {
        const key = dataset.rowKey!.map((k, i) => (row[k] == null ? '' : copyField(row[k], keyTypes[i])))
        text += [snapshot, key.some((k) => !k) ? '\\N' : key.join(KEY_JOIN), ...dataset.columns.map((c) => copyField(row[c.name], c.type))].join('\t') + '\n'
      }
      count += chunk.length
      if (text) yield text
    }
  }
  const columns = ['snapshot_id', 'row_id', ...dataset.columns.map((c) => c.name)].map(q).join(', ')
  try {
    // Its own transaction: a refused COPY rolls back alone, and the load is
    // still recorded as refused.
    await sql.begin(async (tx) => {
      const writable = await tx.unsafe(`copy ${partRelation(snapshot)} (${columns}) from stdin`).writable()
      await pipeline(Readable.from(lines()), writable)
    })
  } catch (error) {
    // A row with no key: the whole load is refused. (The shape check has
    // already held every value to a kind its declared type takes.)
    if ((error as { code?: string }).code === '23502') refuse('a row has an empty key; every row names its ' + dataset.rowKey!.join(', '))
    throw error
  }
  return count
}

/** The load's own checks (its key) and the app's guards, as SQL. */
async function checkLoad(target: string, dataset: DatasetDeclaration, snapshot: string, rows: number, previous: string | null,
  sourceTotal: (column: string) => Promise<string>): Promise<void> {
  const part = partRelation(snapshot)
  if (rows === 0) refuse('the query returned no rows; the last good load is kept')
  const [repeat] = await sql.unsafe(`select row_id, count(*)::int as n from ${part} group by row_id having count(*) > 1 order by count(*) desc, row_id limit 1`)
  if (repeat) refuse(`${repeat.n} rows have the key ${String(repeat.row_id)}; each ${dataset.rowKey!.join(' × ')} is one row`)
  const guards = dataset.guard ?? []
  const plain = guards.filter((g) => !COPY_GUARD_KINDS.includes(g.kind))
  if (plain.length) {
    const refusal = guardRefusal(dataset.name, plain, await partCounts(snapshot, plain), previous ? await partCounts(previous, plain) : null)
    if (refusal) refuse(refusal.slice(dataset.name.length + 2))
  }
  for (const guard of guards) {
    const column = q(guard.column ?? '')
    if (guard.kind === 'source_total') {
      const expected = await sourceTotal(guard.column!)
      const [loaded] = await sql.unsafe(`select coalesce(sum(${column}), 0)::text as total, coalesce(sum(${column}), 0) = $1::numeric as same from ${part}`, [expected])
      if (!loaded.same) refuse(`${guard.column} totals ${String(loaded.total)} here but ${expected} in the source`)
    }
    if (guard.kind === 'keeps_values' && previous) {
      const gone = await sql.unsafe(`select v from (select distinct ${column}::text as v from ${partRelation(previous)} where ${column} is not null
        except select distinct ${column}::text from ${part}) as gone order by v limit 6`)
      if (gone.length) {
        const shown = gone.slice(0, 5).map((g) => String(g.v)).join(', ') + (gone.length > 5 ? ' and more' : '')
        refuse(`${guard.column} ${shown} ${gone.length === 1 ? 'is' : 'are'} missing from the new load`)
      }
    }
  }
}

/** Index the checked load for its reads, then attach it beside the active one. */
async function indexAndAttach(target: string, dataset: DatasetDeclaration, snapshot: string): Promise<void> {
  const part = partRelation(snapshot)
  await sql.unsafe(`create unique index on ${part} (row_id)`)
  for (const column of new Set([...Object.values(dataset.filters), ...dataset.keys]))
    // A scoped read compares as text: for a text column (a store or section
    // code) that is the column itself, so this index serves it.
    await sql.unsafe(`create index on ${part} (${q(column)})`)
  await sql.unsafe(`alter table ${part} add check (snapshot_id = ${literal(snapshot)})`)
  await sql.unsafe(`alter table ${loadsRelation(target)} attach partition ${part} for values in (${literal(snapshot)})`)
}

/** The swap: one update of the registry, readers see one load or the other. */
async function activate(target: string, snapshot: string, rows: number, loadMs: number, runKey: string | null): Promise<void> {
  const [size] = await sql.unsafe(`select pg_total_relation_size(${literal(partRelation(snapshot))}) as bytes`)
  await sql.begin(async (tx) => {
    await tx`update dataset_snapshot set state = 'superseded', updated_at = now() where dataset = ${target} and state = 'active'`
    await tx`update dataset_snapshot set state = 'active', activated_at = clock_timestamp(), row_count = ${rows}, bytes = ${Number(size.bytes)},
      load_ms = ${loadMs}, updated_at = now() where row_id = ${snapshot}`
    await tx`update featherbase.table_copy set last_copied_at = clock_timestamp(), last_run_id = ${snapshot}, last_run_key = ${runKey}
      where target_table = ${target}`
  })
}

/** Only a load still being made: never one that went live. */
async function failLoad(target: string, snapshot: string, reason: string): Promise<void> {
  const [failed] = await sql`update dataset_snapshot set state = 'failed', error = ${reason}, updated_at = now()
    where row_id = ${snapshot} and dataset = ${target} and state = 'building' returning row_id`
  if (failed) await sql.unsafe(`drop table if exists ${partRelation(snapshot)}`)
}

/** A load a stopped server left half made: never activated, so it goes. */
async function abandonInterrupted(target: string): Promise<void> {
  for (const row of await sql`select row_id from dataset_snapshot where dataset = ${target} and state = 'building'`)
    await failLoad(target, String(row.row_id), 'interrupted: the server stopped during the load')
}

/** Keep the active load and the one before it (D7); drop older loads whole,
 *  and trim the failures. A drop waits at most
 *  two seconds for a long read and is otherwise left for the next load. */
async function prune(target: string): Promise<void> {
  const old = await sql`select row_id from dataset_snapshot where dataset = ${target} and state = 'superseded'
    order by activated_at desc offset 1`
  for (const row of old) {
    try {
      await sql.begin(async (tx) => {
        await tx`select set_config('lock_timeout', '2s', true)`
        await tx.unsafe(`drop table if exists ${partRelation(String(row.row_id))}`)
        await tx`delete from dataset_snapshot where row_id = ${String(row.row_id)}`
      })
    } catch (error) {
      console.warn(`[copy] ${target}: an old load stays until the next one: ${errorMessage(error)}`)
    }
  }
  await trimFailures(target)
}

// ------------------------------------------------------------- after a load (D7)

export const NEW_LOAD_PAYLOAD = 'new_load'

async function queueNewLoad(app: string, job: string, target: string, previous: string | null, current: string): Promise<void> {
  const { enqueue } = await import('./jobs')
  const { appJobMethod } = await import('./app-jobs')
  await enqueue(appJobMethod(app, job), { [NEW_LOAD_PAYLOAD]: { dataset: target.split('.')[1], previous, current } })
}

export interface LoadMove {
  /** The group's values, by the columns asked for. */
  group: Record<string, string | null>
  /** Totals as decimal text; null when the group is new or gone. */
  before: string | null
  after: string | null
}

/**
 * The groups whose total of `measure` moved by more than `threshold` percent
 * from `previous` to `current` (10 unless given), a group new or gone
 * included, ordered by group. Both loads must be this copy's.
 */
export async function loadMoves(target: string, previous: string, current: string,
  opts: { by: readonly string[]; measure: string; threshold?: number }): Promise<LoadMove[]> {
  const entry = declared.get(target)
  if (!entry) throw new AppError('NotFoundError', `${target} is not a read-only copy any installed app declares`)
  const types = new Map(entry.dataset.columns.map((c) => [c.name, c.type]))
  const threshold = opts.threshold ?? 10
  if (!Array.isArray(opts.by) || !opts.by.length || opts.by.some((c) => !['text', 'integer', 'date'].includes(types.get(c) ?? '')))
    throw new AppError('ValidationError', `moves groups by the copy's text, integer or date columns`)
  if (!['integer', 'number', 'money'].includes(types.get(opts.measure) ?? ''))
    throw new AppError('ValidationError', `moves sums one of the copy's number columns, not ${String(opts.measure)}`)
  if (typeof threshold !== 'number' || !Number.isFinite(threshold) || threshold < 0)
    throw new AppError('ValidationError', 'A moves threshold is a percentage, 0 or more')
  const loads = await sql`select row_id from dataset_snapshot where dataset = ${target} and row_id in ${sql([previous, current])}
    and state in ('active', 'superseded')`
  if (loads.length !== (previous === current ? 1 : 2)) throw new AppError('NotFoundError', `Those are not two loads ${target} keeps`)
  const by = opts.by.map(q).join(', ')
  const total = (snapshot: string) => `select ${by}, sum(${q(opts.measure)}) as t from ${partRelation(snapshot)} group by ${by}`
  const rows = await sql.unsafe(`select ${opts.by.map((c) => `coalesce(o.${q(c)}, n.${q(c)})::text as ${q(c)}`).join(', ')},
      o.t::text as before, n.t::text as after
    from (${total(previous)}) o full join (${total(current)}) n using (${by})
    where o.t is null or n.t is null or (o.t = 0 and n.t <> 0) or abs(n.t - o.t) * 100 > abs(o.t) * $1::numeric
    order by ${opts.by.map((c) => `coalesce(o.${q(c)}, n.${q(c)})`).join(', ')}`, [threshold])
  return rows.map((r) => ({
    group: Object.fromEntries(opts.by.map((c) => [c, r[c] == null ? null : String(r[c])])),
    before: r.before == null ? null : String(r.before),
    after: r.after == null ? null : String(r.after),
  }))
}
