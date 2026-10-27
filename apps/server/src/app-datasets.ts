// #625 (design E3, revised by ADR 0013): an app declares its cached datasets.
// Each names a Data Source the instance already declares (used read-only),
// the query, its typed columns (saying which are money), the keys a read may
// filter on, and the mapping from scope filter names (E1: `store`,
// `section`, ...) to query columns, so neither the app nor the platform
// hard-codes a client's column names in platform code.
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { sql } from './db'
import { registerDataset, unregisterDataset } from './dataset-snapshot'
import { getDriver, getSource } from './sources/registry'
import type { DatasetWhere } from './sources/types'

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

function shapeValue(type: DatasetDeclaration['columns'][number]['type'], value: unknown, column: string): DatasetValue {
  if (value === null || value === undefined) return null
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
      if (Number.isFinite(number) && (type !== 'integer' || Number.isInteger(number))) return number
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
  return raw.map((source) => {
    const row: DatasetRow = {}
    for (const { name, type } of dataset.columns) {
      if (!(name in source)) throw new Error(`Dataset ${dataset.name}'s query did not return column ${name}`)
      row[name] = shapeValue(type, source[name], name)
    }
    return row
  })
}

/** Run the declared query on its source, read-only, limited to `where`. */
async function runQuery(dataset: DatasetDeclaration, where?: DatasetWhere) {
  const source = await getSource(dataset.source)
  const driver = getDriver(source)
  if (!driver.query) throw new Error(`Data source ${dataset.source} (${source.engine}) cannot run a dataset query`)
  return driver.query(source, dataset.query, where)
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
