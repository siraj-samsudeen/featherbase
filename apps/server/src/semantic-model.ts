// An app's semantic models: what its datasets mean, so a question can be
// answered from them without anyone writing a query. A model names one of the
// app's datasets, the columns a person may group or filter by (dimensions),
// the figures that add up (measures), the figures worked out from those
// (metrics), and a few questions with the plan that answers each.
//
// A plan is data, never SQL: it names measures, dimensions and filter values
// from one model. It is checked against the model and run over rows the
// platform has already limited to the reader's places, so a plan can ask for
// less than the reader may see and never for more.
import { z } from 'zod'
import { AppError } from './errors'
import type { DatasetDeclaration, DatasetRow, DatasetValue } from './app-datasets'

const identifier = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/)
const distinct = (values: string[]) => new Set(values).size === values.length
const words = z.string().min(1).max(140)

export const MEASURE_AGGREGATES = ['sum', 'min', 'max', 'avg'] as const
/** A measure adds figures up, so its column holds figures. */
const MEASURABLE: readonly string[] = ['integer', 'number', 'money']
export const MAX_PLAN_ROWS = 1000

const planSchema = z.object({
  /** Measures and metrics to answer with, in column order. */
  measures: z.array(identifier).min(1).refine(distinct, 'A plan names each measure once'),
  groupBy: z.array(identifier).refine(distinct, 'A plan groups by each dimension once').optional(),
  filters: z.array(z.object({ dimension: identifier, in: z.array(z.string()).min(1) }).strict()).optional(),
  /** Keeps only the answered rows whose figure passes, such as a gap below 0. A row with no figure never passes. */
  having: z.array(z.object({ measure: identifier, is: z.enum(['below', 'above', 'at_most', 'at_least']), value: z.number() }).strict()).optional(),
  order: z.array(z.tuple([identifier, z.enum(['asc', 'desc'])])).optional(),
  limit: z.number().int().min(1).max(MAX_PLAN_ROWS).optional(),
}).strict()
export type AnalysisPlan = z.infer<typeof planSchema>

/** The name a relationship's `on` gives a Table's own row. */
export const ROW_ID = 'row_id'

// A many-to-one lookup from the dataset's rows (or from an earlier
// relationship's rows) into one of the app's Tables, as a semantic view's
// relationships are: each row finds at most one row of the Table.
const relationshipSchema = z.object({
  name: identifier,
  /** The earlier relationship this one starts from; left out, it starts from the dataset. */
  from: identifier.optional(),
  table: z.string().min(1),
  /** Each column on the starting side, and the Table column it equals (`row_id` for the Table's row). */
  on: z.record(identifier, identifier).refine(on => Object.keys(on).length > 0, 'A relationship joins on at least one column'),
  /** Date columns that say when a row of the Table applies; only a row that applies on the figures' day is found. */
  current: z.object({ from: identifier, to: identifier }).strict().optional(),
}).strict()

const modelSchema = z.object({
  name: identifier,
  description: z.string().min(1).max(500).optional(),
  dataset: identifier,
  /** The declared read whose policy decides who may ask, and of which places. */
  read: z.string().min(1),
  /** A date column saying how recent the figures are (such as the day they run to). */
  asOf: identifier.optional(),
  relationships: z.array(relationshipSchema).optional(),
  /** A dimension is a dataset column, or with `relationship` a column of that relationship's Table. */
  dimensions: z.array(z.object({ name: identifier, column: identifier, relationship: identifier.optional(),
    description: words.optional(), synonyms: z.array(words).optional() }).strict()),
  measures: z.array(z.object({ name: identifier, column: identifier, aggregate: z.enum(MEASURE_AGGREGATES),
    /** Counts only rows whose columns hold these values, such as last month's rows: { months_ago: 1 }. */
    where: z.record(identifier, z.union([z.string(), z.number()])).refine(where => Object.keys(where).length > 0, 'A measure\'s where names at least one column').optional(),
    description: words.optional(), synonyms: z.array(words).optional() }).strict()).min(1),
  metrics: z.array(z.object({ name: identifier, expression: z.string().min(1).max(300), unit: z.enum(['percent']).optional(),
    description: words.optional(), synonyms: z.array(words).optional() }).strict()).optional(),
  verified: z.array(z.object({ question: z.string().min(1).max(300), plan: planSchema }).strict()).optional(),
}).strict()
export type SemanticModel = z.infer<typeof modelSchema>

/** The manifest's `semantic`. */
export const semanticDeclaration = z.object({
  models: z.array(modelSchema).min(1).refine(models => distinct(models.map(model => model.name)), 'Semantic model names must be distinct'),
}).strict()
export type SemanticDeclaration = z.infer<typeof semanticDeclaration>

// ---- metric expressions: + - * / and brackets over measures and numbers ----

type Expression =
  | { kind: 'number'; value: number }
  | { kind: 'measure'; name: string }
  | { kind: 'negate'; of: Expression }
  | { kind: 'binary'; operator: '+' | '-' | '*' | '/'; left: Expression; right: Expression }

/** Parses a metric's expression. Throws an Error that says what is wrong. */
export function parseExpression(text: string): Expression {
  const tokens = text.match(/\s*(\d+(?:\.\d+)?|[a-z][a-z0-9_]*|[-+*/()]|\S)/g)?.map(token => token.trim()) ?? []
  let at = 0
  const fail = (): never => { throw new Error(`"${text}" is not an expression of measures, numbers, + - * / and brackets`) }
  function atom(): Expression {
    const token = tokens[at++]
    if (token === undefined) return fail()
    if (token === '(') {
      const inner = sum()
      if (tokens[at++] !== ')') fail()
      return inner
    }
    if (token === '-') return { kind: 'negate', of: atom() }
    if (/^\d/.test(token)) return { kind: 'number', value: Number(token) }
    if (/^[a-z]/.test(token)) return { kind: 'measure', name: token }
    return fail()
  }
  function product(): Expression {
    let left = atom()
    while (tokens[at] === '*' || tokens[at] === '/') left = { kind: 'binary', operator: tokens[at++] as '*' | '/', left, right: atom() }
    return left
  }
  function sum(): Expression {
    let left = product()
    while (tokens[at] === '+' || tokens[at] === '-') left = { kind: 'binary', operator: tokens[at++] as '+' | '-', left, right: product() }
    return left
  }
  const parsed = sum()
  if (at !== tokens.length) fail()
  return parsed
}

function namedMeasures(expression: Expression): string[] {
  if (expression.kind === 'measure') return [expression.name]
  if (expression.kind === 'negate') return namedMeasures(expression.of)
  if (expression.kind === 'binary') return [...namedMeasures(expression.left), ...namedMeasures(expression.right)]
  return []
}

// A figure that is missing, or divided by nothing, has no answer: it is
// null, never zero and never infinity.
function evaluate(expression: Expression, measures: Map<string, number | null>): number | null {
  if (expression.kind === 'number') return expression.value
  if (expression.kind === 'measure') return measures.get(expression.name) ?? null
  if (expression.kind === 'negate') {
    const value = evaluate(expression.of, measures)
    return value === null ? null : -value
  }
  const left = evaluate(expression.left, measures)
  const right = evaluate(expression.right, measures)
  if (left === null || right === null) return null
  if (expression.operator === '+') return left + right
  if (expression.operator === '-') return left - right
  if (expression.operator === '*') return left * right
  return right === 0 ? null : left / right
}

// ---- checking ----

/** What is wrong with a plan for this model, in plain words; null when nothing is. */
export function planFault(model: SemanticModel, plan: AnalysisPlan): string | null {
  const dimensions = new Set(model.dimensions.map(dimension => dimension.name))
  const figures = new Set([...model.measures.map(measure => measure.name), ...(model.metrics ?? []).map(metric => metric.name)])
  for (const name of plan.measures) if (!figures.has(name)) return `${model.name} has no measure or metric named ${name}`
  for (const name of plan.groupBy ?? []) if (!dimensions.has(name)) return `${model.name} has no dimension named ${name}`
  for (const filter of plan.filters ?? []) if (!dimensions.has(filter.dimension)) return `${model.name} has no dimension named ${filter.dimension}`
  for (const { measure } of plan.having ?? []) if (!plan.measures.includes(measure)) return `A plan keeps rows by a figure it answers with, and ${measure} is not in it`
  const answered = new Set([...plan.measures, ...(plan.groupBy ?? [])])
  for (const [name] of plan.order ?? []) if (!answered.has(name)) return `A plan orders by what it answers with, and ${name} is not in it`
  return null
}

/**
 * Checks an app's semantic models against the rest of its manifest. Throws
 * an Error naming the first thing wrong, as the other manifest checks do.
 */
export function validateSemantic(semantic: SemanticDeclaration | undefined, datasets: readonly DatasetDeclaration[] = [],
  reads: Record<string, { policy: { kind: string }; outbound?: boolean }> = {},
  tables: readonly { name: string; columns: readonly { column_name: string }[] }[] = []): void {
  for (const model of semantic?.models ?? []) {
    const wrong = (message: string): never => { throw new Error(`Semantic model ${model.name}: ${message}`) }
    const dataset = datasets.find(candidate => candidate.name === model.dataset)
    if (!dataset) { wrong(`the app declares no dataset named ${model.dataset}`); continue }
    const read = Object.hasOwn(reads, model.read) ? reads[model.read] : undefined
    if (!read) { wrong(`the app declares no read named ${model.read}`); continue }
    // The reader's places limit the rows, so only a read that takes them will do.
    if (read.policy.kind !== 'person_scope') wrong(`its read ${model.read} must have the person_scope policy`)
    if (read.outbound) wrong(`its read ${model.read} must not be outbound: a model is answered from the cached dataset`)
    const types = new Map(dataset.columns.map(column => [column.name, column.type]))
    if (model.asOf && types.get(model.asOf) !== 'date') wrong(`its asOf column ${model.asOf} must be one of ${dataset.name}'s date columns`)
    const metrics = model.metrics ?? []
    if (!distinct([...model.dimensions, ...model.measures, ...metrics].map(part => part.name)))
      wrong('dimension, measure and metric names must be distinct')
    // Each relationship's Table columns, by the relationship's name, as they are checked in order.
    const joined = new Map<string, Set<string>>()
    for (const relationship of model.relationships ?? []) {
      const about = `relationship ${relationship.name}`
      if (joined.has(relationship.name)) wrong('relationship names must be distinct')
      const table = tables.find(candidate => candidate.name === relationship.table)
      if (!table) { wrong(`${about}: the app declares no Table named ${relationship.table}`); continue }
      const columns = new Set([ROW_ID, ...table.columns.map(column => column.column_name)])
      const start = relationship.from === undefined ? new Set(types.keys()) : joined.get(relationship.from)
      if (!start) { wrong(`${about} starts from ${relationship.from}, which is not a relationship declared before it`); continue }
      for (const [source, target] of Object.entries(relationship.on)) {
        if (!start.has(source)) wrong(`${about} joins on ${source}, which is not a column where it starts`)
        if (!columns.has(target)) wrong(`${about} joins on ${target}, which is not one of ${relationship.table}'s columns`)
      }
      for (const column of relationship.current ? [relationship.current.from, relationship.current.to] : [])
        if (!columns.has(column)) wrong(`${about}: ${column} is not one of ${relationship.table}'s columns`)
      joined.set(relationship.name, columns)
    }
    for (const dimension of model.dimensions) {
      if (dimension.relationship === undefined) {
        if (!types.has(dimension.column)) wrong(`dimension ${dimension.name}'s column ${dimension.column} is not one of ${dataset.name}'s columns`)
      } else if (!joined.has(dimension.relationship)) wrong(`dimension ${dimension.name} names ${dimension.relationship}, which is not one of the model's relationships`)
      else if (!joined.get(dimension.relationship)!.has(dimension.column)) wrong(`dimension ${dimension.name}'s column ${dimension.column} is not one of its relationship's Table columns`)
    }
    for (const measure of model.measures) {
      if (!types.has(measure.column)) wrong(`measure ${measure.name}'s column ${measure.column} is not one of ${dataset.name}'s columns`)
      else if (!MEASURABLE.includes(types.get(measure.column)!)) wrong(`measure ${measure.name}'s column ${measure.column} must be integer, number or money`)
      for (const column of Object.keys(measure.where ?? {}))
        if (!types.has(column)) wrong(`measure ${measure.name} counts where ${column}, which is not one of ${dataset.name}'s columns`)
    }
    const measures = new Set(model.measures.map(measure => measure.name))
    for (const metric of metrics) {
      let expression: Expression
      try { expression = parseExpression(metric.expression) } catch (error) { wrong(`metric ${metric.name}: ${(error as Error).message}`); continue }
      const unknown = namedMeasures(expression).find(name => !measures.has(name))
      if (unknown) wrong(`metric ${metric.name} names ${unknown}, which is not one of the model's measures`)
    }
    for (const { question, plan } of model.verified ?? []) {
      const fault = planFault(model, plan)
      if (fault) wrong(`the plan for "${question}" is wrong: ${fault}`)
    }
  }
}

// ---- a first draft ----

/**
 * A first draft of a semantic model for one dataset, from its declared
 * columns, for a developer to correct: it knows nothing of what the figures
 * mean. A column of figures becomes a measure that adds up; every other
 * column becomes a dimension. A `_name` column is called by its stem
 * (`store_name` is `store`), and a `_code` column is left out when the same
 * stem has a name. A key or scope column is an identifier, never a figure.
 * Throws when the dataset has no column of figures.
 */
export function draftModel(dataset: DatasetDeclaration, read: string): SemanticModel {
  const columns = new Set(dataset.columns.map(column => column.name))
  const identifiers = new Set([...dataset.keys, ...Object.values(dataset.filters)])
  const figures = dataset.columns.filter(column => MEASURABLE.includes(column.type) && !identifiers.has(column.name))
  if (!figures.length) throw new Error(`Dataset ${dataset.name} has no column of figures to draft a measure from`)
  const stem = (name: string, ending: string) => name.endsWith(ending) ? name.slice(0, -ending.length) : undefined
  const dimensions = dataset.columns.filter(column => !figures.includes(column)).flatMap((column) => {
    const coded = stem(column.name, '_code')
    if (coded && (columns.has(coded) || columns.has(`${coded}_name`))) return []
    const named = stem(column.name, '_name')
    return [{ name: named && !columns.has(named) ? named : column.name, column: column.name }]
  })
  return { name: dataset.name, description: `A first draft from ${dataset.name}'s columns. Check each name and say what each figure means.`,
    dataset: dataset.name, read, dimensions, measures: figures.map(column => ({ name: column.name, column: column.name, aggregate: 'sum' as const })) }
}

// ---- answering ----

export interface AnalysisColumn {
  name: string
  kind: 'dimension' | 'measure' | 'metric'
  unit?: 'percent'
  /** How a figure was worked out, in the model's words: a measure's aggregate and column, a metric's expression. */
  definition?: string
}
export interface Analysis {
  model: string
  columns: AnalysisColumn[]
  rows: DatasetValue[][]
  /** True when `limit` (or the platform's ceiling) cut rows off. */
  truncated: boolean
  /** The latest day in the model's asOf column among the rows answered, when the model has one. */
  asOf?: string | null
  /** Filter values that match nothing the asker may see, so an empty answer says why. */
  unmatched?: { dimension: string; value: string }[]
}

// Where a dimension's value sits in a row: a dataset column, or a joined column under its relationship's name.
export const dimensionKey = (dimension: SemanticModel['dimensions'][number]) =>
  dimension.relationship === undefined ? dimension.column : `${dimension.relationship}.${dimension.column}`

const asDay = (value: unknown): string | null =>
  value === null || value === undefined ? null : value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10)
const asValue = (value: unknown): DatasetValue =>
  value === null || value === undefined ? null : typeof value === 'number' || typeof value === 'boolean' ? value
    : value instanceof Date ? value.toISOString().slice(0, 10) : String(value)

/**
 * Follows the model's relationships from rows already limited to the asker's
 * places, adding each found Table row's columns under the relationship's name
 * (`section.section_name`). It only labels rows the asker may already see: it
 * adds no row, and a row that finds nothing keeps no joined columns. `load`
 * gives a Table's rows, each with its `row_id`; `today` is the day used when
 * the model has no asOf column.
 */
export async function joinRows(model: SemanticModel, rows: readonly DatasetRow[],
  load: (table: string) => Promise<readonly Record<string, unknown>[]>, today: string): Promise<DatasetRow[]> {
  let joined = [...rows]
  for (const relationship of model.relationships ?? []) {
    const pairs = Object.entries(relationship.on)
    const found = new Map<string, Record<string, unknown>[]>()
    for (const target of await load(relationship.table)) {
      const key = JSON.stringify(pairs.map(([, column]) => String(target[column])))
      found.set(key, [...(found.get(key) ?? []), target])
    }
    const prefix = relationship.from === undefined ? '' : `${relationship.from}.`
    joined = joined.map((row) => {
      const values = pairs.map(([source]) => row[`${prefix}${source}`])
      if (values.some(value => value === null || value === undefined)) return row
      const day = model.asOf && typeof row[model.asOf] === 'string' ? row[model.asOf] as string : today
      const match = (found.get(JSON.stringify(values.map(String))) ?? []).find((target) => {
        if (!relationship.current) return true
        const [starts, ends] = [asDay(target[relationship.current.from]), asDay(target[relationship.current.to])]
        return (starts === null || starts <= day) && (ends === null || ends >= day)
      })
      return match ? { ...row, ...Object.fromEntries(Object.entries(match).map(([column, value]) => [`${relationship.name}.${column}`, asValue(value)])) } : row
    })
  }
  return joined
}

// Names are matched as people type them: capitals and surrounding spaces do not matter.
const sameName = (value: DatasetValue) => String(value).trim().toLowerCase()

export const MAX_DIMENSION_VALUES = 200

/**
 * The asker's own values of each dimension, from rows already limited to
 * their places, so a language model can spell a filter the way the data does.
 * A dimension with more than `max` values is left out: listing it would cost
 * more than it helps.
 */
export function dimensionValues(model: SemanticModel, rows: readonly DatasetRow[], max = MAX_DIMENSION_VALUES): Record<string, string[]> {
  const values: Record<string, string[]> = {}
  for (const dimension of model.dimensions) {
    const seen = new Set(rows.map(row => row[dimensionKey(dimension)]).filter(value => value !== null && value !== undefined).map(String))
    if (seen.size && seen.size <= max) values[dimension.name] = [...seen].sort()
  }
  return values
}

// What a figure means, said once with the figure so an answer never needs
// the model beside it to be read.
export function measureHow(measure: SemanticModel['measures'][number]): string {
  const where = Object.entries(measure.where ?? {}).map(([column, value]) => `${column} is ${value}`)
  return `${measure.aggregate} of ${measure.column}${where.length ? ` where ${where.join(' and ')}` : ''}`
}
function measureDefinition(measure: SemanticModel['measures'][number]): string {
  const how = measureHow(measure)
  return measure.description ? `${measure.description} (${how})` : how
}
function metricDefinition(metric: NonNullable<SemanticModel['metrics']>[number]): string {
  return metric.description ? `${metric.description}: ${metric.expression}` : metric.expression
}

// Sums of decimal figures pick up binary noise (0.1 + 0.2); six places is
// finer than any figure a dataset holds and coarser than the noise.
export const tidy = (value: number) => Math.round(value * 1e6) / 1e6

function aggregate(kind: SemanticModel['measures'][number]['aggregate'], values: number[]): number | null {
  if (!values.length) return null
  if (kind === 'min') return Math.min(...values)
  if (kind === 'max') return Math.max(...values)
  const total = values.reduce((sum, value) => sum + value, 0)
  return tidy(kind === 'avg' ? total / values.length : total)
}

function compare(a: DatasetValue, b: DatasetValue): number {
  if (a === b) return 0
  if (a === null) return 1
  if (b === null) return -1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a) < String(b) ? -1 : 1
}

const PASSES = {
  below: (figure: number, value: number) => figure < value,
  above: (figure: number, value: number) => figure > value,
  at_most: (figure: number, value: number) => figure <= value,
  at_least: (figure: number, value: number) => figure >= value,
}

/** Reads a request's plan. A malformed or mistaken plan is refused, never repaired. */
export function readPlan(model: SemanticModel, input: unknown): AnalysisPlan {
  const parsed = planSchema.safeParse(input)
  if (!parsed.success) throw new AppError('ValidationError', `That plan is not one this can run: ${parsed.error.issues[0].message}`)
  const fault = planFault(model, parsed.data)
  if (fault) throw new AppError('ValidationError', fault)
  return parsed.data
}

/**
 * Answers a plan from rows the caller has already limited to the reader's
 * places. With nothing to group by, the answer is one row over every row.
 */
export function runPlan(model: SemanticModel, rows: readonly DatasetRow[], plan: AnalysisPlan): Analysis {
  const dimensions = new Map(model.dimensions.map(dimension => [dimension.name, dimension]))
  const measures = new Map(model.measures.map(measure => [measure.name, measure]))
  const metrics = new Map((model.metrics ?? []).map(metric => [metric.name, { ...metric, parsed: parseExpression(metric.expression) }]))
  const groupBy = plan.groupBy ?? []

  const wanted = (plan.filters ?? []).map(filter => ({ column: dimensionKey(dimensions.get(filter.dimension)!), names: new Set(filter.in.map(sameName)) }))
  const has = (row: DatasetRow, column: string) => row[column] !== null && row[column] !== undefined
  const kept = rows.filter(row => wanted.every(({ column, names }) => has(row, column) && names.has(sameName(row[column]))))
  const unmatched = (plan.filters ?? []).flatMap(filter => {
    const column = dimensionKey(dimensions.get(filter.dimension)!)
    const present = new Set(rows.filter(row => has(row, column)).map(row => sameName(row[column])))
    return filter.in.filter(value => !present.has(sameName(value))).map(value => ({ dimension: filter.dimension, value }))
  })

  const groups = new Map<string, { key: DatasetValue[]; rows: DatasetRow[] }>()
  if (!groupBy.length) groups.set('', { key: [], rows: kept })
  for (const row of groupBy.length ? kept : []) {
    const key = groupBy.map(name => row[dimensionKey(dimensions.get(name)!)] ?? null)
    const id = JSON.stringify(key)
    const group = groups.get(id) ?? { key, rows: [] }
    group.rows.push(row)
    groups.set(id, group)
  }

  const columns: AnalysisColumn[] = [
    ...groupBy.map((name): AnalysisColumn => ({ name, kind: 'dimension' })),
    ...plan.measures.map((name): AnalysisColumn => measures.has(name) ? { name, kind: 'measure', definition: measureDefinition(measures.get(name)!) }
      : { name, kind: 'metric', ...(metrics.get(name)!.unit ? { unit: metrics.get(name)!.unit } : {}), definition: metricDefinition(metrics.get(name)!) }),
  ]
  const answered = [...groups.values()].map(group => {
    const figures = new Map([...measures.values()].map((measure) => {
      const where = Object.entries(measure.where ?? {})
      const counted = where.length ? group.rows.filter(row => where.every(([column, value]) => has(row, column) && String(row[column]) === String(value))) : group.rows
      return [measure.name, aggregate(measure.aggregate, counted.map(row => row[measure.column]).filter((value): value is number => typeof value === 'number'))] as [string, number | null]
    }))
    return [...group.key, ...plan.measures.map(name => {
      if (measures.has(name)) return figures.get(name) ?? null
      const value = evaluate(metrics.get(name)!.parsed, figures)
      return value === null ? null : tidy(value)
    })]
  })

  const position = new Map(columns.map((column, index) => [column.name, index]))
  const shown = answered.filter(row => (plan.having ?? []).every(({ measure, is, value }) => {
    const figure = row[position.get(measure)!]
    return typeof figure === 'number' && PASSES[is](figure, value)
  }))
  const order: [string, 'asc' | 'desc'][] = plan.order?.length ? plan.order : groupBy.map(name => [name, 'asc'])
  shown.sort((a, b) => {
    for (const [name, direction] of order) {
      const [left, right] = [a[position.get(name)!], b[position.get(name)!]]
      // Whatever the direction, a row with no figure goes last.
      const by = left === null || right === null ? compare(left, right) : direction === 'asc' ? compare(left, right) : compare(right, left)
      if (by) return by
    }
    return 0
  })
  const limit = plan.limit ?? MAX_PLAN_ROWS
  const answer: Analysis = { model: model.name, columns, rows: shown.slice(0, limit), truncated: shown.length > limit }
  if (unmatched.length) answer.unmatched = unmatched
  if (model.asOf) {
    // Days are YYYY-MM-DD, so the latest is the greatest string.
    const days = kept.map(row => row[model.asOf!]).filter((day): day is string => typeof day === 'string')
    answer.asOf = days.length ? days.reduce((latest, day) => day > latest ? day : latest) : null
  }
  return answer
}
