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
}).strict().superRefine((dataset, context) => {
  const types = new Map(dataset.columns.map(column => [column.name, column.type]))
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
      // good copy keeps serving instead.
      validate: (rowCount) => (rowCount === 0 ? 'candidate is empty: the query returned no rows' : null),
    })
  }
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
  /** An outbound read's check that its app still serves the version it ran
   *  under, before a view is recorded. */
  guard?: () => Promise<void>
}

/**
 * `context.datasets` and `context.recordView` for one read: the app's own
 * datasets only, read through the reader's frozen places. No SQL crosses
 * from the app: it names a dataset and filter values, and the query is the
 * declared one.
 */
export function appDatasets({ app, operation, user, title, declarations, places, outbound, guard }: DatasetReadRequest) {
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
    await guard?.()
    await logAccess(user, 'view_report', {
      table: datasetKey(app, typeof dataset === 'string' ? dataset : operation),
      row_id: what?.snapshot,
      method: what?.served,
      scope: places ? places.map((place) => place.label).join('; ').slice(0, 140) : undefined,
      required: true,
    })
  }
  return { datasets, recordView }
}
