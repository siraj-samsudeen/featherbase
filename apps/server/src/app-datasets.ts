// #625 (design E3, revised by ADR 0013): an app declares its cached datasets.
// Each names a Data Source the instance already declares (used read-only),
// the query, its typed columns (saying which are money), the keys a read may
// filter on, and the mapping from scope filter names (E1: `store`,
// `section`, ...) to query columns, so neither the app nor the platform
// hard-codes a client's column names in platform code.
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { sql } from './db'
import type { PersonScope, ScopePlace } from 'shared'
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
export const DATASET_GUARD_KINDS = ['min_rows', 'not_all_zero', 'max_drop_pct', 'max_sum_drop_pct'] as const
/** A guarded column holds figures, so "zero" and "a drop" mean something. */
const GUARDABLE: readonly string[] = ['integer', 'number', 'money']

const guardSchema = z.object({
  kind: z.enum(DATASET_GUARD_KINDS, { errorMap: () => ({ message: `A dataset guard kind must be one of ${DATASET_GUARD_KINDS.join(', ')}` }) }),
  column: identifier.optional(),
  value: z.number().optional(),
  within: identifier.optional(),
}).strict().superRefine((guard, context) => {
  const issue = (message: string) => context.addIssue({ code: 'custom', message })
  // #676: a period bounds a comparison with the active snapshot; the absolute
  // checks compare nothing.
  if (guard.within !== undefined && guard.kind !== 'max_drop_pct' && guard.kind !== 'max_sum_drop_pct')
    issue(`A ${guard.kind} guard compares nothing with the active snapshot; only a drop guard compares within a column`)
  if (guard.kind === 'min_rows') {
    if (guard.column !== undefined) issue('A min_rows guard counts rows, so it names no column')
    if (guard.value === undefined || !Number.isInteger(guard.value) || guard.value < 0)
      issue('A min_rows value must be a whole number of rows, 0 or more')
    return
  }
  if (guard.column === undefined) issue(`A ${guard.kind} guard needs a column`)
  if (guard.kind === 'not_all_zero' && guard.value !== undefined) issue('A not_all_zero guard takes no value')
  // Whole percentages, so the limit is checked in integers, exactly.
  if (guard.kind !== 'not_all_zero' && (guard.value === undefined || !Number.isInteger(guard.value) || guard.value < 0 || guard.value > 100))
    issue(`A ${guard.kind} value must be a whole percentage from 0 to 100`)
})

export type DatasetGuard = z.infer<typeof guardSchema>

/** What a guard reads of a snapshot: its rows; per guarded column how many
 *  of its values are neither empty nor zero, and their exact total as decimal
 *  text; and per `within` column what values it holds. */
export interface GuardCounts {
  rows: number
  nonZero: Record<string, number>
  /** #676: SQL numeric sums, as text, so no total is ever a float. */
  sums: Record<string, string>
  periods: Record<string, GuardPeriod>
}

/** #676: what a snapshot holds in a `within` column: how many different
 *  values, how many rows have none, and the value when every row holds the
 *  same one (null otherwise). */
export interface GuardPeriod {
  distinct: number
  empty: number
  value: string | null
}

const whole = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 })
const percent = (value: number) => `${Math.round(value * 10) / 10}%`
/** A total keeps its paise: the same Indian grouping as `whole`, with up to
 *  two decimals. Formatted from its decimal text, so it is never rounded
 *  through a float. */
const total = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 })
const exactTotal = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 100 })
/** Two totals for a message: to the paisa, or in every digit when the paisa
 *  cannot tell them apart. */
function formatTotals(before: string, now: string): string {
  const [b, n] = [before, now].map(decimal => total.format(decimal as unknown as number))
  if (b !== n) return `${b} → ${n}`
  return `${exactTotal.format(before as unknown as number)} → ${exactTotal.format(now as unknown as number)}`
}

/** #676: a decimal text as an integer count of 10^-scale units. */
function scaled(decimal: string, scale: number): bigint {
  const [, sign, digits, fraction = ''] = /^(-?)(\d+)(?:\.(\d+))?$/.exec(decimal.trim()) ?? []
  if (digits === undefined) throw new Error(`not a decimal total: ${decimal}`)
  const units = BigInt(digits + fraction.padEnd(scale, '0'))
  return sign ? -units : units
}
const scaleOf = (decimal: string) => decimal.split('.')[1]?.length ?? 0

/**
 * #676: the drop from `before` to `now`, both decimal text, against a whole
 * percentage `limit`, decided in integers: both totals are scaled to the
 * same whole number of units, so neither 0.1 + 0.2 nor 0.57 * 100 can move
 * the boundary. Null when the drop is within the limit; otherwise the drop
 * in words, to a tenth, or "more than" the limit when a tenth cannot show it.
 */
function sumDrop(before: string, now: string, limit: number): string | null {
  const scale = Math.max(scaleOf(before), scaleOf(now))
  const b = scaled(before, scale)
  const n = scaled(now, scale)
  if (n * 100n >= b * BigInt(100 - limit)) return null
  const tenths = ((b - n) * 2000n + b) / (2n * b)  // rounded half up; b > 0
  if (tenths <= BigInt(limit * 10)) return `more than ${limit}%`
  return `${tenths / 10n}${tenths % 10n ? `.${tenths % 10n}` : ''}%`
}

/**
 * #669: the first of `guards` that the candidate fails, said in words that
 * name the dataset, the guard and the numbers; null when every guard passes.
 * A drop is measured against the active snapshot, so a first refresh, with
 * none to compare, cannot fail one.
 *
 * #676: a drop guard `within` a column compares only when the candidate and
 * the active snapshot each hold one and the same value there, so a new
 * period starts without a baseline. A candidate that is not one period is
 * refused; an active snapshot that is not one is no baseline.
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
    let baseline = previous
    if (guard.within) {
      const period = candidate.periods[guard.within]
      if (period.distinct !== 1 || period.empty !== 0)
        return `${dataset}: ${guard.within} holds ${whole.format(period.distinct)} value${period.distinct === 1 ? '' : 's'} and ${whole.format(period.empty)} empty, but ${column} is compared within one ${guard.within}`
      if (previous?.periods[guard.within].value !== period.value) baseline = null
    }
    if (guard.kind === 'max_sum_drop_pct') {
      const before = baseline?.sums[column]
      // A drop is a share of a positive total: from zero or below there is
      // no share to take, so there is nothing to compare.
      if (before === undefined || scaled(before, scaleOf(before)) <= 0n) continue
      const drop = sumDrop(before, candidate.sums[column], guard.value!)
      if (drop) return `${dataset}: ${column} total dropped ${drop} (${formatTotals(before, candidate.sums[column])}), limit ${percent(guard.value!)}`
      continue
    }
    const before = baseline?.nonZero[column]
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
  // #676: a period is compared as text, like a key, so it takes a key's types.
  for (const { within } of dataset.guard ?? []) {
    if (within === undefined) continue
    if (!types.has(within)) context.addIssue({ code: 'custom', message: `Dataset ${dataset.name}'s guard within column ${within} is not one of its columns` })
    else if (!FILTERABLE.includes(types.get(within)!))
      context.addIssue({ code: 'custom', message: `Dataset ${dataset.name}'s guard within column ${within} must be text, integer or date` })
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

/** #676: a source's decimal text as a JSON number literal, digit for digit;
 *  null when it is not plain decimal text. */
function decimalLiteral(text: string): string | null {
  const [, sign, whole = '', fraction = '', exponent] = /^\s*([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?\s*$/.exec(text) ?? []
  if (sign === undefined || !(whole + fraction)) return null
  return `${sign === '-' ? '-' : ''}${whole.replace(/^0+(?=\d)/, '') || '0'}${fraction ? `.${fraction}` : ''}${exponent ? `e${exponent}` : ''}`
}

/**
 * #676: the rows a snapshot stores, as JSON text. Each is the shaped row,
 * except that a money or number figure is written with the digits its
 * source gave, so the stored copy keeps what a JavaScript number cannot and
 * the guards' SQL numeric sums are exact. Parsed, it is the shaped row: a
 * cached read answers the same numbers a live read does.
 */
export function storedRowJson(dataset: DatasetDeclaration, raw: Record<string, unknown>[]): string[] {
  const shaped = shapeRows(dataset, raw)
  return shaped.map((row, i) => `{${dataset.columns.map(({ name, type }) => {
    const value = raw[i][name]
    const exact = (type === 'money' || type === 'number') && typeof value === 'string' ? decimalLiteral(value) : null
    return `${JSON.stringify(name)}:${exact ?? JSON.stringify(row[name])}`
  }).join(',')}}`)
}

/** Run the declared query on its source, read-only, limited to `where`. */
async function runQuery(dataset: DatasetDeclaration, where?: DatasetWhere) {
  const source = await getSource(dataset.source)
  const driver = getDriver(source)
  if (!driver.query) throw new Error(`Data source ${dataset.source} (${source.engine}) cannot run a dataset query`)
  return driver.query(source, dataset.query, dataset.columns, where)
}

/** The whitespace a JavaScript trim removes, as a Postgres regex class:
 *  `\s` alone is locale-dependent in Postgres and misses U+00A0. */
const SPACE = '[\\s\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]'
const TRIM = `^${SPACE}+|${SPACE}+$`

/**
 * #676 (Codex rounds 1 and 2): the one definition of a stored row's period,
 * read by every period aggregate: its text, trimmed of whitespace, and null
 * when nothing is left. So a blank period is a missing one, never a new one,
 * and a padded period (a source's char(n), say) is the period it pads. Text
 * shaping does not trim, so this is the only place "blank" is defined.
 */
const periodValue = (column: string) => sql`nullif(regexp_replace(row->>${column}, ${TRIM}, '', 'g'), '')`

/**
 * A stored snapshot's counts for its guards, in one pass over its rows.
 * #676: a total is summed in SQL numeric from each value's JSON decimal
 * text and returned as text, so it is exact; a period is read as text, as
 * the snapshot stores it.
 */
async function guardCounts(snapshotId: string, guards: readonly DatasetGuard[]): Promise<GuardCounts> {
  const columns = [...new Set(guards.flatMap((guard) => (guard.column ? [guard.column] : [])))]
  const periods = [...new Set(guards.flatMap((guard) => (guard.within ? [guard.within] : [])))]
  const parts = [
    ...columns.map((column, i) => sql`, count(*) filter (where coalesce((row->>${column})::numeric, 0) <> 0) as ${sql(`c${i}`)}
      , coalesce(sum((row->>${column})::numeric), 0)::text as ${sql(`s${i}`)}`),
    ...periods.map((column, i) => {
      const period = periodValue(column)
      return sql`, count(distinct ${period}) as ${sql(`pd${i}`)}
        , count(*) filter (where ${period} is null) as ${sql(`pe${i}`)}, min(${period}) as ${sql(`pv${i}`)}`
    }),
  ]
  const [counted] = await sql`
    select count(*) as rows ${parts.length ? parts.reduce((all, one) => sql`${all} ${one}`) : sql``}
    from app_dataset_row where snapshot_id = ${snapshotId}`
  return {
    rows: Number(counted.rows),
    nonZero: Object.fromEntries(columns.map((column, i) => [column, Number(counted[`c${i}`])])),
    sums: Object.fromEntries(columns.map((column, i) => [column, String(counted[`s${i}`])])),
    periods: Object.fromEntries(periods.map((column, i) => {
      const distinct = Number(counted[`pd${i}`])
      const empty = Number(counted[`pe${i}`])
      return [column, { distinct, empty, value: distinct === 1 && empty === 0 ? String(counted[`pv${i}`]) : null }]
    })),
  }
}

/** The registry name of an app's dataset: `<app>.<dataset>`. */
export const datasetKey = (app: string, name: string) => `${app}.${name}`

const CHUNK = 2000
const registered = new Map<string, string[]>()

/**
 * Register the selected version of `app`'s datasets on the snapshot engine
 * (dataset-snapshot.ts), replacing whatever that app registered before. The
 * declaration is part of each snapshot's identity, so a changed query or
 * column never serves rows cut to the old one. Its guard is not (#669): a
 * guard decides which refresh may replace the copy, not what the copy holds,
 * so an upgrade that adds or tunes one keeps the copy and checks against it.
 */
export function registerAppDatasets(app: string, datasets: DatasetDeclaration[] = []): void {
  for (const key of registered.get(app) ?? []) unregisterDataset(key)
  registered.set(app, datasets.map((dataset) => datasetKey(app, dataset.name)))
  for (const dataset of datasets) {
    registerDataset<string>({
      name: datasetKey(app, dataset.name),
      version: createHash('sha256').update(JSON.stringify({ ...dataset, guard: undefined })).digest('hex').slice(0, 16),
      async fetch() {
        return { rows: storedRowJson(dataset, await runQuery(dataset)), sourceAsOf: null }
      },
      async load(snapshotId, rows) {
        for (let i = 0; i < rows.length; i += CHUNK)
          await sql`insert into app_dataset_row (snapshot_id, row)
            select ${snapshotId}, value::jsonb from unnest(${rows.slice(i, i + CHUNK)}::text[]) as value`
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
    if (unappliableKeys(dataset, place).length) return []
    return [Object.entries(place.filters).map(([name, values]) => ({ column: dataset.filters[name], values: [...values] }))]
  })
  return { any, all }
}

/** #667: the filter keys a place names that the dataset maps to no column,
 *  sorted. Any one drops the whole place from the dataset (fail closed). */
export function unappliableKeys(dataset: DatasetDeclaration, place: ScopePlace): string[] {
  return Object.keys(place.filters).filter((name) => !Object.hasOwn(dataset.filters, name)).sort()
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
  /** #667: the instance's scope provider, named when a place is dropped. */
  scopeProvider?: () => Promise<{ app: string; version: string } | undefined>
}

/** How long a recorded drop stands before a read records it again. */
const DROP_RECORD_INTERVAL = '1 hour'

/**
 * #667: record that `places` hold some a dataset cannot apply, by the keys it
 * cannot apply: never the person, the place or a value. A drop already
 * recorded under the same versions within the last hour is not written again,
 * so a busy report reads one row and writes nothing.
 */
async function recordPlaceDrops(app: string, dataset: DatasetDeclaration, places: PersonScope | undefined,
  scopeProvider: DatasetReadRequest['scopeProvider']): Promise<void> {
  const keySets = new Map<string, string[]>()
  for (const place of places ?? []) {
    const keys = unappliableKeys(dataset, place)
    if (keys.length) keySets.set(keys.join(','), keys)
  }
  if (!keySets.size) return
  const provider = await scopeProvider?.()
  if (!provider) return
  const [installed] = await sql`select package_version from installed_app where name = ${app}`
  const version = String(installed?.package_version ?? '')
  for (const keys of keySets.values()) {
    const [fresh] = await sql`select 1 from dataset_place_drop
      where app = ${app} and dataset = ${dataset.name} and provider = ${provider.app} and filter_keys = ${keys}
        and app_version = ${version} and provider_version = ${provider.version}
        and last_seen > now() - ${DROP_RECORD_INTERVAL}::interval`
    if (fresh) continue
    await sql`insert into dataset_place_drop (app, dataset, provider, filter_keys, app_version, provider_version)
      values (${app}, ${dataset.name}, ${provider.app}, ${keys}, ${version}, ${provider.version})
      on conflict (app, dataset, provider, filter_keys) do update set last_seen = now(),
        app_version = excluded.app_version, provider_version = excluded.provider_version`
  }
}

/**
 * `context.datasets` and `context.recordView` for one read: the app's own
 * datasets only, read through the reader's frozen places. No SQL crosses
 * from the app: it names a dataset and filter values, and the query is the
 * declared one.
 */
export function appDatasets({ app, operation, user, title, declarations, places, outbound, deferView, scopeProvider }: DatasetReadRequest) {
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
      await recordPlaceDrops(app, dataset, places, scopeProvider)
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
      await recordPlaceDrops(app, dataset, places, scopeProvider)
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
