// LOCAL DEVELOPMENT ONLY. Fills a throwaway Featherbase database with the made-up numbers, their
// history, Review questions and ideas in fixtures/made-up-records.json, so every state of the
// Forecasting pages can be seen. No real store, person, code or figure.
//
// Normally run for you: `pnpm dev jeyarama/forecasting --made-up-data`. It refuses a database not
// stamped `development`, and a rerun adds nothing once the made-up numbers are there.
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { SUBS, engineFor, fromWeights, parseWeeks, type Code, type Scope } from '../src/madeUp.ts'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const checkout = resolve(appDir, '../../..')
if (!process.env.DATABASE_URL || !process.env.FEATHERBASE_API_URL)
  throw new Error('Set DATABASE_URL and FEATHERBASE_API_URL to the same throwaway instance, or run: pnpm dev jeyarama/forecasting --made-up-data')
const api = process.env.FEATHERBASE_API_URL
const { sql } = await import(pathToFileURL(resolve(checkout, 'apps/server/src/db.ts')).href)
const records = JSON.parse(await readFile(resolve(appDir, 'fixtures/made-up-records.json'), 'utf8'))
const register = JSON.parse(await readFile(resolve(appDir, 'fixtures/made-up-register.json'), 'utf8'))
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

const existing = await call<{ data: unknown[] }>('/api/table/forecasting.number?limit_page_length=1')
if (existing.data.length) {
  console.log('Forecasting: made-up numbers are already there; nothing added.')
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
  const { key: _key, history, weights, percent: _percent, ...row } = n
  const id = await save('forecasting.number', { ...row, value: figure, weights_json: weights ? JSON.stringify(weights) : null })
  for (const [decision, by, on, note] of history)
    await save('forecasting.decision', { number: id, month: n.month, store: n.store, scope_name: n.scope_name, decision, decided_by: by, decided_on: on, note })
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
    Open:  ${api.replace(/:\d+$/, ':' + (process.env.WEB_PORT ?? ''))}/forecasting/  as Administrator / admin (development only)
    Pick a made-up person under "Viewing as" to see the page as they would.`)
await sql.end?.()  // the open pool would keep this script, and so the dev command, waiting
process.exit(0)
