// LOCAL DEVELOPMENT ONLY. Gets a throwaway Featherbase database ready for the Forecasting app: installs it, adds a
// Home Page shortcut and the closed list of change reasons. The made-up people, numbers, ideas and Runs this script used
// to add belonged to the legacy prototype Tables, which Forecasting 0.16.0 removed; the pages now read only the
// read-only copies, which a load fills. No real store, person, code or figure.
//
// Normally run for you: `pnpm dev jeyarama/forecasting --made-up-data`. It refuses a database not
// stamped `development`, and a rerun adds nothing that is already there.
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const checkout = resolve(appDir, '../../..')
if (!process.env.DATABASE_URL || !process.env.FEATHERBASE_API_URL)
  throw new Error('Set DATABASE_URL and FEATHERBASE_API_URL to the same throwaway instance, or run: pnpm dev jeyarama/forecasting --made-up-data')
const api = process.env.FEATHERBASE_API_URL
const { sql } = await import(pathToFileURL(resolve(checkout, 'apps/server/src/db.ts')).href)
const version = JSON.parse(await readFile(resolve(appDir, 'package.json'), 'utf8')).version

const [stamp] = await sql`select value from featherbase.internal_metadata where key = 'environment'`.catch(() => [])
if (stamp?.value !== 'development') throw new Error('Refusing: this database is not stamped development')

const login = await (await fetch(`${api}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ usr: 'Administrator', pwd: 'admin' }) })).json() as { token: string }
async function call<T = Record<string, unknown>>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${api}${path}`, { ...init, headers: { authorization: `Bearer ${login.token}`, 'content-type': 'application/json',
    'X-Featherbase-App-Version': `forecasting@${version}`, ...init.headers } })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(`${path}: ${response.status} ${JSON.stringify(body)}`)
  return body as T
}
const save = (table: string, row: Record<string, unknown>) =>
  call<{ row_id?: string; data?: { row_id: string } }>('/api/save_row', { method: 'POST', body: JSON.stringify({ table, row }) })
    .then(r => r.row_id ?? r.data?.row_id ?? '')

const [installed] = await sql`select 1 from installed_app where name = 'forecasting'`
if (!installed) await call('/api/install_app', { method: 'POST', body: JSON.stringify({ name: 'forecasting' }) })

// The Administrator's way in from the Admin sidebar: an app with its own pages gets no module page, so
// this local instance adds one, "Forecasting", whose shortcut opens the app. Added once; a rerun keeps it.
const signIn = `${`http://localhost:${process.env.WEB_PORT ?? ''}`}/featherbase/login?next=%2Fforecasting%2F`
const page = await fetch(`${api}/api/table/${encodeURIComponent('Home Page')}/forecasting`, { headers: { authorization: `Bearer ${login.token}` } })
if (page.status === 404) await save('Home Page', { row_id: 'forecasting', label: 'Forecasting', module: 'Forecasting', sequence: 10,
  shortcuts: JSON.stringify([{ label: 'Open Forecasting', type: 'url', link_to: '/forecasting/', description: "Review the month's forecast, section by section" }]) })

// The Run's figures are read-only copies of the warehouse feeds (#1418): only a load writes them (fixtures/
// team-leader-december.json feeds the tests and the story). The closed list of change reasons is added here, once.
{
  const [loaded] = await sql`select 1 from forecasting.change_reason limit 1`
  if (!loaded) {
    // the reasons people pick from are ordinary rows; they keep their codes as ids, so they are created, not saved over
    const add = (table: string, row: Record<string, unknown>) => call(`/api/table/${encodeURIComponent(table)}`, { method: 'POST', body: JSON.stringify(row) })
    const reasons: [string, string, string][] = [['stock_short', 'Stock out or short', 'both'], ['stock_arriving', 'Stock arriving', 'both'],
      ['price_changed', 'Price changed', 'both'], ['display_space', 'Display space', 'both'], ['last_month_one_off', 'Last month was a one-off', 'month'],
      ['event_or_festival', 'Event or festival', 'both'], ['may_not_happen', 'May not happen', 'day'], ['store_hours', 'Store shut or short hours', 'day'],
      ['range_dropped', 'Range dropped', 'both'], ['customers_asking', 'Customers asking', 'both'], ['other', 'Other (explain)', 'both']]
    for (const [i, [reason_code, label, applies_to]] of reasons.entries()) await add('forecasting.change_reason', { row_id: reason_code, reason_code, label, applies_to, sort_order: i + 1 })
    console.log("Forecasting: the change reasons. The Run's figures come from a load of the read-only copies.")
  }
}

console.log(`Forecasting: ready. Sign in and open the app:  ${signIn}  as Administrator / admin (development only).
    The pages read the read-only copies of the warehouse, which a load fills; until then the app says no Run is loaded.`)
await sql.end?.()  // the open pool would keep this script, and so the dev command, waiting
process.exit(0)
