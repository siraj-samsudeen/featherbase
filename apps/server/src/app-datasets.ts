// #625 (design E3, revised by ADR 0013): an app declares its cached datasets.
// Each names a Data Source the instance already declares (used read-only),
// the query, its typed columns (saying which are money), the keys a read may
// filter on, and the mapping from scope filter names (E1: `store`,
// `section`, ...) to query columns, so neither the app nor the platform
// hard-codes a client's column names in platform code.
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { sql } from './db'
import type { PersonScope } from 'shared'
import { activeSnapshot, recordMiss, registerDataset, unregisterDataset } from './dataset-snapshot'
import { AppError } from './errors'
import { logAccess } from './audit'
import { getDriver, getSource } from './sources/registry'
import { datasetSourceReadOnly } from './sources/read-only'
import type { DatasetCondition, DatasetWhere } from './sources/types'

const identifier = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/)
const distinct = (values: string[]) => new Set(values).size === values.length

/** The types a dataset column may hold. `money` is a number the app shows as money. */
export const DATASET_COLUMN_TYPES = ['text', 'integer', 'number', 'money', 'date', 'boolean'] as const
/** Keys and scope-mapped columns are compared as text, so only types whose
 *  text form is the same in the source and in the snapshot qualify. */
const FILTERABLE: readonly string[] = ['text', 'integer', 'date']

/** #669: the completeness checks a dataset may declare. Each is checked on a
 *  refresh's candidate before it can replace the active snapshot. */
export const DATASET_GUARD_KINDS = ['min_rows', 'not_all_zero', 'max_drop_pct'] as const
/** A guarded column holds figures, so "zero" and "a drop" mean something. */
const GUARDABLE: readonly string[] = ['integer', 'number', 'money']

const guardSchema = z.object({
  kind: z.enum(DATASET_GUARD_KINDS, { errorMap: () => ({ message: `A dataset guard kind must be one of ${DATASET_GUARD_KINDS.join(', ')}` }) }),
  column: identifier.optional(),
  value: z.number().optional(),
}).strict().superRefine((guard, context) => {
  const issue = (message: string) => context.addIssue({ code: 'custom', message })
  if (guard.kind === 'min_rows') {
    if (guard.column !== undefined) issue('A min_rows guard counts rows, so it names no column')
    if (guard.value === undefined || !Number.isInteger(guard.value) || guard.value < 0)
      issue('A min_rows value must be a whole number of rows, 0 or more')
    return
  }
  if (guard.column === undefined) issue(`A ${guard.kind} guard needs a column`)
  if (guard.kind === 'not_all_zero' && guard.value !== undefined) issue('A not_all_zero guard takes no value')
  // Whole percentages, so the limit is checked in integers, exactly.
  if (guard.kind === 'max_drop_pct' && (guard.value === undefined || !Number.isInteger(guard.value) || guard.value < 0 || guard.value > 100))
    issue('A max_drop_pct value must be a whole percentage from 0 to 100')
})

export type DatasetGuard = z.infer<typeof guardSchema>

/** What a guard reads of a snapshot: its rows, and per guarded column how
 *  many of its values are neither empty nor zero. */
export interface GuardCounts {
  rows: number
  nonZero: Record<string, number>
}

const whole = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 })
const percent = (value: number) => `${Math.round(value * 10) / 10}%`

/**
 * #669: the first of `guards` that the candidate fails, said in words that
 * name the dataset, the guard and the numbers; null when every guard passes.
 * A drop is measured against the active snapshot, so a first refresh, with
 * none to compare, cannot fail one.
 */
export function guardRefusal(dataset: string, guards: readonly DatasetGuard[], candidate: GuardCounts, previous: GuardCounts | null): string | null {
  for (const guard of guards) {
    if (guard.kind === 'min_rows') {
      if (candidate.rows < guard.value!) return `${dataset}: ${whole.format(candidate.rows)} rows, at least ${whole.format(guard.value!)} required`
      continue
    }
    const column = guard.column!
    const now = candidate.nonZero[column]
    if (guard.kind === 'not_all_zero') {
      if (now === 0) return `${dataset}: every ${column} value is empty or zero (${whole.format(candidate.rows)} rows)`
      continue
    }
    const before = previous?.nonZero[column]
    if (!before) continue
    // Decided in integers: a computed percentage is not exact (100 → 93 is
    // 7.000000000000001%), and a drop of exactly the limit must pass.
    if (now * 100 < before * (100 - guard.value!))
      return `${dataset}: ${column} values dropped ${percent(((before - now) / before) * 100)} (${whole.format(before)} → ${whole.format(now)}), limit ${percent(guard.value!)}`
  }
  return null
}

const datasetSchema = z.object({
  name: identifier,
  source: z.string().min(1).max(140),
  // The query is the app's, reviewed where the app lives. It reaches the
  // source wrapped as a sub-query, so it must be one statement.
  query: z.string().min(1).refine(query => !query.includes(';'), 'A dataset query is one statement, with no ";"'),
  columns: z.array(z.object({ name: identifier, type: z.enum(DATASET_COLUMN_TYPES) }).strict()).min(1)
    .refine(columns => distinct(columns.map(column => column.name)), 'Dataset column names must be distinct'),
  keys: z.array(identifier).refine(distinct, 'Dataset keys must be distinct'),
  filters: z.record(identifier, identifier).refine(filters => Object.keys(filters).length > 0, 'A dataset maps at least one scope filter'),
  guard: z.array(guardSchema).optional(),
}).strict().superRefine((dataset, context) => {
  const types = new Map(dataset.columns.map(column => [column.name, column.type]))
  for (const { column } of dataset.guard ?? []) {
    if (column === undefined) continue
    if (!types.has(column)) context.addIssue({ code: 'custom', message: `Dataset ${dataset.name}'s guard column ${column} is not one of its columns` })
    else if (!GUARDABLE.includes(types.get(column)!))
      context.addIssue({ code: 'custom', message: `Dataset ${dataset.name}'s guard column ${column} must be integer, number or money` })
  }
  for (const [what, column] of [...dataset.keys.map(key => ['key', key]), ...Object.values(dataset.filters).map(c => ['scope filter', c])]) {
    if (!types.has(column)) context.addIssue({ code: 'custom', message: `Dataset ${dataset.name}'s ${what} ${column} is not one of its columns` })
    else if (!FILTERABLE.includes(types.get(column)!))
      context.addIssue({ code: 'custom', message: `Dataset ${dataset.name}'s ${what} ${column} must be text, integer or date` })
  }
})

/** The manifest's `datasets`. */
export const datasetsDeclaration = z.array(datasetSchema)
  .refine(datasets => distinct(datasets.map(dataset => dataset.name)), 'Dataset names must be distinct')

export type DatasetDeclaration = z.infer<typeof datasetSchema>

/** One shaped value: what a dataset row holds, in the snapshot and live alike. */
export type DatasetValue = string | number | boolean | null
export type DatasetRow = Record<string, DatasetValue>

function shapeValue(type: DatasetDeclaration['columns'][number]['type'], value: unknown, column: string, exact: boolean): DatasetValue {
  if (value === null || value === undefined) return null
  // An integer key or scope-mapped column decides whose row it is, so it keeps
  // its exact digits, as text: a JavaScript number rounds ids above 2^53 into
  // each other. Any other integer must be one a number holds exactly.
  if (type === 'integer' && exact) {
    if (typeof value === 'number' ? Number.isSafeInteger(value) : typeof value === 'string' && /^-?\d+$/.test(value)) return BigInt(value as number | string).toString()
    throw new Error(`column ${column} holds a value that is not integer`)
  }
  switch (type) {
    case 'text': return String(value)
    case 'boolean':
      if (typeof value === 'boolean') return value
      if (value === 'true' || value === 'false') return value === 'true'
      break
    case 'date': {
      const day = value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10)
      if (/^\d{4}-\d{2}-\d{2}$/.test(day)) return day
      break
    }
    default: {
      const number = typeof value === 'number' ? value : Number(String(value))
      if (Number.isFinite(number) && (type !== 'integer' || Number.isSafeInteger(number))) return number
    }
  }
  throw new Error(`column ${column} holds a value that is not ${type}`)
}

/**
 * The one shaping function. A snapshot is shaped by it before it is stored,
 * and a live read by it before it is answered, so the cached and the live
 * answer cannot disagree in layout or maths: the declared columns, in their
 * declared order, each held to its declared type.
 */
export function shapeRows(dataset: DatasetDeclaration, raw: Record<string, unknown>[]): DatasetRow[] {
  const exact = new Set([...dataset.keys, ...Object.values(dataset.filters)])
  return raw.map((source) => {
    const row: DatasetRow = {}
    for (const { name, type } of dataset.columns) {
      if (!(name in source)) throw new Error(`Dataset ${dataset.name}'s query did not return column ${name}`)
      row[name] = shapeValue(type, source[name], name, exact.has(name))
    }
    return row
  })
}

/** Run the declared query on its source, read-only, limited to `where`. */
async function runQuery(dataset: DatasetDeclaration, where?: DatasetWhere) {
  const source = await getSource(dataset.source)
  const driver = getDriver(source)
  if (!driver.query) throw new Error(`Data source ${dataset.source} (${source.engine}) cannot run a dataset query`)
  return driver.query(source, dataset.query, dataset.columns, where)
}

/** A stored snapshot's counts for its guards, in one pass over its rows. */
async function guardCounts(snapshotId: string, guards: readonly DatasetGuard[]): Promise<GuardCounts> {
  const columns = [...new Set(guards.flatMap((guard) => (guard.column ? [guard.column] : [])))]
  const nonZero = columns.map((column, i) =>
    sql`, count(*) filter (where coalesce((row->>${column})::numeric, 0) <> 0) as ${sql(`c${i}`)}`)
  const [counted] = await sql`
    select count(*) as rows ${nonZero.length ? nonZero.reduce((all, one) => sql`${all} ${one}`) : sql``}
    from app_dataset_row where snapshot_id = ${snapshotId}`
  return { rows: Number(counted.rows), nonZero: Object.fromEntries(columns.map((column, i) => [column, Number(counted[`c${i}`])])) }
}

/** The registry name of an app's dataset: `<app>.<dataset>`. */
export const datasetKey = (app: string, name: string) => `${app}.${name}`

const CHUNK = 2000
const registered = new Map<string, string[]>()

/**
 * Register the selected version of `app`'s datasets on the snapshot engine
 * (dataset-snapshot.ts), replacing whatever that app registered before. The
 * declaration is part of each snapshot's identity, so a changed query or
 * column never serves rows cut to the old one.
 */
export function registerAppDatasets(app: string, datasets: DatasetDeclaration[] = []): void {
  for (const key of registered.get(app) ?? []) unregisterDataset(key)
  registered.set(app, datasets.map((dataset) => datasetKey(app, dataset.name)))
  for (const dataset of datasets) {
    registerDataset<DatasetRow>({
      name: datasetKey(app, dataset.name),
      version: createHash('sha256').update(JSON.stringify(dataset)).digest('hex').slice(0, 16),
      async fetch() {
        return { rows: shapeRows(dataset, await runQuery(dataset)), sourceAsOf: null }
      },
      async load(snapshotId, rows) {
        for (let i = 0; i < rows.length; i += CHUNK)
          await sql`insert into app_dataset_row ${sql(rows.slice(i, i + CHUNK).map((row) => ({ snapshot_id: snapshotId, row: sql.json(row) })))}`
        return rows.length
      },
      async sizeOf(snapshotId) {
        const [size] = await sql`select coalesce(sum(pg_column_size(row)), 0) as bytes from app_dataset_row where snapshot_id = ${snapshotId}`
        return Number(size.bytes)
      },
      // An empty candidate is how a silent upstream failure looks; the last
      // good copy keeps serving instead. #669: so does one that fails a guard
      // the app declared, counted the same way in the candidate and the
      // active snapshot, from their stored rows.
      async validate(rowCount, previous, snapshotId) {
        if (rowCount === 0) return 'candidate is empty: the query returned no rows'
        if (!dataset.guard?.length) return null
        return guardRefusal(dataset.name, dataset.guard, await guardCounts(snapshotId, dataset.guard),
          previous ? await guardCounts(previous.row_id, dataset.guard) : null)
      },
    })
  }
}

/** #625: is `dataset` refreshable now? An app's dataset is only while its
 *  app is enabled and not mid-upgrade; any other dataset always is. */
export async function appDatasetServing(dataset: string): Promise<boolean> {
  const app = [...registered].find(([, keys]) => keys.includes(dataset))?.[0]
  if (!app) return true
  const [installed] = await sql`select enabled, activation_pending from installed_app where name = ${app}`
  return !!installed?.enabled && !installed.activation_pending
}

/** Forget every app's datasets (discovery starts again from nothing). */
export function forgetAppDatasets(): void {
  for (const app of [...registered.keys()]) registerAppDatasets(app)
  registered.clear()
}

/** What a dataset read answers, cached and live alike. */
export interface DatasetAnswer {
  dataset: string
  served: 'cached' | 'live'
  /** When the snapshot was activated, or when the live rows were fetched. */
  at: string
  rows: DatasetRow[]
}

/**
 * The rows a read may see: the reader's places through the declared
 * mapping, and the read's own filters on declared keys. A place is one
 * group; it contributes rows only when the dataset maps every filter the
 * place names, since a filter the dataset cannot apply would widen the
 * place. No place, no group, no row: the scope fails closed.
 */
export function datasetWhere(dataset: DatasetDeclaration, places: PersonScope | undefined, filters: unknown): DatasetWhere {
  if (filters !== undefined && (!filters || typeof filters !== 'object' || Array.isArray(filters)))
    throw new AppError('ValidationError', 'Dataset filters must be an object of key values')
  const all = Object.entries((filters ?? {}) as Record<string, unknown>).map(([key, value]) => {
    if (!dataset.keys.includes(key)) throw new AppError('ValidationError', `Dataset ${dataset.name} cannot be filtered on ${key}`)
    const list = Array.isArray(value) ? value : [value]
    if (!list.length || list.some((item) => typeof item !== 'string' && typeof item !== 'number'))
      throw new AppError('ValidationError', `Dataset filter ${key} must be a value or a list of values`)
    return { column: key, values: list.map(String) }
  })
  const any = (places ?? []).flatMap((place) => {
    const named = Object.entries(place.filters)
    if (named.some(([name]) => !Object.hasOwn(dataset.filters, name))) return []
    return [named.map(([name, values]) => ({ column: dataset.filters[name], values: [...values] }))]
  })
  return { any, all }
}

// The same where, over the snapshot's stored rows.
function storedRowsWhere(where: DatasetWhere) {
  const condition = (c: DatasetCondition) => (c.values.length ? sql`(row->>${c.column}) in ${sql(c.values)}` : sql`false`)
  const group = (conditions: DatasetCondition[]) => conditions.reduce((clause, c) => sql`${clause} and ${condition(c)}`, sql`true`)
  const any = where.any.length ? where.any.map((g) => sql`(${group(g)})`).reduce((clause, g) => sql`${clause} or ${g}`) : sql`false`
  return sql`(${any}) and (${group(where.all)})`
}

// One order for both answers: by each declared column in turn.
function ordered(dataset: DatasetDeclaration, rows: DatasetRow[]): DatasetRow[] {
  const compare = (a: DatasetValue, b: DatasetValue) => {
    if (a === b) return 0
    if (a === null) return -1
    if (b === null) return 1
    if (typeof a === 'number' && typeof b === 'number') return a - b
    return String(a) < String(b) ? -1 : 1
  }
  return rows.sort((a, b) => {
    for (const { name } of dataset.columns) {
      const order = compare(a[name], b[name])
      if (order) return order
    }
    return 0
  })
}

export interface DatasetReadRequest {
  app: string
  /** The read being answered, named in the Access Log when no dataset is. */
  operation: string
  /** The viewing person. */
  user: string
  title: string
  declarations: readonly DatasetDeclaration[]
  /** The reader's frozen places; none means no rows. */
  places: PersonScope | undefined
  /** Only an outbound read, which holds no transaction, may call the source. */
  outbound: boolean
  /** An outbound read holds its view records here until its answer: they
   *  are written with the final check that the app still serves the version
   *  the read ran under, under one lock, or not at all. */
  deferView?: (write: () => Promise<void>) => void
}

/**
 * `context.datasets` and `context.recordView` for one read: the app's own
 * datasets only, read through the reader's frozen places. No SQL crosses
 * from the app: it names a dataset and filter values, and the query is the
 * declared one.
 */
export function appDatasets({ app, operation, user, title, declarations, places, outbound, deferView }: DatasetReadRequest) {
  // What this read served, per dataset, for the Access Log: the platform
  // says what was served, never the app.
  const served = new Map<string, { served: DatasetAnswer['served']; snapshot?: string }>()
  async function declared(name: string): Promise<DatasetDeclaration> {
    const dataset = declarations.find((d) => d.name === name)
    if (!dataset) throw new AppError('ValidationError', `The app has not declared the dataset ${String(name)}`)
    const source = await getSource(dataset.source).catch(() => null)
    if (!source || !getDriver(source).query || !datasetSourceReadOnly(source)) {
      console.warn(`[apps] ${app} is not set up yet; its dataset ${dataset.name} needs the data source ${dataset.source}`)
      throw new AppError('NotSetUpError', `${title} is not set up yet. An administrator needs to finish setting it up.`)
    }
    return dataset
  }
  const datasets = Object.freeze({
    async active(name: string, filters?: unknown): Promise<DatasetAnswer | null> {
      const dataset = await declared(name)
      const where = datasetWhere(dataset, places, filters)
      const snapshot = await activeSnapshot(datasetKey(app, name))
      if (!snapshot) {
        await recordMiss(datasetKey(app, name))
        return null
      }
      const stored = await sql`select row from app_dataset_row where snapshot_id = ${snapshot.row_id} and ${storedRowsWhere(where)}`
      served.set(name, { served: 'cached', snapshot: snapshot.row_id })
      return { dataset: name, served: 'cached', at: new Date(snapshot.activated_at!).toISOString(),
        rows: ordered(dataset, stored.map((r) => r.row as DatasetRow)) }
    },
    // The same query, limited to the same rows, shaped by the same function.
    async live(name: string, filters?: unknown): Promise<DatasetAnswer> {
      if (!outbound) throw new AppError('ValidationError', 'A live dataset read calls out to its data source: declare the read outbound')
      const dataset = await declared(name)
      const where = datasetWhere(dataset, places, filters)
      const at = new Date().toISOString()
      const rows = shapeRows(dataset, await runQuery(dataset, where))
      served.set(name, { served: 'live' })
      return { dataset: name, served: 'live', at, rows: ordered(dataset, rows) }
    },
  })
  /** One Access Log row for the viewing person (#441): who looked at what,
   *  under which places, served from which snapshot or live. */
  async function recordView(details: unknown = {}): Promise<void> {
    const dataset = (details as { dataset?: unknown } | null)?.dataset
    if (!details || typeof details !== 'object' || Object.keys(details).some((key) => key !== 'dataset') ||
        (dataset !== undefined && !declarations.some((d) => d.name === dataset)))
      throw new AppError('ValidationError', "recordView takes { dataset } naming one of the app's datasets")
    const what = typeof dataset === 'string' ? served.get(dataset) : undefined
    const write = () => logAccess(user, 'view_report', {
      table: datasetKey(app, typeof dataset === 'string' ? dataset : operation),
      row_id: what?.snapshot,
      method: what?.served,
      scope: places ? places.map((place) => place.label).join('; ').slice(0, 140) : undefined,
      required: true,
    })
    if (deferView) deferView(write)
    else await write()
  }
  return { datasets, recordView }
}
