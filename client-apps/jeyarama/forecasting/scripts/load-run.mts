// Loads a month's engine Runs and who reviews them into this instance's forecasting.run_line and
// forecasting.reach, in bulk and in one transaction: every line of the file's months is replaced (so a
// relabelled or withdrawn Run goes too), and the reach is replaced whole. It reads two CSVs from a folder outside the repository (run_line.csv, reach.csv; the repo is
// public, so real figures and names never enter it) and writes straight to the app's own Tables, as the
// forecast team's psql load does. People only read these Tables; explanations and numbers are untouched.
//
//   cd apps/server && DATABASE_URL=… node --import tsx ../../client-apps/jeyarama/forecasting/scripts/load-run.mts <folder>
//
// The seed calls loadRun() for a local instance when FORECAST_RUN_DIR names the folder.
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

type Sql = { begin<T>(fn: (tx: Tx) => Promise<T>): Promise<T> }
type Tx = { (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]>; unsafe(query: string, values?: unknown[]): Promise<unknown[]> }

/** RFC 4180: quoted fields may hold commas, quotes ("") and line breaks. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []
  let row: string[] = [], field = '', quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++ }
      else if (c === '"') quoted = false
      else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(field); rows.push(row); row = []; field = '' }
    else field += c
  }
  if (field || row.length) { row.push(field); rows.push(row) }
  const [head, ...body] = rows.filter(r => r.length > 1 || r[0])
  return body.map(r => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])))
}

const RUN_COLUMNS = ['row_id', 'run', 'month', 'store', 'region', 'division', 'subdivision', 'category', 'section', 'subcategory', 'code', 'forecast', 'aop', 'band', 'days_json', 'parts_json', 'other', 'qty', 'aop_qty']
const REACH_COLUMNS = ['row_id', 'full_name', 'code', 'role', 'place', 'reports_to', 'places_json']
const NUMERIC = new Set(['forecast', 'aop', 'other', 'qty', 'aop_qty'])

async function insert(tx: Tx, table: string, columns: string[], rows: Record<string, string>[]) {
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500)
    const values: unknown[] = []
    const tuples = chunk.map(r => `(${columns.map(c => { values.push(r[c] === '' ? null : NUMERIC.has(c) ? Number(r[c]) : r[c]); return `$${values.length}` }).join(', ')}, 'submitted')`)
    await tx.unsafe(`insert into ${table} (${columns.map(c => `"${c}"`).join(', ')}, submission_status) values ${tuples.join(', ')}`, values)
  }
}

/** Replaces the lines of the file's months and the whole reach; returns what it loaded. */
export async function loadRun(sql: Sql, folder: string) {
  const lines = parseCsv(await readFile(resolve(folder, 'run_line.csv'), 'utf8'))
  const reach = parseCsv(await readFile(resolve(folder, 'reach.csv'), 'utf8'))
  for (const [name, rows, columns] of [['run_line.csv', lines, RUN_COLUMNS], ['reach.csv', reach, REACH_COLUMNS]] as const) {
    const missing = columns.filter(c => !(c in (rows[0] ?? {})))
    if (!rows.length || missing.length) throw new Error(`${name}: ${rows.length ? `missing ${missing.join(', ')}` : 'no rows'}`)
  }
  const runs = [...new Set(lines.map(l => l.run))]
  const months = [...new Set(lines.map(l => l.month))]
  const total = lines.reduce((n, l) => n + Number(l.forecast || 0), 0)
  await sql.begin(async tx => {
    await tx.unsafe('delete from forecasting.run_line where month = any($1)', [months])
    await tx.unsafe('delete from forecasting.reach')
    await insert(tx, 'forecasting.run_line', RUN_COLUMNS, lines)
    await insert(tx, 'forecasting.reach', REACH_COLUMNS, reach)
  })
  return { runs, lines: lines.length, people: reach.length, total, reach }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const folder = process.argv[2]
  if (!folder || !process.env.DATABASE_URL) throw new Error('Usage, from apps/server: DATABASE_URL=… node --import tsx ../../client-apps/jeyarama/forecasting/scripts/load-run.mts <folder holding run_line.csv and reach.csv>')
  // The database client lives with the platform's server, not in this app's folder.
  const { createRequire } = await import('node:module')
  const require = createRequire(new URL('../../../../apps/server/package.json', import.meta.url))
  const { default: postgres } = await import(require.resolve('postgres'))
  const sql = postgres(process.env.DATABASE_URL, { max: 1 }) as unknown as Sql & { end(): Promise<void> }
  const done = await loadRun(sql, folder)
  console.log(`Loaded ${done.lines} lines of ${done.runs.join(', ')} (forecast ₹${Math.round(done.total).toLocaleString('en-IN')}) and ${done.people} people.`)
  await sql.end()
}
