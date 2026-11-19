// A question in words, answered by SQL the language model writes, as Cortex
// Analyst does. What makes that safe here is where the SQL runs: on a private,
// throwaway, in-memory database that holds only the rows the platform has
// already limited to the asker's places, with outside access switched off.
// Whatever the statement says, it can read nothing else: there is nothing
// else there. It must still be one SELECT, it is stopped when it runs too
// long, and its answer is cut at the platform's ceiling.
//
// Each semantic model is one table, named after the model: the dataset's
// columns, and each dimension under its own name (a relationship's label
// included). The model's measures and metrics are given to the language model
// as the expressions that work them out, so its SQL counts what the model
// means by each name.
import { z } from 'zod'
import { AppError } from './errors'
import type { DatasetDeclaration, DatasetRow, DatasetValue } from './app-datasets'
import { MAX_PLAN_ROWS, dimensionKey, parseExpression, readPlan, tidy, type AnalysisColumn, type AnalysisPlan, type SemanticModel } from './semantic-model'
import type { PlanModel, Turn } from './semantic-question'

/** SQL that could not be used: not one SELECT, not runnable, or too slow. The question may still be answered by a plan. */
export class SqlFault extends AppError {
  constructor(message: string) { super('ValidationError', message) }
}

/** A semantic model with the dataset it reads: one table of the private database. */
export interface SqlTable { model: SemanticModel; dataset: DatasetDeclaration }

export const SQL_TIMEOUT_MS = 5000
export const MAX_SQL_LENGTH = 4000

type SqlType = 'VARCHAR' | 'BIGINT' | 'DOUBLE' | 'DATE' | 'BOOLEAN'
const SQL_TYPES: Record<DatasetDeclaration['columns'][number]['type'], SqlType> =
  { text: 'VARCHAR', integer: 'BIGINT', number: 'DOUBLE', money: 'DOUBLE', date: 'DATE', boolean: 'BOOLEAN' }
// Names are the manifest's identifiers (lower case, digits, underscores); quoted, a keyword such as "month" is still a name.
const quoted = (name: string) => `"${name}"`
const literal = (value: string | number) => typeof value === 'number' ? String(value) : `'${value.replace(/'/g, "''")}'`

interface SqlColumn { name: string; type: SqlType; /** Where the value sits in a row. */ key: string; about?: string }

/** The table's columns: the dataset's own, then each dimension not already there under its own name. */
export function sqlColumns({ model, dataset }: SqlTable): SqlColumn[] {
  const columns: SqlColumn[] = dataset.columns.map(column => ({ name: column.name, type: SQL_TYPES[column.type], key: column.name }))
  for (const dimension of model.dimensions) {
    const about = [dimension.description, dimension.synonyms?.length ? `Also called: ${dimension.synonyms.join(', ')}` : undefined].filter(Boolean).join('. ') || undefined
    const own = columns.find(column => column.name === dimension.name)
    if (own) { own.about ??= about; continue }
    const source = dimension.relationship === undefined ? columns.find(column => column.name === dimension.column) : undefined
    columns.push({ name: dimension.name, type: source?.type ?? 'VARCHAR', key: dimensionKey(dimension), ...(about ? { about } : {}) })
  }
  return columns
}

// ---- the model's figures as SQL ----

type Expression = ReturnType<typeof parseExpression>
function render(expression: Expression, measures: Map<string, string>): string {
  if (expression.kind === 'number') return String(expression.value)
  if (expression.kind === 'measure') return `(${measures.get(expression.name)})`
  if (expression.kind === 'negate') return `(-${render(expression.of, measures)})`
  const [left, right] = [render(expression.left, measures), render(expression.right, measures)]
  // A figure divided by nothing is missing, as in a plan: never an error and never infinity.
  return expression.operator === '/' ? `(${left} / nullif(${right}, 0))` : `(${left} ${expression.operator} ${right})`
}

/** Each measure and metric of the model as the SQL that works it out, by name. */
export function figureSql(table: SqlTable): Map<string, string> {
  const { model } = table
  const types = new Map(sqlColumns(table).map(column => [column.name, column.type]))
  // A value is compared the way its column holds it: a number with a number, text with text.
  const equals = (column: string, value: string | number) => {
    const type = types.get(column)
    if (typeof value === 'number' && (type === 'BIGINT' || type === 'DOUBLE')) return `${quoted(column)} = ${value}`
    return type === 'VARCHAR' ? `${quoted(column)} = ${literal(String(value))}` : `cast(${quoted(column)} as varchar) = ${literal(String(value))}`
  }
  const measures = new Map(model.measures.map((measure) => {
    const where = Object.entries(measure.where ?? {}).map(([column, value]) => equals(column, value))
    return [measure.name, `${measure.aggregate}(${quoted(measure.column)})${where.length ? ` filter (where ${where.join(' and ')})` : ''}`]
  }))
  return new Map([...measures, ...(model.metrics ?? []).map(metric => [metric.name, render(parseExpression(metric.expression), measures)] as [string, string])])
}

const COMPARES = { below: '<', above: '>', at_most: '<=', at_least: '>=' }

/** The SQL that answers a plan, so a verified plan is also an example of SQL and an earlier plan can be followed up in SQL. */
export function planSql(table: SqlTable, plan: AnalysisPlan): string {
  const { model } = table
  const figures = figureSql(table)
  const groupBy = (plan.groupBy ?? []).map(quoted)
  const filters = (plan.filters ?? []).map(filter =>
    `lower(trim(cast(${quoted(filter.dimension)} as varchar))) in (${filter.in.map(value => literal(value.trim().toLowerCase())).join(', ')})`)
  const having = (plan.having ?? []).map(({ measure, is, value }) => `${figures.get(measure)} ${COMPARES[is]} ${value}`)
  const order = (plan.order?.length ? plan.order : (plan.groupBy ?? []).map(name => [name, 'asc'] as const)).map(([name, direction]) => `${quoted(name)} ${direction} nulls last`)
  return [
    `select ${[...groupBy, ...plan.measures.map(name => `${figures.get(name)} as ${quoted(name)}`)].join(', ')}`,
    `from ${quoted(model.name)}`,
    ...(filters.length ? [`where ${filters.join(' and ')}`] : []),
    ...(groupBy.length ? [`group by ${groupBy.join(', ')}`] : []),
    ...(having.length ? [`having ${having.join(' and ')}`] : []),
    ...(order.length ? [`order by ${order.join(', ')}`] : []),
    ...(plan.limit ? [`limit ${plan.limit}`] : []),
  ].join(' ')
}

// ---- the prompt and the reply ----

const said = (text: string | undefined) => text ? ` ${text.replace(/\.$/, '')}.` : ''
const also = (synonyms: readonly string[] | undefined) => synonyms?.length ? ` Also called: ${synonyms.join(', ')}.` : ''

/** The system prompt: each model as a table, its figures as expressions, the asker's values, and its verified questions as SQL. */
export function sqlPrompt(tables: readonly SqlTable[], values: Record<string, Record<string, string[]>> = {}): string {
  return [
    'You turn a business question into one SQL SELECT statement, in DuckDB\'s dialect, over one of the tables below.',
    'You never see the data and never answer with figures: you only write the statement.',
    'It runs on a private copy that holds only the rows the asker may see, so "my store" or "my sections" needs no filter.',
    ...tables.flatMap((table) => {
      const { model } = table
      const figures = figureSql(table)
      const known = Object.entries(values[model.name] ?? {})
      return ['', `Table ${quoted(model.name)}.${said(model.description)}`, 'Columns:',
        ...sqlColumns(table).map(column => `- ${quoted(column.name)} ${column.type}.${said(column.about)}`),
        'Figures, and the expression that works each out. Use these expressions, and name the column after the figure:',
        ...model.measures.map(measure => `- ${measure.name} = ${figures.get(measure.name)}.${said(measure.description)}${also(measure.synonyms)}`),
        ...(model.metrics ?? []).map(metric => `- ${metric.name} = ${figures.get(metric.name)}${metric.unit === 'percent' ? ' (a percentage)' : ''}.${said(metric.description)}${also(metric.synonyms)}`),
        ...(known.length ? ['Values the asker may see, spelt as the data spells them:', ...known.map(([dimension, list]) => `- ${quoted(dimension)}: ${list.join(' | ')}`)] : []),
        ...(model.verified?.length ? ['Examples:', ...model.verified.flatMap(({ question, plan }) => [`Q: ${question}`, `A: ${JSON.stringify({ model: model.name, sql: planSql(table, plan) })}`])] : []),
      ]
    }),
    '',
    'Rules:',
    '- One statement, a SELECT (it may start with WITH). Read one table only.',
    '- Name every column of the answer in lower_snake_case, each name once. A figure listed above keeps its name.',
    '- Divide with nullif(x, 0), so a figure divided by nothing is missing.',
    '- Compare text as lower(trim(cast(column as varchar))) with a lower-case value, and filter only with values listed above when there are some.',
    '- Behind target or a shortfall is a negative gap: keep only gap below 0 and order it ascending. Fallen is a change below 0; grew is a change above 0.',
    '- Order the rows as the question asks, with "nulls last", and keep a "top" or "most" question to the number asked for, or 5.',
    '- A percentage is on a scale of 0 to 100. List the names of the answer\'s percentage columns in "percent", beside "sql".',
    `- Never return more than ${MAX_PLAN_ROWS} rows.`,
    '',
    'Reply with one JSON object and nothing else: {"model": <the table\'s name>, "sql": <the statement>, "percent": [<names>]}, or, when no table can answer the question,',
    '{"cannot": "<one short sentence saying what is missing>"}.',
    'When the question could mean two different things and no sensible default exists, do not guess: reply',
    '{"clarify": "<one short question to ask the person>"}.',
    'Earlier questions of this conversation come first, each with the reply it got. A follow-up such as "and by store?"',
    'or "only the top 3" changes the latest statement: reply with the whole new statement and its table.',
  ].join('\n')
}

const sentence = z.string().trim().min(1).max(300)
const reply = z.union([z.object({ model: z.string().optional(), sql: z.string().trim().min(1).max(MAX_SQL_LENGTH), percent: z.array(z.string()).max(50).optional() }).strict(),
  z.object({ cannot: sentence }).strict(), z.object({ clarify: sentence }).strict()])

/** What a question becomes on this path: SQL for one of the tables, or one question to ask the person first. */
export type SqlReply = { model: string; sql: string; /** The answer's columns that are percentages. */ percent?: string[] } | { clarify: string }

/** Reads the language model's reply. One that says it cannot answer is refused in plain words; one that is not SQL for these tables is a fault. */
export function readSqlReply(tables: readonly SqlTable[], text: string): SqlReply {
  let parsed: z.infer<typeof reply> | undefined
  try { parsed = reply.parse(JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1))) } catch { parsed = undefined }
  if (!parsed) throw new SqlFault('The reply was not SQL for one of the tables')
  if ('cannot' in parsed) throw new AppError('ValidationError', `That question cannot be answered from ${tables.map(table => table.model.name).join(' or ')}: ${parsed.cannot}`)
  if ('clarify' in parsed) return { clarify: parsed.clarify }
  const named = parsed.model ?? tables[0].model.name
  if (!tables.some(table => table.model.name === named)) throw new SqlFault(`The reply names ${named}, which is not one of the tables`)
  return { model: named, sql: parsed.sql, ...(parsed.percent?.length ? { percent: parsed.percent } : {}) }
}

/**
 * Turns a question into SQL for one of these tables, or a question to ask
 * back. An earlier turn answered by SQL is shown as it was; one answered by a
 * plan is shown as the SQL of that plan; one that can no longer be read is
 * left out.
 */
export async function questionToSql(tables: readonly SqlTable[], asked: string, language: PlanModel,
  values: Record<string, Record<string, string[]>> = {}, history: readonly Turn[] = []): Promise<SqlReply> {
  const earlier = history.flatMap(({ question, plan, sql, model: named, clarify }) => {
    if (clarify !== undefined) return [{ question, reply: JSON.stringify({ clarify }) }]
    const table = tables.find(candidate => candidate.model.name === (named ?? tables[0].model.name))
    if (!table) return []
    if (sql !== undefined) return [{ question, reply: JSON.stringify({ model: table.model.name, sql }) }]
    try { return [{ question, reply: JSON.stringify({ model: table.model.name, sql: planSql(table, readPlan(table.model, plan)) }) }] } catch { return [] }
  })
  return readSqlReply(tables, await language.complete({ system: sqlPrompt(tables, values), question: asked, ...(earlier.length ? { history: earlier } : {}) }))
}

// ---- running it ----

export interface SqlAnswer {
  model: string
  columns: AnalysisColumn[]
  rows: DatasetValue[][]
  truncated: boolean
  /** The latest day in the model's asOf column among the asker's rows, when the model has one. */
  asOf?: string | null
}

const SELECT = 1 // DuckDB's StatementType.SELECT
// DuckDB's type ids for whole numbers, floats, decimals and big numbers: what a figure can be.
const NUMERIC = new Set([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 16, 19, 32, 35])
const BOOLEAN = 1

/**
 * Runs one SELECT over the asker's rows of one model, in a private in-memory
 * database made for this question and thrown away after it. `rows` are
 * already limited to the asker's places and labelled by the model's
 * relationships. `percent` names the answer's columns that are percentages.
 * Throws SqlFault when the statement cannot be used.
 */
export async function runSql(table: SqlTable, rows: readonly DatasetRow[], text: string, timeoutMs = SQL_TIMEOUT_MS, percent: readonly string[] = []): Promise<SqlAnswer> {
  const { model } = table
  const columns = sqlColumns(table)
  const { DuckDBInstance } = await import('@duckdb/node-api')
  const instance = await DuckDBInstance.create(':memory:', { threads: '1', memory_limit: '512MB', autoinstall_known_extensions: 'false', autoload_known_extensions: 'false' })
  const connection = await instance.connect()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    // Days are loaded as text and read back as dates, so a day the data spells oddly is missing, not an error.
    await connection.run(`create table asker_rows (${columns.map(column => `${quoted(column.name)} ${column.type === 'DATE' ? 'VARCHAR' : column.type}`).join(', ')})`)
    const appender = await connection.createAppender('asker_rows')
    for (const row of rows) {
      for (const column of columns) {
        const value = row[column.key]
        if (value === null || value === undefined) appender.appendNull()
        else if (column.type === 'DOUBLE') typeof value === 'number' ? appender.appendDouble(value) : appender.appendNull()
        else if (column.type === 'BIGINT') typeof value === 'number' && Number.isInteger(value) ? appender.appendBigInt(BigInt(value)) : appender.appendNull()
        else if (column.type === 'BOOLEAN') typeof value === 'boolean' ? appender.appendBoolean(value) : appender.appendNull()
        else appender.appendVarchar(String(value))
      }
      appender.endRow()
    }
    appender.flushSync()
    appender.closeSync()
    await connection.run(`create view ${quoted(model.name)} as select ${columns.map(column =>
      column.type === 'DATE' ? `try_cast(${quoted(column.name)} as date) as ${quoted(column.name)}` : quoted(column.name)).join(', ')} from asker_rows`)
    // From here the statement is the language model's: nothing outside this database can be reached, and that cannot be undone.
    await connection.run('set enable_external_access = false')
    await connection.run('set lock_configuration = true')

    let reader: Awaited<ReturnType<typeof connection.runAndReadUntil>>
    try {
      const statements = await connection.extractStatements(text)
      if (statements.count !== 1) throw new SqlFault('The SQL must be one statement')
      const prepared = await statements.prepare(0)
      const kind = prepared.statementType
      prepared.destroySync()
      if (kind !== SELECT) throw new SqlFault('The SQL must be a SELECT')
      timer = setTimeout(() => connection.interrupt(), timeoutMs)
      reader = await connection.runAndReadUntil(text, MAX_PLAN_ROWS + 1)
    } catch (error) {
      if (error instanceof SqlFault) throw error
      throw new SqlFault(`The SQL could not be run: ${(error as Error).message.split('\n')[0]}`)
    }

    const names = reader.columnNames()
    if (new Set(names).size !== names.length) throw new SqlFault('The SQL names a column of its answer twice')
    const dimensions = new Set(model.dimensions.map(dimension => dimension.name))
    const measures = new Map(model.measures.map(measure => [measure.name, measure]))
    const metrics = new Map((model.metrics ?? []).map(metric => [metric.name, metric]))
    const types = names.map((_, index) => reader.columnTypeId(index) as number)
    const answered: AnalysisColumn[] = names.map((name, index) => {
      const measure = measures.get(name)
      const metric = metrics.get(name)
      if (measure) return { name, kind: 'measure', ...(measure.description ? { definition: measure.description } : {}) }
      if (metric) return { name, kind: 'metric', ...(metric.unit ? { unit: metric.unit } : {}), ...(metric.description ? { definition: metric.description } : {}) }
      if (dimensions.has(name) || !NUMERIC.has(types[index])) return { name, kind: 'dimension' }
      // A figure of the statement's own: a percentage when the reply said so.
      return { name, kind: 'measure', ...(percent.includes(name) ? { unit: 'percent' as const } : {}) }
    })
    const found = reader.getRowsJson().map(row => row.map((value, index): DatasetValue => {
      if (value === null || value === undefined) return null
      if (NUMERIC.has(types[index])) {
        const figure = Number(value)
        return Number.isFinite(figure) ? tidy(figure) : null
      }
      return types[index] === BOOLEAN ? Boolean(value) : typeof value === 'string' ? value : JSON.stringify(value)
    }))
    const answer: SqlAnswer = { model: model.name, columns: answered, rows: found.slice(0, MAX_PLAN_ROWS), truncated: found.length > MAX_PLAN_ROWS }
    if (model.asOf) {
      const days = rows.map(row => row[model.asOf!]).filter((day): day is string => typeof day === 'string')
      answer.asOf = days.length ? days.reduce((latest, day) => day > latest ? day : latest) : null
    }
    return answer
  } finally {
    clearTimeout(timer)
    connection.closeSync()
    instance.closeSync()
  }
}
