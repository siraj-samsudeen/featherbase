// SQL is the first way a question is answered: the language model writes one
// SELECT, and it runs on a private in-memory database that holds only the
// rows the platform has already limited to the asker's places. These tests
// run real SQL on that database (no Postgres needed).
//
// Fixture: test-apps/fixtures/semantic-proof declares the models.
import { describe, expect, test } from 'vitest'
import type { DatasetDeclaration, DatasetRow } from '../src/app-datasets'
import { runPlan, type AnalysisPlan, type SemanticModel } from '../src/semantic-model'
import { SqlFault, figureSql, planSql, questionToSql, readSqlReply, runSql, sqlColumns, sqlPrompt, type SqlTable } from '../src/semantic-sql'
import manifest from '../../../test-apps/fixtures/semantic-proof/featherbase.json'

const [model, pieces] = manifest.semantic.models as unknown as SemanticModel[]
const dataset = (manifest.datasets as DatasetDeclaration[])[0]
const table: SqlTable = { model, dataset }
const rows: DatasetRow[] = ([['N1', 'North', 'kids', 100, 120.5, 3], ['N1', 'North', 'mens', 300, 150, 5], ['N1', 'North', 'toys', 0, 10, 1], ['S1', 'South', 'kids', 200, 260, 2]] as const)
  .map(([store_code, store_name, subcategory, target, actual, units], index) => ({ store_code, store_name, subcategory, target, actual, units,
    // Only the first row has been labelled by the model's relationships.
    ...(index === 0 ? { 'zone.zone_name': 'Front' } : {}) }))
const run = async (text: string, on = table, over = rows) => (await runSql(on, over, text)).rows

describe('a model as a table', () => {
  test('has the dataset\'s columns, and each dimension under its own name', () => {
    expect(sqlColumns(table)).toEqual([
      { name: 'store_code', type: 'VARCHAR', key: 'store_code' }, { name: 'store_name', type: 'VARCHAR', key: 'store_name' },
      { name: 'subcategory', type: 'VARCHAR', key: 'subcategory' }, { name: 'target', type: 'DOUBLE', key: 'target' },
      { name: 'actual', type: 'DOUBLE', key: 'actual' }, { name: 'units', type: 'BIGINT', key: 'units' },
      { name: 'store', type: 'VARCHAR', key: 'store_name', about: 'Also called: branch' }, { name: 'zone', type: 'VARCHAR', key: 'zone.zone_name' }])
    const described: SemanticModel = { ...model, dimensions: [{ name: 'subcategory', column: 'subcategory', description: 'A line of goods', synonyms: ['line'] }] }
    expect(sqlColumns({ model: described, dataset })[2]).toEqual({ name: 'subcategory', type: 'VARCHAR', key: 'subcategory', about: 'A line of goods. Also called: line' })
  })

  test('a relationship\'s label and a renamed column are read under the dimension\'s name', async () => {
    expect(await run('select store, zone, sum(actual) as sales from sales_vs_target group by all order by store, zone nulls last'))
      .toEqual([['North', 'Front', 120.5], ['North', null, 160], ['South', null, 260]])
  })
})

describe('the model\'s figures as SQL', () => {
  const sided: SemanticModel = { ...model,
    measures: [...model.measures, { name: 'north_sales', column: 'actual', aggregate: 'sum', where: { store_code: 'N1' } },
      { name: 'threes', column: 'actual', aggregate: 'max', where: { units: 3, store_code: "N'1", target: '100' } }],
    metrics: [...model.metrics!, { name: 'short', expression: '-(sales - target) * 2' }] }

  test('a measure is its aggregate, over the rows it counts; a metric is its expression, dividing by nothing as missing', () => {
    expect(Object.fromEntries(figureSql({ model: sided, dataset }))).toEqual({
      target: 'sum("target")', sales: 'sum("actual")', units: 'sum("units")',
      north_sales: `sum("actual") filter (where "store_code" = 'N1')`,
      threes: `max("actual") filter (where "units" = 3 and "store_code" = 'N''1' and cast("target" as varchar) = '100')`,
      gap: '((sum("actual")) - (sum("target")))', achieved: '((100 * (sum("actual"))) / nullif((sum("target")), 0))',
      short: '((-((sum("actual")) - (sum("target")))) * 2)' })
  })

  test('a plan is written as the SQL that answers it', () => {
    expect(planSql(table, { measures: ['gap'], groupBy: ['subcategory'], order: [['gap', 'asc']], limit: 5 }))
      .toBe('select "subcategory", ((sum("actual")) - (sum("target"))) as "gap" from "sales_vs_target" group by "subcategory" order by "gap" asc nulls last limit 5')
    expect(planSql(table, { measures: ['sales'], filters: [{ dimension: 'store', in: [' North ', "O'Hare"] }], having: [{ measure: 'sales', is: 'at_least', value: 10 }] }))
      .toBe(`select sum("actual") as "sales" from "sales_vs_target" where lower(trim(cast("store" as varchar))) in ('north', 'o''hare') having sum("actual") >= 10`)
  })

  test.for<[string, AnalysisPlan]>([
    ['everything, with nothing to group by', { measures: ['target', 'sales', 'gap', 'achieved'] }],
    ['a group ordered by a figure that is missing for one row', { measures: ['achieved', 'gap'], groupBy: ['subcategory'], order: [['achieved', 'desc']] }],
    ['a name typed any way', { measures: ['sales', 'units'], groupBy: ['subcategory'], filters: [{ dimension: 'store', in: ['  NORTH '] }] }],
    ['a name that matches nothing', { measures: ['sales'], filters: [{ dimension: 'store', in: ['West'] }] }],
    ['only the rows whose figure passes', { measures: ['gap'], groupBy: ['subcategory'], having: [{ measure: 'gap', is: 'below', value: 0 }] }],
    ['a figure above and at most', { measures: ['sales'], groupBy: ['store'], having: [{ measure: 'sales', is: 'above', value: 100 }, { measure: 'sales', is: 'at_most', value: 280.5 }] }],
    ['a relationship\'s label, some rows without one', { measures: ['sales'], groupBy: ['zone'] }],
    ['measures that count only some rows', { measures: ['north_sales', 'sales', 'short'], groupBy: ['subcategory'], order: [['subcategory', 'desc']], limit: 2 }],
  ])('the SQL of a plan answers as the plan does: %s', async ([, plan]) => {
    expect(await run(planSql({ model: sided, dataset }, plan), { model: sided, dataset })).toEqual(runPlan(sided, rows, plan).rows)
  })
})

describe('running SQL on the asker\'s rows', () => {
  test('figures come back as numbers, days and names as text, and a figure the model names keeps its meaning', async () => {
    const answer = await runSql(table, rows, `select count(*) as lines, min(store) as first_store, count(*) > 3 as many, date '2026-11-14' as day,
      sum(units) as units, 100 * sum(actual) / nullif(sum(target), 0) as achieved, sum(actual) / 3 as third, sum(target) filter (where store = 'West') as none from sales_vs_target`)
    expect(answer).toEqual({ model: 'sales_vs_target', truncated: false, rows: [[4, 'North', true, '2026-11-14', 11, 90.083333, 180.166667, null]],
      columns: [{ name: 'lines', kind: 'measure' }, { name: 'first_store', kind: 'dimension' }, { name: 'many', kind: 'dimension' }, { name: 'day', kind: 'dimension' },
        { name: 'units', kind: 'measure' }, { name: 'achieved', kind: 'metric', unit: 'percent' }, { name: 'third', kind: 'measure' }, { name: 'none', kind: 'measure' }] })
  })

  test('a described figure carries its description, a dimension is never a figure, and a list comes back as text', async () => {
    const described: SemanticModel = { ...model, dimensions: [...model.dimensions, { name: 'units_band', column: 'units' }],
      measures: [{ name: 'sales', column: 'actual', aggregate: 'sum', description: 'Sales before tax' }],
      metrics: [{ name: 'double', expression: 'sales * 2', description: 'Sales, twice' }] }
    const answer = await runSql({ model: described, dataset }, rows, 'select units_band, sum(actual) as sales, sum(actual) * 2 as double, list(subcategory) as lines from sales_vs_target where units = 5 group by all')
    expect(answer.columns).toEqual([{ name: 'units_band', kind: 'dimension' }, { name: 'sales', kind: 'measure', definition: 'Sales before tax' },
      { name: 'double', kind: 'metric', definition: 'Sales, twice' }, { name: 'lines', kind: 'dimension' }])
    expect(answer.rows).toEqual([[5, 150, 300, '["mens"]']])
  })

  test('a value that is not what its column holds is missing, and a day spelt oddly is no day', async () => {
    const odd: DatasetDeclaration = { ...dataset, columns: [...dataset.columns, { name: 'data_through', type: 'date' }, { name: 'open', type: 'boolean' }] }
    const dated: SemanticModel = { ...model, asOf: 'data_through' }
    const mixed = [{ ...rows[0], data_through: '2026-11-14', open: true }, { ...rows[1], data_through: '', open: 'yes', target: 'lots', units: 1.5 },
      { ...rows[2], data_through: '2026-11-12', open: false, actual: undefined }] as unknown as DatasetRow[]
    const answer = await runSql({ model: dated, dataset: odd }, mixed, 'select subcategory, target, actual, units, data_through, open from sales_vs_target order by subcategory')
    expect(answer.rows).toEqual([['kids', 100, 120.5, 3, '2026-11-14', true], ['mens', null, 150, null, null, null], ['toys', 0, null, 1, '2026-11-12', false]])
    expect(answer.asOf).toBe('2026-11-14')
    expect((await runSql({ model: dated, dataset: odd }, [], 'select count(*) as lines from sales_vs_target')).asOf).toBeNull()
  })

  test('a figure of the statement\'s own is a percentage when the reply says so; a name is never one', async () => {
    const answer = await runSql(table, rows, 'select store, 100 * sum(actual) / sum(sum(actual)) over () as share, sum(units) as pieces from sales_vs_target group by store order by store', undefined, ['share', 'store'])
    expect(answer.columns).toEqual([{ name: 'store', kind: 'dimension' }, { name: 'share', kind: 'measure', unit: 'percent' }, { name: 'pieces', kind: 'measure' }])
    expect(answer.rows).toEqual([['North', 51.896392, 9], ['South', 48.103608, 2]])
  })

  test('an answer is cut at the platform\'s ceiling, and says so', async () => {
    const answer = await runSql(table, rows, 'select range as n from range(1500) order by n')
    expect([answer.rows.length, answer.truncated, answer.rows.at(-1)]).toEqual([1000, true, [999]])
  })

  test.for([
    ['two statements', 'select 1 as a; select 2 as b', 'The SQL must be one statement'],
    ['a statement that changes something', 'delete from asker_rows', 'The SQL must be a SELECT'],
    ['a statement that reaches for a setting', 'set enable_external_access = true', 'The SQL must be a SELECT'],
    ['a column the table lacks', 'select profit from sales_vs_target', 'The SQL could not be run'],
    ['words that are not SQL', 'sales please', 'The SQL could not be run'],
    ['a file on the server', "select * from read_csv('/etc/passwd')", 'The SQL could not be run'],
    ['a page on the internet', "select * from read_json('https://example.test/x.json')", 'The SQL could not be run'],
    ['a column named twice', 'select 1 as a, 2 as a', 'The SQL names a column of its answer twice'],
  ])('%s is refused as SQL that cannot be used', async ([, text, message]) => {
    const fault = await runSql(table, rows, text).then(() => undefined, error => error)
    expect(fault).toBeInstanceOf(SqlFault)
    expect((fault as Error).message).toContain(message)
  })

  test('SQL that runs too long is stopped', async () => {
    const fault = await runSql(table, rows, 'select sum(a.range * b.range) as n from range(10000000) a, range(10000000) b', 50).then(() => undefined, error => error)
    expect(fault).toBeInstanceOf(SqlFault)
    expect((fault as Error).message).toContain('The SQL could not be run')
  })

  test('each question gets its own database: nothing of one is there for the next', async () => {
    expect(await run('select count(*) as lines from sales_vs_target', table, rows.slice(0, 1))).toEqual([[1]])
    expect(await run('select count(*) as lines from sales_vs_target', table, [])).toEqual([[0]])
    expect(await run("select count(*) as tables from information_schema.tables where table_schema = 'main'")).toEqual([[2]])
  })
})

describe('the SQL prompt and the reply', () => {
  const tables: SqlTable[] = [table, { model: pieces, dataset }]

  test('the prompt sets out each table, its figures as expressions, the asker\'s values, and verified questions as SQL', () => {
    const prompt = sqlPrompt(tables, { sales_vs_target: { store: ['North'] } })
    for (const part of ['one SQL SELECT statement, in DuckDB\'s dialect', 'Table "sales_vs_target". Sales against target, per store and subcategory.',
      '- "store" VARCHAR. Also called: branch.', '- "actual" DOUBLE.', '- sales = sum("actual"). Also called: actual.', '- achieved = ((100 * (sum("actual"))) / nullif((sum("target")), 0)) (a percentage).',
      'Values the asker may see, spelt as the data spells them:\n- "store": North', 'Table "pieces_sold". Pieces sold, per store.', '- pieces = sum("units").',
      `A: ${JSON.stringify({ model: 'pieces_sold', sql: 'select "store", sum("units") as "pieces" from "pieces_sold" group by "store" order by "store" asc nulls last' })}`,
      '{"model": <the table\'s name>, "sql": <the statement>, "percent": [<names>]}', 'Never return more than 1000 rows.'])
      expect(prompt).toContain(part)
    const bare: SemanticModel = { ...pieces, description: undefined, verified: undefined, metrics: undefined }
    const plain = sqlPrompt([{ model: bare, dataset }])
    expect(plain).toContain('Table "pieces_sold".\nColumns:')
    expect(plain).not.toContain('Examples:')
    expect(plain).not.toContain('Values the asker may see')
  })

  test('a reply is SQL for the table it names, the first when it names none, or a question back', () => {
    expect(readSqlReply(tables, 'Here:\n```json\n{"model": "pieces_sold", "sql": " select 1 as a "}\n```')).toEqual({ model: 'pieces_sold', sql: 'select 1 as a' })
    expect(readSqlReply(tables, '{"sql": "select 1 as a", "percent": []}')).toEqual({ model: 'sales_vs_target', sql: 'select 1 as a' })
    expect(readSqlReply(tables, '{"sql": "select 1 as share", "percent": ["share"]}')).toEqual({ model: 'sales_vs_target', sql: 'select 1 as share', percent: ['share'] })
    expect(readSqlReply(tables, '{"clarify": " Rupees or pieces? "}')).toEqual({ clarify: 'Rupees or pieces?' })
  })

  test.for(['no JSON at all', '{"plan": {"measures": ["sales"]}}', '{"sql": ""}', '{"model": "stock", "sql": "select 1 as a"}', `{"sql": "${'x'.repeat(4001)}"}`])('a reply of %j is not SQL that can be used', (text) => {
    expect(() => readSqlReply(tables, text)).toThrow(SqlFault)
  })

  test('a reply that says no table can answer is refused in plain words, and is no fault of the SQL', () => {
    const refusal = (() => { try { return readSqlReply(tables, '{"cannot": "There is no profit figure."}') } catch (error) { return error } })()
    expect(refusal).not.toBeInstanceOf(SqlFault)
    expect((refusal as Error).message).toBe('That question cannot be answered from sales_vs_target or pieces_sold: There is no profit figure.')
  })

  test('a follow-up shows each earlier turn as SQL, and leaves out one that can no longer be read', async () => {
    const asked: { system: string; question: string; history?: { question: string; reply: string }[] }[] = []
    const language = { async complete(prompt: (typeof asked)[number]) { asked.push(prompt); return '{"sql": "select 1 as a"}' } }
    const history = [{ question: 'Sales?', clarify: 'Which month?' }, { question: 'This month', plan: { measures: ['sales'] } },
      { question: 'Pieces?', model: 'pieces_sold', sql: 'select sum(units) as pieces from pieces_sold' },
      { question: 'Stock?', model: 'stock', sql: 'select 1 as a' }, { question: 'Profit?', model: 'sales_vs_target', plan: { measures: ['profit'] } }]
    expect(await questionToSql(tables, 'And by store?', language, {}, history)).toEqual({ model: 'sales_vs_target', sql: 'select 1 as a' })
    expect(asked[0].history).toEqual([{ question: 'Sales?', reply: '{"clarify":"Which month?"}' },
      { question: 'This month', reply: JSON.stringify({ model: 'sales_vs_target', sql: 'select sum("actual") as "sales" from "sales_vs_target"' }) },
      { question: 'Pieces?', reply: JSON.stringify({ model: 'pieces_sold', sql: 'select sum(units) as pieces from pieces_sold' }) }])
    await questionToSql(tables, 'Sales?', language)
    expect(asked[1].history).toBeUndefined()
  })
})
