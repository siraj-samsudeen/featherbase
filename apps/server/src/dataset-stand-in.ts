// #1409: stand-in datasets. A dataset an app declares is served from the
// warehouse (its declared query) or, until the warehouse has the data, from a
// stand-in: rows with the same columns, loaded from a CSV. This module checks
// a CSV against a declaration, loads it as the dataset's active snapshot
// through the snapshot lifecycle (dataset-snapshot.ts), switches a dataset to
// the warehouse, and lists every app's datasets for the Admin's Datasets page.
// What marks a stand-in on a read is in app-datasets.ts; the design is in
// openspec (stand-in-datasets, decisions D1 to D8).
import { sql } from './db'
import { AppError } from './errors'
import { parseCsv, type CsvDelimiter } from './csv'
import { saveDoc } from './document'
import { datasetKey, exactColumns, shapeValue, storedRowJson, type DatasetDeclaration } from './app-datasets'
import { activeSnapshot, buildSnapshot, pruneSnapshots } from './dataset-snapshot'
import { STAND_IN, WAREHOUSE, datasetBinding, type DatasetBinding } from './dataset-bindings'
import { installedAppDatasets, packageTitle } from './runtime-packages'

const BINDING_TABLE = 'Dataset Binding'
/** How many problems a refusal spells out; the rest are counted. */
export const STAND_IN_PROBLEMS_SHOWN = 20

/** One thing wrong with a file: a column of the file, or one cell of one row
 *  (the header is row 1, as a spreadsheet shows it). */
export interface StandInProblem {
  row?: number
  column?: string
  message: string
}

export interface StandInCheck {
  /** The file's data rows, each declared column's cell as text or null. */
  rows: Record<string, string | null>[]
  /** The first problems found, in file order; empty when the file fits. */
  problems: StandInProblem[]
  /** How many problems there are in all. */
  problemCount: number
}

/** What a column type asks of a cell, in the words a refusal uses. */
const KIND: Record<DatasetDeclaration['columns'][number]['type'], string> = {
  text: 'text',
  integer: 'a whole number',
  number: 'a number',
  money: 'an amount (digits only, like 1250.50)',
  date: 'a date written YYYY-MM-DD',
  boolean: 'true or false',
}

/**
 * Check a CSV against a dataset's declaration (D1): exactly its columns, each
 * cell fitting its column's type, and no empty cell in a key or scope column,
 * since such a row would reach no one or be filtered by no one. Cells are
 * shaped by the function that shapes a warehouse row, so a file that fits here
 * reads exactly as the warehouse's rows would. An empty cell is a missing
 * value. Every problem is collected, so one round of fixes can clear them all.
 */
export function checkStandIn(dataset: DatasetDeclaration, csv: string, delimiter?: CsvDelimiter): StandInCheck {
  const [header = [], ...lines] = parseCsv(csv, delimiter)
  const headings = header.map((heading) => heading.trim())
  const problems: StandInProblem[] = []
  const declared = dataset.columns.map((column) => column.name)
  for (const column of declared)
    if (!headings.includes(column)) problems.push({ column, message: `The file has no column "${column}", which ${dataset.name} needs` })
  for (const [at, heading] of headings.entries()) {
    if (heading && !declared.includes(heading)) problems.push({ column: heading, message: `The file's column "${heading}" is not a column of ${dataset.name}` })
    else if (heading && headings.indexOf(heading) !== at) problems.push({ column: heading, message: `The file has the column "${heading}" more than once` })
  }
  const exact = exactColumns(dataset)
  const present = dataset.columns.filter((column) => headings.includes(column.name)).map((column) => ({ ...column, at: headings.indexOf(column.name) }))
  const rows: StandInCheck['rows'] = []
  for (const [index, line] of lines.entries()) {
    if (!line.some((cell) => cell.trim() !== '')) continue
    const row: Record<string, string | null> = {}
    for (const { name, type, at } of present) {
      const text = (line[at] ?? '').trim()
      const cell = text === '' ? null : type === 'boolean' ? text.toLowerCase() : text
      row[name] = cell
      if (cell === null) {
        if (exact.has(name)) problems.push({ row: index + 2, column: name, message: `Row ${index + 2}: "${name}" is empty, and every row of ${dataset.name} needs it` })
        continue
      }
      try {
        shapeValue(type, cell, name, exact.has(name))
      } catch {
        problems.push({ row: index + 2, column: name, message: `Row ${index + 2}: "${name}" holds "${text}", which is not ${KIND[type]}` })
      }
    }
    rows.push(row)
  }
  if (!rows.length) problems.push({ message: 'The file has no rows under its header' })
  return { rows, problems: problems.slice(0, STAND_IN_PROBLEMS_SHOWN), problemCount: problems.length }
}

/** A refusal in one message: each problem shown, and how many more there are. */
function refusal(dataset: DatasetDeclaration, check: StandInCheck): AppError {
  const more = check.problemCount - check.problems.length
  return new AppError('ValidationError',
    `The file does not fit ${dataset.name}. ${check.problems.map((problem) => problem.message).join('. ')}${more ? `. And ${more} more` : ''}.`)
}

/** The declaration of an installed app's dataset, or a refusal naming what is missing. */
async function declaredDataset(app: string, name: string): Promise<DatasetDeclaration> {
  const datasets = await installedAppDatasets(app)
  if (!datasets) throw new AppError('NotFoundError', `App ${app} is not installed`)
  const dataset = datasets.find((d) => d.name === name)
  if (!dataset)
    throw new AppError('NotFoundError', `App ${app} does not declare the dataset ${name}${datasets.length ? ` (it declares: ${datasets.map((d) => d.name).join(', ')})` : ''}`)
  return dataset
}

/** Save the dataset's binding as `user`, through the Table's own save, so its
 *  rules (the production rule, a field the settings file manages) and its
 *  history apply. Only the fields given change. */
async function bind(key: string, binding: DatasetBinding | null, values: Record<string, unknown>, user: string): Promise<void> {
  await saveDoc(BINDING_TABLE, { ...(binding ? { updated_at: binding.updated_at } : {}), ...values, row_id: key }, user)
}

export interface StandInFile {
  csv: string
  delimiter?: CsvDelimiter
}

/** POST …/check_stand_in: does the file fit, and if not, what to fix. Writes nothing. */
export async function checkStandInFile(app: string, name: string, file: StandInFile) {
  const dataset = await declaredDataset(app, name)
  const check = checkStandIn(dataset, file.csv, file.delimiter)
  return { app, dataset: name, fits: check.problemCount === 0, rows: check.rows.length, problems: check.problems, problem_count: check.problemCount }
}

/**
 * POST …/load_stand_in: check the file, bind the dataset to a stand-in, and
 * activate the file's rows as its snapshot. A file that does not fit changes
 * nothing. The binding is saved first: where a stand-in is not allowed (D8),
 * or the settings file manages the binding, that save refuses before any row
 * is loaded.
 */
export async function loadStandIn(app: string, name: string, file: StandInFile & { note?: string | null; expected_by?: string | null }, user: string) {
  const dataset = await declaredDataset(app, name)
  const check = checkStandIn(dataset, file.csv, file.delimiter)
  if (check.problemCount) throw refusal(dataset, check)
  const key = datasetKey(app, name)
  const binding = await datasetBinding(key)
  await bind(key, binding, {
    served_from: STAND_IN,
    ...(file.note === undefined ? {} : { note: file.note }),
    ...(file.expected_by === undefined ? {} : { expected_by: file.expected_by }),
  }, user)
  const outcome = await buildSnapshot(key, { trigger: 'stand-in', standIn: { rows: storedRowJson(dataset, check.rows), by: user } })
  if (outcome.status !== 'activated') throw new AppError('ValidationError', `The stand-in for ${name} could not be loaded: ${outcome.reason}`)
  await pruneSnapshots(key)
  const loaded = (await activeSnapshot(key))!
  return { app, dataset: name, rows: check.rows.length, loaded_at: new Date(loaded.activated_at!).toISOString() }
}

const count = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 })
const rowsWord = (rows: number) => `${count.format(rows)} ${rows === 1 ? 'row' : 'rows'}`

/**
 * POST …/switch_to_warehouse (D7): bind the dataset to the warehouse and run
 * the real refresh now. It compares with nothing, because a stand-in is never
 * a baseline (D3). When it does not activate, the stand-in keeps serving, the
 * dataset is bound back to it, and the answer says why in the refresh's own
 * words.
 */
export async function switchToWarehouse(app: string, name: string, user: string) {
  await declaredDataset(app, name)
  const key = datasetKey(app, name)
  const binding = await datasetBinding(key)
  const bound = binding?.served_from === STAND_IN
  if (!bound && !(await activeSnapshot(key))?.stand_in)
    throw new AppError('ValidationError', `${name} already reads the warehouse`)
  if (bound) await bind(key, binding, { served_from: WAREHOUSE }, user)
  const outcome = await buildSnapshot(key, { trigger: 'switch' })
  if (outcome.status === 'activated') {
    await pruneSnapshots(key)
    return { app, dataset: name, switched: true, rows: outcome.rowCount!, message: `${name} now reads the warehouse: ${rowsWord(outcome.rowCount!)}.` }
  }
  if (bound) await bind(key, await datasetBinding(key), { served_from: STAND_IN }, user)
  const why = outcome.status === 'refused' ? 'was refused' : 'failed'
  return { app, dataset: name, switched: false, message: `${name} stays on its stand-in. The warehouse refresh ${why}: ${outcome.reason}.` }
}

/** One dataset as the Datasets page and `list_datasets` show it. */
export interface DatasetView {
  name: string
  /** The Data Source its query reads. */
  source: string
  /** Its Dataset Binding row, when it has one. */
  binding: string | null
  served_from: typeof WAREHOUSE | typeof STAND_IN
  /** The rows being served were loaded as a stand-in. */
  stand_in: boolean
  note: string | null
  expected_by: string | null
  allowed_on_production: boolean
  /** The rows being served, or null when it has none yet. */
  rows: number | null
  /** When those rows were refreshed or loaded. */
  as_of: string | null
  /** Who loaded the stand-in being served. */
  loaded_by: string | null
  /** The snapshot being served (a Dataset Snapshot row). */
  snapshot: string | null
}

/** GET /api/datasets: every enabled app that declares a dataset, with where each is served from. */
export async function listDatasets(): Promise<{ apps: { app: string; title: string; datasets: DatasetView[] }[] }> {
  const installed = await sql`select name from installed_app where runtime_package and enabled order by name`
  const apps = []
  for (const { name } of installed) {
    const app = String(name)
    const declared = (await installedAppDatasets(app)) ?? []
    if (!declared.length) continue
    const datasets: DatasetView[] = []
    for (const dataset of declared) {
      const key = datasetKey(app, dataset.name)
      const binding = await datasetBinding(key)
      const snapshot = await activeSnapshot(key)
      datasets.push({
        name: dataset.name,
        source: dataset.source,
        binding: binding?.row_id ?? null,
        served_from: binding?.served_from ?? WAREHOUSE,
        stand_in: snapshot?.stand_in ?? false,
        note: binding?.note ?? null,
        expected_by: binding?.expected_by ?? null,
        allowed_on_production: binding?.allowed_on_production ?? false,
        rows: snapshot?.row_count ?? null,
        as_of: snapshot ? new Date(snapshot.activated_at!).toISOString() : null,
        loaded_by: snapshot?.stand_in ? snapshot.created_by : null,
        snapshot: snapshot?.row_id ?? null,
      })
    }
    apps.push({ app, title: packageTitle(app) ?? app, datasets })
  }
  return { apps }
}
