// LOCAL DEVELOPMENT ONLY. Fills a throwaway Featherbase database with the made-up numbers, their
// history, Review questions and ideas in fixtures/made-up-records.json, so every state of the
// Forecasting pages can be seen. No real store, person, code or figure.
//
// Normally run for you: `pnpm dev jeyarama/forecasting --made-up-data`. It refuses a database not
// stamped `development`, and a rerun adds nothing once the made-up numbers are there.
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { PEOPLE, SUBS, fromWeights, parseWeeks, type Code, type Scope } from '../src/madeUp.ts'
import { engineFor } from '../src/sales.ts'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const checkout = resolve(appDir, '../../..')
if (!process.env.DATABASE_URL || !process.env.FEATHERBASE_API_URL)
  throw new Error('Set DATABASE_URL and FEATHERBASE_API_URL to the same throwaway instance, or run: pnpm dev jeyarama/forecasting --made-up-data')
const api = process.env.FEATHERBASE_API_URL
const { sql } = await import(pathToFileURL(resolve(checkout, 'apps/server/src/db.ts')).href)
const { setUserPassword } = await import(pathToFileURL(resolve(checkout, 'apps/server/src/auth.ts')).href)
/** The local password every made-up forecaster signs in with (this script's own test value). */
const PASSWORD = 'forecast-dev'
const records = JSON.parse(await readFile(resolve(appDir, 'fixtures/made-up-records.json'), 'utf8'))
const register = JSON.parse(await readFile(resolve(appDir, 'fixtures/made-up-register.json'), 'utf8'))
// FORECAST_RUN_DIR names a folder outside the repository holding a real Run (run_line.csv, reach.csv):
// then the Run and its reviewers are loaded (scripts/load-run.mts), each reviewer gets a local sign-in,
// and none of the made-up numbers, questions or ideas are added, so real and made-up never mix.
const runDir = process.env.FORECAST_RUN_DIR
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

// Each made-up person signs in as themselves (name@forecasting.test), holding Forecasting Member, so the
// server can tell who is acting. The Administrator can still act as anyone, for "Viewing as".
let real: { people: { id: string; name: string }[] } | null = null
if (runDir) {
  const { loadRun } = await import('./load-run.mts')
  const done = await loadRun(sql, runDir)
  real = { people: done.reach.map(r => ({ id: (r.code || r.full_name).toLowerCase().replace(/[^a-z0-9]+/g, '-'), name: r.full_name })) }
  console.log(`Forecasting: loaded ${done.lines} lines of ${done.runs.join(', ')} and ${done.people} reviewers.`)
}
for (const p of real?.people ?? PEOPLE) {
  const email = `${p.id}@forecasting.test`
  const [found] = await sql`select row_id from person where lower(email) = ${email}`
  const id = found ? String(found.row_id) : String((await call<{ row_id: string }>('/api/table/Person', { method: 'POST',
    // The made-up Forecast Lead also answers Team Leaders' questions (the Forecast Creator role, #1419).
    body: JSON.stringify({ email, full_name: p.name, enabled: true, roles: [{ role: 'Forecasting Member' }, ...(p.id === 'farah' ? [{ role: 'Forecast Creator' }] : [])] }) })).row_id)
  await setUserPassword(id, PASSWORD)
}

// The Administrator's way in from the Admin sidebar: an app with its own pages gets no module page, so
// this local instance adds one, "Forecasting", whose shortcut opens the app. Added once; a rerun keeps it.
const signIn = `${`http://localhost:${process.env.WEB_PORT ?? ''}`}/featherbase/login?next=%2Fforecasting%2F`
const page = await fetch(`${api}/api/table/${encodeURIComponent('Home Page')}/forecasting`, { headers: { authorization: `Bearer ${login.token}` } })
if (page.status === 404) await save('Home Page', { row_id: 'forecasting', label: 'Forecasting', module: 'Forecasting', sequence: 10,
  shortcuts: JSON.stringify([{ label: 'Open Forecasting', type: 'url', link_to: '/forecasting/' }]) })

// The Team Leader review (#1419) reads the copied warehouse tables. Until the warehouse copy table exists
// (#1418), a local instance on made-up data fills them from fixtures/team-leader-december.json (Lakeside ·
// Girls Bottoms, invented figures), with the closed list of change reasons. Added once; a rerun keeps them.
if (!real) {
  const [loaded] = await sql`select 1 from forecasting.forecast_run limit 1`
  if (!loaded) {
    const tl = JSON.parse(await readFile(resolve(appDir, 'fixtures/team-leader-december.json'), 'utf8')) as Record<string, Record<string, unknown>[]>
    // The copies are read only to everyone, so they are written straight to their tables, as the copy job and the
    // bulk load write them (a save through the API never writes a read-only column).
    await sql.begin(async (tx: { unsafe(query: string, values?: unknown[]): Promise<unknown> }) => {
      for (const [table, rows] of Object.entries(tl)) for (const row of rows) {
        const cols = Object.keys(row)
        const params = cols.map((_, i) => '$' + (i + 1)).join(', ')
        await tx.unsafe(`insert into forecasting.${table} (${cols.map(c => `"${c}"`).join(', ')}, submission_status) values (${params}, 'submitted')`, cols.map(c => row[c]))
      }
    })
    // the reasons people pick from are ordinary rows; they keep their codes as ids, so they are created, not saved over
    const add = (table: string, row: Record<string, unknown>) => call(`/api/table/${encodeURIComponent(table)}`, { method: 'POST', body: JSON.stringify(row) })
    const reasons: [string, string, string][] = [['stock_short', 'Stock out or short', 'both'], ['stock_arriving', 'Stock arriving', 'both'],
      ['price_changed', 'Price changed', 'both'], ['display_space', 'Display space', 'both'], ['last_month_one_off', 'Last month was a one-off', 'month'],
      ['event_or_festival', 'Event or festival', 'both'], ['may_not_happen', 'May not happen', 'day'], ['store_hours', 'Store shut or short hours', 'day'],
      ['range_dropped', 'Range dropped', 'both'], ['customers_asking', 'Customers asking', 'both'], ['other', 'Other (explain)', 'both']]
    for (const [i, [reason_code, label, applies_to]] of reasons.entries()) await add('forecasting.change_reason', { row_id: reason_code, reason_code, label, applies_to, sort_order: i + 1 })
    console.log(`Forecasting: the made-up December Run for the Team Leader review (${tl.forecast_line_month.length} lines).`)
  }
}

if (real) {
  console.log(`Forecasting: a real Run, ${real.people.length} reviewers with local sign-ins (<code>@forecasting.test); no made-up numbers added.
    Sign in and open the app:  ${signIn}  as Administrator / admin (development only)`)
  await sql.end?.()
  process.exit(0)
}

const existing = await call<{ data: unknown[] }>('/api/table/forecasting.number?limit_page_length=1')
if (existing.data.length) {
  console.log(`Forecasting: made-up numbers are already there; nothing added.\n    Sign in and open the app:  ${signIn}  as Administrator / admin (development only)`)
  await sql.end?.()
  process.exit(0)
}

type Seed = { key: string; month: string; store: string; scope_level: Scope['level']; scope_name: string; weeks: string; kind: string; value?: number; percent?: number;
  weights?: Partial<Record<Code, number>>; history: [string, string, string, string][] } & Record<string, unknown>
for (const n of records.numbers as Seed[]) {
  const scope: Scope = { store: n.store, level: n.scope_level, name: n.scope_name, weeks: parseWeeks(n.weeks) }
  const base = engineFor(scope, n.month)
  const sub = SUBS.find(s => s.store === n.store && s.name === n.scope_name)
  // A weights or percent number's figure is worked out the way the page works it out.
  const figure = n.weights && sub ? Math.round(fromWeights(sub, n.weights)) : n.percent != null ? Math.round(base * (1 + n.percent / 100)) : n.value
  const { key: _key, history, weights, percent, ...row } = n
  // A percent is kept as a percent; its figure here is only what it made the scope on the day.
  const id = await save('forecasting.number', { ...row, value: figure, percent: percent ?? null, weights_json: weights ? JSON.stringify(weights) : null })
  for (const [decision, by, on, note] of history)
    await save('forecasting.decision', { number: id, month: n.month, store: n.store, scope_level: n.scope_level, scope_name: n.scope_name, weeks: n.weeks, decision, decided_by: by, decided_on: on, note })
}
for (const c of records.comments) await save('forecasting.decision', c)

const OUTCOME: Record<string, string> = { changed: 'Forecast changed', nochange: 'No change', progress: 'Being worked on', waiting: 'Waiting on the asker', parked: 'Parked', open: 'Open' }
/** Both date spellings the register arrived in, as YYYY-MM-DD. */
const day = (d: string) => (!d ? null : /^\d{4}-/.test(d) ? d : iso(d))
const iso = (d: string) => { const [day, mon, y] = d.split('-'); return `${y}-${String(['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].indexOf(mon) + 1).padStart(2, '0')}-${day}` }
for (const q of register.questions) await save('forecasting.review_question', {
  ref: q.id, month: '2026-11', scope: q.scope, question: q.q, detail: q.ask, asked_by: 'Kumar', asked_on: iso(q.asked),
  answer: q.ans || null, answered_by: q.ans ? 'Farah' : null, answered_on: q.answered ? iso(q.answered) : null,
  outcome: OUTCOME[q.st] ?? 'Open', impact: q.impact === '—' ? null : q.impact, follow_up: q.follow || null, idea_ref: q.idea })
for (const i of register.ideas) await save('forecasting.idea', {
  ref: i.id, label: i.label, title: i.title, kind: i.kind === 'November check' ? 'Month check' : i.kind, raised_by: i.raised_by, raised_on: day(i.raised_on),
  why: i.why, tried: i.tried, found: i.found, verdict: i.verdict, outcome: i.outcome, status_note: i.status, decided_on: day(i.decided_on),
  revisit: i.revisit || null, areas: (i.tags ?? []).join(', '), evidence: (i.evidence ?? []).join('\n') || null })

console.log(`Forecasting: ${records.numbers.length} made-up numbers, ${register.questions.length} Review questions and ${register.ideas.length} ideas.
    Sign in and open the app:  ${signIn}  as Administrator / admin (development only)
    In the Admin, the sidebar's Modules list has Forecasting.
    Pick a made-up person under "Viewing as" to see the page as they would.
    Or sign in as one of them, to see what the server lets them do: asha@forecasting.test, mani@forecasting.test,
    selvi@forecasting.test, bina@forecasting.test, farah@forecasting.test, kumar@forecasting.test (password forecast-dev).`)
await sql.end?.()  // the open pool would keep this script, and so the dev command, waiting
process.exit(0)
